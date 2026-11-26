/**
 * GitHub 登录的两种流程，权限只要 gist（.claude/rules/security.md）：
 * - Device Flow（macOS 应用）：要用户码 → 用户在 GitHub 上输入并授权 → 轮询换 token。不需要 client secret。
 * - 网页授权（网页版）：跳 GitHub 授权页（带随机 state 和 PKCE 的 code_challenge）→ 回到本站带 code → 交给中转 Worker 换 token
 *   （带上 code_verifier 和 redirect_uri，Worker 原样转给 GitHub）。PKCE：code 半路被截走也换不到 token（GitHub 的 OAuth 文档写了支持，只收 S256）。
 *   github.com 的 token 接口不支持浏览器跨域（OAuth 文档：不支持 CORS 预检），换 token 又要 client secret，所以经 Worker。
 * 流程细节以 docs.github.com「Authorizing OAuth apps」为准（2026-11-25 读）。
 */
import { type Phrase, t } from "../i18n";
import { ACCESS_TOKEN_URL, AUTHORIZE_URL, DEVICE_CODE_URL, OAUTH_SCOPE } from "./config";
import { type Fetch, SyncError } from "./github";

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** 用户码几秒后过期。 */
  expiresIn: number;
  /** 两次轮询之间至少隔几秒。 */
  interval: number;
}

/** 轮询的结果：拿到了 token、失败了（带给人看的原因）、或者用户取消了。 */
export type PollResult = { kind: "token"; token: string } | { kind: "failed"; message: Phrase } | { kind: "cancelled" };

/** GitHub 没给轮询间隔时用的秒数（文档里的默认值）。 */
const DEFAULT_INTERVAL = 5;
/** slow_down 没带新间隔时加几秒（文档：每次 slow_down 加 5 秒）。 */
const SLOW_DOWN_STEP = 5;
/** 网页登录记下的 state 多久内有效（毫秒）：授权页一般一两分钟内就回来，放宽到 10 分钟。 */
export const STATE_TTL = 10 * 60 * 1000;

const networkMessage = () => t("连不上 GitHub，检查网络后再试。", "Could not reach GitHub. Check your connection and try again.");
/** Device Flow 轮询时连着几次连不上才算失败：等授权的几分钟里网络晃一下很常见。 */
const MAX_NETWORK_MISSES = 3;

