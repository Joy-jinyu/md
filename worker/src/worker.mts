/**
 * Pairdown 网页版登录的中转 Worker：页面把 GitHub 授权回来的 code 交过来，这里带上 client secret 去 GitHub 换 token，再交回页面。
 * 规矩（.claude/rules/security.md）：只接受 ALLOWED_DOMAINS 里的来源；请求体只认 code、state、code_verifier、redirect_uri 四个字段；client secret 只从 Worker 的 secret 读；不记任何日志。
 * PKCE：页面发起授权时带了 code_challenge，这里把 code_verifier 转给 GitHub；redirect_uri 也转过去，GitHub 拿它和授权时的比对。
 * 文件后缀是 .mts：避开根目录 tsconfig 的 `**\/*.ts` 和 `nsh test` 的 `*.test.ts(x)`。
 */

export interface Env {
  /** GitHub OAuth App 的 client id（公开值，wrangler.toml 的 vars）。 */
  GITHUB_CLIENT_ID: string;
  /** GitHub OAuth App 的 client secret（`wrangler secret put GITHUB_CLIENT_SECRET`）。 */
  GITHUB_CLIENT_SECRET: string;
  /** 允许的页面来源，逗号分隔，写完整的 origin：`https://markdown.pairwise.site`。 */
  ALLOWED_DOMAINS: string;
}

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const TOKEN_URL = "https://github.com/login/oauth/access_token";
/** code 和 state 的长度上限：GitHub 的 code 是 20 位左右，state 是页面生成的 32 位十六进制，留足余量也拦住乱塞的大请求。 */
const MAX_FIELD = 256;
/** 请求体最多读这么多字节：四个字段加起来远到不了；超了就不往下读。 */
const MAX_BODY = 2048;
/** RFC 7636 4.1：code_verifier 是 43–128 个这些字符。 */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const allowedOrigins = (env: Env): Set<string> =>
  new Set(
    (env.ALLOWED_DOMAINS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );

function json(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function preflight(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}

const isField = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_FIELD && /^[\w.-]+$/.test(v);

/** 回调地址只认「允许的来源 + /」逐字符相等：这就是 OAuth App 登记的回调地址，页面只会发这一个（src/sync/config.ts 的 OAUTH_CALLBACK_URL）。 */
const isRedirect = (v: unknown, env: Env): v is string => typeof v === "string" && [...allowedOrigins(env)].some((o) => v === `${o}/`);

/** 读请求体，最多 MAX_BODY 字节：先看 Content-Length，再边读边数，超了就停（不把大请求整个读进内存）。超了是 null。 */
async function readLimited(request: Request): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    size += chunk.value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

interface TokenRequest {
  code: string;
  verifier: string;
  redirectUri: string;
}

/** 读出请求体里的四个字段；多了别的字段、类型不对、太长都不收。`too-large`：请求体超了上限。 */
async function readBody(request: Request, env: Env): Promise<TokenRequest | "too-large" | null> {
  const raw = await readLimited(request);
  if (raw === null) return "too-large";
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body).sort().join(",");
  const { code, state, code_verifier: verifier, redirect_uri: redirectUri } = body as Record<string, unknown>;
  const ok = keys === "code,code_verifier,redirect_uri,state" && isField(code) && isField(state) && typeof verifier === "string" && VERIFIER.test(verifier) && isRedirect(redirectUri, env);
  return ok ? { code, verifier, redirectUri } : null;
}

/** 带上 client secret 去 GitHub 换 token，只把 token（或 GitHub 给的错误码）交回去。 */
async function exchange(req: TokenRequest, env: Env, fetchFn: Fetch, origin: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: req.code, code_verifier: req.verifier, redirect_uri: req.redirectUri }),
    });
  } catch {
    return json({ error: "github_unreachable" }, 502, origin);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "github_bad_response" }, 502, origin);
  }
  if (typeof body.access_token === "string" && body.access_token !== "") {
    const text = (v: unknown, fallback: string) => (typeof v === "string" && v.length <= MAX_FIELD ? v : fallback);
    return json({ access_token: body.access_token, token_type: text(body.token_type, "bearer"), scope: text(body.scope, "") }, 200, origin);
  }
  const error = typeof body.error === "string" && /^[a-z_]+$/.test(body.error) ? body.error : "exchange_failed";
  return json({ error }, 400, origin);
}

/** 处理一个请求（纯函数：Request → Response，`fetchFn` 是去 GitHub 的那一步，测试里换成假的）。 */
export async function handle(request: Request, env: Env, fetchFn: Fetch = fetch): Promise<Response> {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).has(origin)) return json({ error: "origin_not_allowed" }, 403, null);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return json({ error: "not_configured" }, 500, origin);
  const path = new URL(request.url).pathname;
  if (path !== "/token") return json({ error: "not_found" }, 404, origin);
  if (request.method === "OPTIONS") return preflight(origin);
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  const body = await readBody(request, env);
  if (body === "too-large") return json({ error: "too_large" }, 413, origin);
  if (!body) return json({ error: "bad_request" }, 400, origin);
  return exchange(body, env, fetchFn, origin);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
