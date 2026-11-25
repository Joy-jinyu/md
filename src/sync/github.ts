/**
 * GitHub 的 Gist 接口：一篇文档 = 一个私密 Gist，里面一个「名字.md」文件，说明以「[Pairdown]」开头（认出是本应用的）。
 * token 由调用方（account.ts）从 store 读出来传进来，只放在请求头里；日志只记方法、路径和状态码，错误提示里不带 token。
 * 接口字段以 docs.github.com 的 Gist REST 文档为准（2026-11-25 读）。
 */
import { cleanFileStem } from "../doc/file-name";
import { GITHUB_API } from "./config";

export type SyncErrorKind = "auth" | "rate" | "forbidden" | "not-found" | "network" | "invalid" | "http";

/** 同步出的错，`message` 是给人看的、带下一步怎么办。 */
export class SyncError extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** 说明里的标记：以它开头的 Gist 是 Pairdown 的文档。 */
export const PAIRDOWN_MARK = "[Pairdown]";

export const isPairdownGist = (description: string | null | undefined): boolean => (description ?? "").startsWith(PAIRDOWN_MARK);
export const gistDescription = (name: string) => `${PAIRDOWN_MARK} ${name}`;
/** Gist 里的文件名：文档名去掉文件名里不能有的字符，加 .md。 */
export const gistFileName = (name: string) => `${cleanFileStem(name) || "未命名"}.md`;

/** Gist 里那篇文档：文件名、全文、版本号。 */
export interface Gist {
  id: string;
  description: string;
  fileName: string;
  text: string;
  version: string;
}

/** 列表里的一项（列表不带正文）。 */
export interface GistSummary {
  id: string;
  description: string;
  fileName: string;
  updatedAt: string;
}

/** 给人看的名字：说明里标记后面的部分（文档的标题），没有就用文件名去掉 .md。 */
export function gistTitle(g: { description: string; fileName: string }): string {
  return g.description.slice(PAIRDOWN_MARK.length).trim() || gistDocName(g.fileName);
}

/** 拉到本机时的文档名：文件名去掉 .md。 */
export const gistDocName = (fileName: string) => fileName.replace(/\.md$/i, "") || "未命名";

/** 自己的 Gist 最多翻几页（每页 100 个）。 */
const MAX_PAGES = 30;
const PER_PAGE = 100;

const two = (n: number) => String(n).padStart(2, "0");

function rateMessage(res: Response): string {
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(reset) || reset <= 0) return "GitHub 接口的调用次数到上限了，过一会儿再同步。";
  const at = new Date(reset * 1000);
  return `GitHub 接口的调用次数到上限了，${two(at.getHours())}:${two(at.getMinutes())} 以后再同步。`;
}

function errorFor(res: Response, what: string): SyncError {
  const s = res.status;
  if (s === 401) return new SyncError("auth", "GitHub 登录过期了（也可能是在 GitHub 上撤销了授权），已退出登录。请重新登录后再同步：文档和同步记录都还在，登录后接着同步。", s);
  if (s === 429 || (s === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")))) return new SyncError("rate", rateMessage(res), s);
  if (s === 403) return new SyncError("forbidden", `GitHub 拒绝了${what}（403）。可能是登录时没给 Gist 权限，退出登录后重新登录试试。`, s);
  if (s === 404) return new SyncError("not-found", `GitHub 上找不到${what}的对象（404）。`, s);
  if (s === 422) return new SyncError("http", `GitHub 不收这次的内容（422）。`, s);
  return new SyncError("http", `GitHub 出错了（${s}），过一会儿再试。`, s);
}

/** Gist 的版本号：`history[0].version`（每次改动的提交号）；没有时用 `updated_at`。history 里每项的字段文档没写全（待求证），所以兜底。 */
function versionOf(raw: Record<string, unknown>): string {
  const history = Array.isArray(raw.history) ? (raw.history as unknown[]) : [];
  const first = history[0];
  const v = typeof first === "object" && first !== null ? (first as { version?: unknown }).version : undefined;
  if (typeof v === "string" && v !== "") return v;
  return typeof raw.updated_at === "string" ? raw.updated_at : "";
}

interface RawFile {
  filename?: unknown;
  content?: unknown;
  truncated?: unknown;
  raw_url?: unknown;
}

const fileEntries = (files: unknown): [string, RawFile][] =>
  typeof files === "object" && files !== null ? Object.entries(files as Record<string, RawFile | null>).filter((e): e is [string, RawFile] => e[1] !== null) : [];

/**
 * Gist 里的那篇：`prefer`（同步记录里的文件名）在就是它；不然是唯一的 .md 文件，或者唯一的文件。
 * 认不出来（好几个 .md、都不是记下的那个）是 null：猜一个会把正文写进别的文件。
 */
function pickFile(files: unknown, prefer?: string): [string, RawFile] | null {
  const entries = fileEntries(files);
  const preferred = entries.find(([name]) => name === prefer);
  if (preferred) return preferred;
  const md = entries.filter(([name]) => /\.md$/i.test(name));
  if (md.length === 1) return md[0];
  return entries.length === 1 ? entries[0] : null;
}

/** 超过 1MB 的文件取全文的地址：只认 GitHub 的 Gist 原文域名（https），别的地址不去连。 */
const RAW_HOST = "gist.githubusercontent.com";

function isRawUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === RAW_HOST;
  } catch {
    return false;
  }
}

