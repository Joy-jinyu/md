/** 图床：把图片传到用户配的上传接口（multipart/form-data），从返回的 JSON 里取图片地址。配置在 config.json 的 imageHost 里，请求头（可能是密钥）不回给页面、不进日志。 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { GatewayError } from "./errors.mts";
import { sniffImage } from "./image.mts";
import { IMAGE_TYPES, MAX_ASSET_BYTES, type ImageHostSettings, type ImageHostView } from "./protocol.ts";

export type ImageHost = ImageHostSettings & { headers: Record<string, string> };

/** urlPath 留空时依次试这些位置：常见图床（兰空、sm.ms、PicGo server 等）的返回格式。 */
const AUTO_PATHS = ["url", "data.url", "data.links.url", "result.0", "data.0"];
/** 等图床多久：比页面等网关的 25 秒（gateway-store.ts 的 TRANSFER_MS）短，页面才收得到原因。 */
const UPLOAD_TIMEOUT_MS = 20_000;
/** 图床的返回最多读多少字节：只是一小段 JSON。 */
const MAX_REPLY_BYTES = 1024 * 1024;
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;
const FIELD = /^[^\s"\\]{1,100}$/;
const HTTP_URL = /^https?:\/\//i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function httpUrl(text: unknown): string | null {
  if (typeof text !== "string" || !HTTP_URL.test(text.trim()) || /\s/.test(text.trim()) || !URL.canParse(text.trim())) return null;
  return text.trim();
}

function parseHeaders(raw: unknown): Record<string, string> {
  if (!isObj(raw)) throw new GatewayError("bad-request", "headers 要是「名字: 值」的对象");
  for (const [name, value] of Object.entries(raw)) {
    if (!HEADER_NAME.test(name) || typeof value !== "string" || /[\r\n]/.test(value)) throw new GatewayError("bad-request", `请求头不合法：${name}`);
  }
  return raw as Record<string, string>;
}

/** 检查一份图床配置（页面发来的、命令行填的、config.json 里读的）。没给 headers 时沿用 `old` 的。 */
export function parseImageHost(raw: unknown, old: ImageHost | null): ImageHost {
  if (!isObj(raw)) throw new GatewayError("bad-request", "图床配置不是对象");
  const url = httpUrl(raw.url);
  if (!url) throw new GatewayError("bad-url", "上传地址要是 http:// 或 https:// 开头的地址");
  const field = raw.field === undefined || raw.field === "" ? "file" : raw.field;
  if (typeof field !== "string" || !FIELD.test(field)) throw new GatewayError("bad-request", "文件字段名不合法");
  const urlPath = raw.urlPath ?? "";
  if (typeof urlPath !== "string" || urlPath.length > 200) throw new GatewayError("bad-request", "图片地址的位置不合法");
  return { url, field, urlPath: urlPath.trim(), headers: raw.headers === undefined ? (old?.headers ?? {}) : parseHeaders(raw.headers) };
}

export const viewOf = (host: ImageHost): ImageHostView => ({ url: host.url, field: host.field, urlPath: host.urlPath, headerNames: Object.keys(host.headers) });

async function readConfig(configPath: string): Promise<Obj> {
  const text = await readFile(configPath, "utf8").catch(() => "");
  const parsed: unknown = text.trim() === "" ? {} : JSON.parse(text);
  return isObj(parsed) ? parsed : {};
}

/** 现在的图床配置；没设置、或 config.json 里那份不合规，是 null。 */
export async function readImageHost(configPath: string): Promise<ImageHost | null> {
  const { imageHost } = await readConfig(configPath);
  if (imageHost === undefined) return null;
  try {
    return parseImageHost(imageHost, null);
  } catch {
    return null;
  }
}

/** 存（null 是清掉）。config.json 里别的项不动；文件只有自己能读（请求头里可能是密钥）。 */
export async function writeImageHost(configPath: string, host: ImageHost | null): Promise<void> {
  const { imageHost: _old, ...rest } = await readConfig(configPath);
  await mkdir(dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(host ? { ...rest, imageHost: host } : rest, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, configPath);
}

const dig = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((v, key) => (Array.isArray(v) ? v[Number(key)] : isObj(v) ? v[key] : undefined), value);

/** 从图床的返回里取图片地址：给了位置只看那里，没给就挨个试常见位置。 */
function urlIn(reply: unknown, urlPath: string): string | null {
  for (const path of urlPath === "" ? AUTO_PATHS : [urlPath]) {
    const url = httpUrl(dig(reply, path));
    if (url) return url;
  }
  return null;
}

async function replyJson(res: Response): Promise<unknown> {
  const text = new TextDecoder().decode((await res.arrayBuffer()).slice(0, MAX_REPLY_BYTES));
  try {
    return JSON.parse(text);
  } catch {
    // 有的图床直接回一行地址
    return { url: text.trim() };
  }
}

/** 传一张图，返回图床给的地址。文件名用内容哈希：同一张图名字一样，不带用户机器上的文件名。 */
export async function uploadImage(host: ImageHost, bytes: Buffer<ArrayBuffer>, fetchFn: typeof fetch = fetch): Promise<string> {
  if (bytes.length > MAX_ASSET_BYTES) throw new GatewayError("too-large", "图片超过 10 MiB");
  const ext = sniffImage(bytes);
  if (!ext) throw new GatewayError("bad-type", "不是认得的图片");
  const form = new FormData();
  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${ext}`;
  form.append(host.field, new Blob([bytes], { type: IMAGE_TYPES[ext] }), name);
  let res: Response;
  try {
    res = await fetchFn(host.url, { method: "POST", body: form, headers: host.headers, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  } catch {
    throw new GatewayError("upload-failed", "连不上图床，或者它太久没回");
  }
  if (!res.ok) throw new GatewayError("upload-failed", `图床回的是 ${res.status}`);
  const url = urlIn(await replyJson(res), host.urlPath);
  if (!url) throw new GatewayError("upload-failed", "图床回了成功，但返回里没找到图片地址（检查「图片地址的位置」）");
  return url;
}