async function postForm(fetchFn: Fetch, url: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (e) {
    console.warn("github login request failed", url, e instanceof Error ? e.message : String(e));
    throw new SyncError("network", networkMessage());
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    console.warn("github login response unreadable", url, res.status, e);
    throw new SyncError("invalid", t(`GitHub 回的内容读不懂（${res.status}），过一会儿再试。`, `GitHub returned an unreadable response (${res.status}). Try again shortly.`), res.status);
  }
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

/** Device Flow 第一步：要一个用户码。 */
export async function requestDeviceCode(clientId: string, fetchFn: Fetch): Promise<DeviceCode> {
  const r = await postForm(fetchFn, DEVICE_CODE_URL, { client_id: clientId, scope: OAUTH_SCOPE });
  if (typeof r.device_code !== "string" || typeof r.user_code !== "string" || typeof r.verification_uri !== "string") {
    throw new SyncError("invalid", r.error === "device_flow_disabled" ? deviceFlowDisabled() : t("GitHub 没给登录用的验证码，过一会儿再试。", "GitHub did not provide a verification code. Try again shortly."));
  }
  return {
    deviceCode: r.device_code,
    userCode: r.user_code,
    verificationUri: r.verification_uri,
    expiresIn: typeof r.expires_in === "number" ? r.expires_in : 900,
    interval: typeof r.interval === "number" ? r.interval : DEFAULT_INTERVAL,
  };
}

const deviceFlowDisabled = () => t("这个 GitHub OAuth App 没有开 Device Flow（在 App 的设置里勾上「Enable Device Flow」）。", "Enable Device Flow in the GitHub OAuth App settings before signing in.");

/** 轮询里遇到的错误码 → 给人看的原因；null 是接着等。 */
const FAILURES: Record<string, () => string> = {
  expired_token: () => t("验证码过期了，重新点「用 GitHub 登录」拿一个新的。", "The verification code expired. Select “Sign in with GitHub” to request another one."),
  access_denied: () => t("在 GitHub 上取消了授权，没有登录。", "Authorization was canceled on GitHub. You weren’t signed in."),
  device_flow_disabled: deviceFlowDisabled,
  incorrect_device_code: () => t("验证码不对，重新点「用 GitHub 登录」。", "The verification code is invalid. Select “Sign in with GitHub” again."),
  incorrect_client_credentials: () => t("应用的 client id 不对，检查 src/sync/config.ts。", "The client ID is invalid. Check src/sync/config.ts."),
  unsupported_grant_type: () => t("登录请求的写法不对（unsupported_grant_type）。", "GitHub did not accept the sign-in request (unsupported_grant_type)."),
};

export interface PollOptions {
  fetchFn: Fetch;
  /** 等 `ms` 毫秒。 */
  sleep: (ms: number) => Promise<void>;
  /** 用户点了取消。 */
  cancelled: () => boolean;
  now: () => number;
}

/** Device Flow 第二步：按 GitHub 给的间隔轮询，直到拿到 token、被拒、过期或者用户取消。遵守 slow_down（间隔加长）。 */
export async function pollDeviceToken(clientId: string, code: DeviceCode, o: PollOptions): Promise<PollResult> {
  let interval = code.interval;
  let misses = 0;
  const deadline = o.now() + code.expiresIn * 1000;
  for (;;) {
    await o.sleep(interval * 1000);
    if (o.cancelled()) return { kind: "cancelled" };
    if (o.now() > deadline) return { kind: "failed", message: FAILURES.expired_token };
    let r: Record<string, unknown>;
    try {
      r = await postForm(o.fetchFn, ACCESS_TOKEN_URL, { client_id: clientId, device_code: code.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
    } catch (e) {
      if (e instanceof SyncError && e.kind === "network" && ++misses < MAX_NETWORK_MISSES) continue;
      return { kind: "failed", message: e instanceof Error ? e.message : networkMessage };
    }
    misses = 0;
    if (o.cancelled()) return { kind: "cancelled" };
    if (typeof r.access_token === "string" && r.access_token !== "") return { kind: "token", token: r.access_token };
    const error = typeof r.error === "string" ? r.error : "";
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      interval = typeof r.interval === "number" ? r.interval : interval + SLOW_DOWN_STEP;
      continue;
    }
    return { kind: "failed", message: FAILURES[error] ?? (() => t(`GitHub 没让登录${error ? `（${error}）` : ""}，过一会儿再试。`, `GitHub rejected sign-in${error ? ` (${error})` : ""}. Try again shortly.`)) };
  }
}

/** 网页登录用的随机 state：16 个随机字节的十六进制。 */
export function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** PKCE 的 code_verifier：32 个随机字节的 base64url，43 个字符（RFC 7636 4.1）。 */
export function randomVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** PKCE 的 code_challenge：code_verifier 的 SHA-256 的 base64url（S256，GitHub 只收这一种）。 */
export async function codeChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

/** GitHub 授权页的地址；`redirectUri` 是授权后回到的本站地址（网页用 config 的 `OAUTH_CALLBACK_URL`），`challenge` 是 PKCE 的 code_challenge。 */
export function authorizeUrl(clientId: string, state: string, redirectUri: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    scope: OAUTH_SCOPE,
    state,
    redirect_uri: redirectUri,
    allow_signup: "false",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

/** 从 GitHub 回来时页面地址里的结果：code + state，或者 GitHub 给的错误；地址里没有这些是 null。 */
export type Callback = { kind: "code"; code: string; state: string } | { kind: "error"; error: string; state: string };

export function parseCallback(pageUrl: string | null): Callback | null {
  if (!pageUrl) return null;
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (code) return { kind: "code", code, state };
  if (error) return { kind: "error", error, state };
  return null;
}

/** GitHub 授权后回跳时加在地址上的参数：成功带 code、state、iss（发令牌方，RFC 9207），失败带 error 三件。 */
const CALLBACK_PARAMS = ["code", "state", "iss", "error", "error_description", "error_uri"];

/** 页面地址去掉登录回来带的参数（`CALLBACK_PARAMS`），别的参数留着。 */
export function withoutCallback(pageUrl: string): string {
  const url = new URL(pageUrl);
  for (const key of CALLBACK_PARAMS) url.searchParams.delete(key);
  url.hash = "";
  return url.toString();
}

/** state 对不对：没记过、过期、对不上都不行，返回给人看的原因；对上了是 null。 */
export function checkState(saved: { state: string; at: number } | null, got: string, now: number): string | null {
  if (!saved || got === "") return t("这次登录不是从这个页面发起的（或者已经用过了），没有登录。重新点「用 GitHub 登录」。", "This sign-in was started on another page or has already been used. Select “Sign in with GitHub” again.");
  if (now - saved.at > STATE_TTL) return t("登录等得太久已经过期，没有登录。重新点「用 GitHub 登录」。", "This sign-in request expired. Select “Sign in with GitHub” again.");
  if (saved.state !== got) return t("登录回来的校验码对不上，没有登录。重新点「用 GitHub 登录」。", "The verification value returned by GitHub did not match. Select “Sign in with GitHub” again.");
  return null;
}

/** 换 token 要交给 Worker 的：GitHub 带回来的 code、state，发起时的 code_verifier 和回调地址（GitHub 拿它和授权时的比对）。 */
export interface Exchange {
  code: string;
  state: string;
  verifier: string;
  redirectUri: string;
}

/** 网页登录最后一步：交给中转 Worker 换 token（Worker 带上 client secret 去问 GitHub）。 */
export async function exchangeCode(workerUrl: string, x: Exchange, fetchFn: Fetch): Promise<string> {
  let res: Response;
  const payload = JSON.stringify({ code: x.code, state: x.state, code_verifier: x.verifier, redirect_uri: x.redirectUri });
  try {
    res = await fetchFn(`${workerUrl}/token`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: payload });
  } catch (e) {
    console.warn("code exchange failed", e instanceof Error ? e.message : String(e));
    throw new SyncError("network", t("连不上登录中转服务，检查网络后再试。", "Could not reach the sign-in service. Check your connection and try again."));
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.warn("code exchange response unreadable", res.status, e);
  }
  if (res.ok && typeof body.access_token === "string" && body.access_token !== "") return body.access_token;
  console.warn("code exchange refused", res.status, typeof body.error === "string" ? body.error : "");
  throw new SyncError("auth", t(`没能换到 GitHub 的登录（${typeof body.error === "string" ? body.error : res.status}），重新点「用 GitHub 登录」。`, `Could not complete GitHub sign-in (${typeof body.error === "string" ? body.error : res.status}). Select “Sign in with GitHub” again.`), res.status);
}