const asObject = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

/**
 * 读 GitHub 时不能用缓存：GitHub 对 GET /gists/… 回 `Cache-Control: private, max-age=60`，浏览器（和系统的 HTTP 缓存）60 秒内会给旧的，
 * 同步就会把远端刚改过的当成没变、推上去盖掉（2026-11-25 线上实测）。两层都做：`cache: "no-store"`；再给地址加一个每次都不同的 `fresh` 参数，
 * 不认 `cache` 选项的宿主（nsh 测试宿主转发请求时就不带它）也拿不到旧的。不用 `Cache-Control` 请求头：api.github.com 的跨域预检不放行它（2026-11-25 用 OPTIONS 查过）。
 * GitHub 忽略不认识的查询参数（2026-11-25 实测：带不带 `fresh` 回同一个 ETag）。
 */
let freshCount = 0;
const freshUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}fresh=${Date.now()}-${++freshCount}`;
const NO_STORE = { cache: "no-store" } as const;

/** 用一个 token 访问 GitHub。`onUnauthorized`：GitHub 说 token 失效了（401），调用方借这个退出登录。 */
export function createGitHub(token: string, fetchFn: Fetch, onUnauthorized: () => void) {
  async function call(method: string, path: string, what: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      const url = `${GITHUB_API}${path}`;
      res = await fetchFn(method === "GET" ? freshUrl(url) : url, {
        method,
        ...NO_STORE,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      console.warn("github request failed", method, path, e instanceof Error ? e.message : String(e));
      throw new SyncError("network", "连不上 GitHub，检查网络后再同步。");
    }
    if (res.ok) return res;
    console.warn("github request failed", method, path, res.status);
    if (res.status === 401) onUnauthorized();
    throw errorFor(res, what);
  }

  async function json(res: Response): Promise<unknown> {
    try {
      return (await res.json()) as unknown;
    } catch (e) {
      console.warn("github response unreadable", e);
      throw new SyncError("invalid", "GitHub 回的内容读不懂，过一会儿再试。");
    }
  }

  /** 文件被截断（超过 1MB）时用 raw_url 取全文；raw_url 是私密 Gist 的公开直链，不带 token。地址里带着这份内容的哈希（/raw/<哈希>/文件名，2026-11-25 看过回包），同一个地址内容不变，所以只加 `no-store`、不加 `fresh`。 */
  async function fullText(file: RawFile): Promise<string> {
    const content = typeof file.content === "string" ? file.content : "";
    if (file.truncated !== true) return content;
    if (typeof file.raw_url !== "string" || !isRawUrl(file.raw_url)) throw new SyncError("invalid", "GitHub 上这篇太大，没给能用的全文地址，没法同步。");
    let res: Response;
    try {
      res = await fetchFn(file.raw_url, NO_STORE);
    } catch (e) {
      console.warn("gist raw download failed", e instanceof Error ? e.message : String(e));
      throw new SyncError("network", "连不上 GitHub，检查网络后再同步。");
    }
    if (!res.ok) {
      console.warn("gist raw download failed", res.status);
      throw errorFor(res, "这篇的全文");
    }
    return res.text();
  }

  async function toGist(raw: unknown, prefer?: string): Promise<Gist> {
    const g = asObject(raw);
    const picked = pickFile(g.files, prefer);
    if (typeof g.id !== "string") throw new SyncError("invalid", "GitHub 回的 Gist 读不懂，过一会儿再试。");
    if (!picked) {
      const many = fileEntries(g.files).length > 1;
      throw new SyncError("invalid", many ? "GitHub 上这个 Gist 里有好几个文件，认不出哪个是这篇，没有同步（GitHub 上的没动）。" : "GitHub 上这个 Gist 里没有文件，没法同步。");
    }
    return { id: g.id, description: typeof g.description === "string" ? g.description : "", fileName: picked[0], text: await fullText(picked[1]), version: versionOf(g) };
  }

  return {
    /** 登录的账号名。 */
    async user(): Promise<string> {
      const login = asObject(await json(await call("GET", "/user", "读取账号"))).login;
      if (typeof login !== "string") throw new SyncError("invalid", "GitHub 没告诉我们账号名，过一会儿再试。");
      return login;
    },

    /** 自己的 Gist 里 Pairdown 的那些。 */
    async listPairdownGists(): Promise<GistSummary[]> {
      const found: GistSummary[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const list = await json(await call("GET", `/gists?per_page=${PER_PAGE}&page=${page}`, "列出 Gist"));
        if (!Array.isArray(list)) throw new SyncError("invalid", "GitHub 回的 Gist 列表读不懂，过一会儿再试。");
        for (const item of list) {
          const g = asObject(item);
          // 列表只拿来显示名字和按文件名找：认不出是哪个文件时用第一个
          const picked = pickFile(g.files) ?? fileEntries(g.files)[0];
          if (typeof g.id === "string" && isPairdownGist(g.description as string | null) && picked) {
            found.push({ id: g.id, description: g.description as string, fileName: picked[0], updatedAt: typeof g.updated_at === "string" ? g.updated_at : "" });
          }
        }
        if (list.length < PER_PAGE) break;
      }
      return found;
    },

    /** 读一个 Gist；GitHub 上没有了（删了）是 null。`fileName`：同步记录里的文件名，Gist 里有好几个文件时认它。 */
    async getGist(id: string, fileName?: string): Promise<Gist | null> {
      try {
        return await toGist(await json(await call("GET", `/gists/${encodeURIComponent(id)}`, "这篇的 Gist")), fileName);
      } catch (e) {
        if (e instanceof SyncError && e.kind === "not-found") return null;
        throw e;
      }
    },

    /** 建一个私密 Gist：文件名取 `name`（按哪个名字起见 features/sync/engine.ts 的 `gistNameOf`），说明里写 `title`（列表里显示的名字）。 */
    async createGist(name: string, title: string, text: string): Promise<Gist> {
      const fileName = gistFileName(name);
      const body = { description: gistDescription(title), public: false, files: { [fileName]: { content: text } } };
      return toGist(await json(await call("POST", "/gists", "新建 Gist", body)), fileName);
    },

    /**
     * 改一个 Gist 的正文；文档改了名就把文件跟着改名。GitHub 上没有了是 null。
     * `remoteFileName` 必须是刚从 GitHub 读到的文件名（不是同步记录里的旧名字）：别处改过名时，用旧名字改会在 Gist 里多出一个文件。
     * 返回的是 PATCH 的回包（新版本号），调用方拿它当新基线，不再 GET 一次。
     * 读和写之间别处又改了，这次写会盖掉它：Gist 接口的文档没写条件写（If-Match），这个小窗口是「先读后写」固有的。
     */
    async updateGist(id: string, remoteFileName: string, name: string, title: string, text: string): Promise<Gist | null> {
      const fileName = gistFileName(name);
      const file = fileName === remoteFileName ? { content: text } : { filename: fileName, content: text };
      const body = { description: gistDescription(title), files: { [remoteFileName]: file } };
      try {
        return await toGist(await json(await call("PATCH", `/gists/${encodeURIComponent(id)}`, "这篇的 Gist", body)), fileName);
      } catch (e) {
        if (e instanceof SyncError && e.kind === "not-found") return null;
        throw e;
      }
    },
  };
}

export type GitHub = ReturnType<typeof createGitHub>;
