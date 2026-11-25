/** 图床表单填的字 → 要交给网关的配置（ImageHostInput）；不合法返回给人看的原因。表单见 ImageHostForm.tsx。 */
import type { ImageHostInput, ImageHostView } from "../../store/document-store";

export type HostKind = "upload" | "github";

/** 表单里的字，两种的都留着（来回切种类不丢）。 */
export interface HostDraft {
  url: string;
  field: string;
  headers: string;
  urlPath: string;
  repo: string;
  branch: string;
  dir: string;
  token: string;
}

const HTTP_URL = /^https?:\/\/[^\s/]+\S*$/i;
/** HTTP 头的名字能用的字符（RFC 9110 的 token）。 */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;

export const kindOf = (host: ImageHostView | null): HostKind => (host?.kind === "github" ? "github" : "upload");

/** 现在的配置填进表单；没有的项用默认值。密钥（请求头的值、令牌）页面读不回，一律空着。 */
export function draftOf(host: ImageHostView | null): HostDraft {
  const draft = { url: "", field: "file", headers: "", urlPath: "", repo: "", branch: "main", dir: "images", token: "" };
  if (!host) return draft;
  return host.kind === "github" ? { ...draft, repo: host.repo, branch: host.branch, dir: host.dir } : { ...draft, url: host.url, field: host.field, urlPath: host.urlPath };
}

/** 请求头一行一个「名字：值」；空行跳过。写法不对返回给人看的原因。 */
function parseHeaders(text: string): Record<string, string> | string {
  const headers: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim() : "";
    if (!HEADER_NAME.test(name)) return `第 ${i + 1} 行的请求头写法不对，要写成「名字：值」`;
    headers[name] = line.slice(colon + 1).trim();
  }
  return headers;
}

/** 请求头留空：现在就是上传接口时不改（不传 headers），新设置、换种类时是没有请求头。 */
function uploadInput(d: HostDraft, current: ImageHostView | null): ImageHostInput | string {
  const url = d.url.trim();
  if (!HTTP_URL.test(url)) return "上传地址要是 http:// 或 https:// 开头的完整地址";
  const base = { kind: "upload" as const, url, field: d.field.trim() || "file", urlPath: d.urlPath.trim() };
  if (d.headers.trim() === "") return current && current.kind !== "github" ? base : { ...base, headers: {} };
  const parsed = parseHeaders(d.headers);
  return typeof parsed === "string" ? parsed : { ...base, headers: parsed };
}

/** 令牌留空：现在就是 GitHub 且有令牌时不改（不传 token），新设置、换种类时必填。 */
function githubInput(d: HostDraft, current: ImageHostView | null): ImageHostInput | string {
  const repo = d.repo.trim();
  if (!REPO.test(repo)) return "仓库要写成「用户/仓库」，比如 octocat/images";
  const base = { kind: "github" as const, repo, branch: d.branch.trim() || "main", dir: d.dir.trim().replace(/^\/+|\/+$/g, "") || "images" };
  const token = d.token.trim();
  if (token) return { ...base, token };
  return current?.kind === "github" && current.hasToken ? base : "要填令牌（GitHub 的 personal access token）";
}

export const toInput = (kind: HostKind, d: HostDraft, current: ImageHostView | null) => (kind === "github" ? githubInput(d, current) : uploadInput(d, current));
