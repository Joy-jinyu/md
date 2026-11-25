/**
 * GitHub 账号：登没登录、登录（两种流程）、退出。token 从 store/sync-store.ts 读、只交给 github.ts 的请求头，界面只拿到账号名。
 * 退出登录（或者 GitHub 说 token 失效了）时删掉本机存的 token。
 */
import { signal } from "nsh";
import { messageOf } from "../doc/message";
import { clearAuth, clearOAuthState, readAuth, readOAuthState, saveAuth, saveOAuthState } from "../store/sync-store";
import {
  authorizeUrl,
  type Callback,
  checkState,
  codeChallenge,
  type DeviceCode,
  exchangeCode,
  pollDeviceToken,
  randomState,
  randomVerifier,
  requestDeviceCode,
  STATE_TTL,
} from "./auth";
import { OAUTH_CALLBACK_ORIGIN, syncConfig } from "./config";
import { createGitHub, type GitHub, SyncError } from "./github";

export type Account = { kind: "loading" } | { kind: "signed-out" } | { kind: "signed-in"; login: string };

/** Device Flow 进行到哪了：给界面显示用户码、等待、失败原因。 */
export type DeviceLogin = { kind: "idle" } | { kind: "starting" } | { kind: "waiting"; code: DeviceCode } | { kind: "failed"; message: string };

const account = signal<Account>({ kind: "loading" });
const device = signal<DeviceLogin>({ kind: "idle" });
/** 每次开始或取消 Device Flow 加一：旧的那次轮询看到数字变了就停。 */
let deviceRun = 0;

export const currentAccount = () => account();
export const deviceLogin = () => device();

/** 启动时（和窗口回到前台时）读一次本机存的登录：别的标签页可能刚登录或退出了。 */
export async function restoreAccount(): Promise<Account> {
  try {
    const saved = await readAuth();
    account.set(saved ? { kind: "signed-in", login: saved.login } : { kind: "signed-out" });
  } catch (e) {
    console.warn("sync sign-in unreadable", e);
    account.set({ kind: "signed-out" });
  }
  return account();
}

export async function signOut() {
  deviceRun++;
  device.set({ kind: "idle" });
  await clearAuth();
  account.set({ kind: "signed-out" });
}

/** 401：token 失效了，删掉，变成没登录。 */
function expired() {
  signOut().catch((e: unknown) => console.error("sign-out after 401 failed", e));
}

/** 拿到 token 以后：问出账号名，连 token 一起存进本机，变成已登录。 */
async function finishSignIn(token: string): Promise<string> {
  const login = await createGitHub(token, fetch, () => undefined).user();
  await saveAuth({ token, login });
  account.set({ kind: "signed-in", login });
  return login;
}

/** 用现在登录的账号访问 GitHub；没登录时抛错。 */
export async function github(): Promise<{ api: GitHub; login: string }> {
  const saved = await readAuth();
  if (!saved) {
    account.set({ kind: "signed-out" });
    throw new SyncError("auth", "还没登录 GitHub，先登录再同步。");
  }
  return { api: createGitHub(saved.token, fetch, expired), login: saved.login };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** macOS：开始 Device Flow。拿到用户码后界面显示它，后台轮询；成了变成已登录。 */
export async function beginDeviceLogin() {
  const run = ++deviceRun;
  const { clientId } = syncConfig();
  device.set({ kind: "starting" });
  let code: DeviceCode;
  try {
    code = await requestDeviceCode(clientId, fetch);
  } catch (e) {
    if (run === deviceRun) device.set({ kind: "failed", message: messageOf(e) });
    return;
  }
  if (run !== deviceRun) return;
  device.set({ kind: "waiting", code });
  const result = await pollDeviceToken(clientId, code, { fetchFn: fetch, sleep, cancelled: () => run !== deviceRun, now: Date.now });
  if (result.kind === "cancelled" || run !== deviceRun) return;
  if (result.kind === "failed") return device.set({ kind: "failed", message: result.message });
  try {
    await finishSignIn(result.token);
    device.set({ kind: "idle" });
  } catch (e) {
    console.error("sign-in not finished", e);
    device.set({ kind: "failed", message: `没能完成登录：${messageOf(e)}` });
  }
}

export function cancelDeviceLogin() {
  deviceRun++;
  device.set({ kind: "idle" });
}

/** 网页：记下 state 和 PKCE 的 code_verifier，返回要打开的 GitHub 授权页地址。`redirectUri` 是授权后回到的本站地址。 */
export async function beginWebLogin(redirectUri: string): Promise<string> {
  const state = randomState();
  const verifier = randomVerifier();
  await saveOAuthState({ state, at: Date.now(), verifier, redirectUri });
  return authorizeUrl(syncConfig().clientId, state, redirectUri, await codeChallenge(verifier));
}

/** GitHub 授权页带回来的固定错误码（OAuth App 文档「Troubleshooting authorization request errors」）各自的说明。 */
const CALLBACK_ERRORS = new Map<string, string>([
  ["access_denied", "在 GitHub 上取消了授权，没有登录。"],
  ["redirect_uri_mismatch", `GitHub 不认这个页面的回调地址（redirect_uri_mismatch），没有登录：网页登录只在 ${new URL(OAUTH_CALLBACK_ORIGIN).host} 可用。`],
  ["application_suspended", "这个 GitHub OAuth App 被停用了（application_suspended），现在登录不了。"],
]);

/**
 * 网页：从 GitHub 回来了。校验 state，交给 Worker 换 token，成了返回账号名；不成抛带原因的错。
 * state 对上了（或者过期了）才作废；对不上的回调（别人做的链接）不消耗它，这边正在进行的登录照样能完成。
 * GitHub 报的固定错误码 state 对不上也照样说明（登记的回调页存不到别的页面发起时的 state，不然真正的原因会被盖住）；别的错误码要 state 对上才原样显示。
 */
export async function finishWebLogin(callback: Callback): Promise<string> {
  const saved = await readOAuthState();
  const now = Date.now();
  const bad = checkState(saved, callback.state, now);
  const known = callback.kind === "error" ? CALLBACK_ERRORS.get(callback.error) : undefined;
  if (bad || !saved) {
    if (saved && now - saved.at > STATE_TTL) await clearOAuthState();
    throw new SyncError("auth", known ?? bad ?? "");
  }
  await clearOAuthState();
  if (callback.kind === "error") throw new SyncError("auth", known ?? `GitHub 没让登录（${callback.error}）。`);
  const token = await exchangeCode(syncConfig().workerUrl, { code: callback.code, state: callback.state, verifier: saved.verifier, redirectUri: saved.redirectUri }, fetch);
  return finishSignIn(token);
}
