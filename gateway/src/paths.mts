import { realpath } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import { errno, GatewayError } from "./errors.mts";
import { ASSET_DIR, IMAGE_TYPES } from "./protocol.ts";

/** doc：文库里的 .md 文档；asset：某个 assets/ 目录下的图片。 */
export type PathKind = "doc" | "asset";

const MAX_PATH_CHARS = 1024;

const bad = (why: string) => new GatewayError("bad-path", `路径不合规：${why}`);

/** 扩展名（小写，不带点），没有为 ""。 */
export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * 比较文件名用：macOS 默认不分大小写，而且按 Unicode 折叠（实测 `aſsets` 打开的就是 `assets`），
 * 只 toLowerCase 挡不住，先 NFKC（ſ → s、K → K）再转小写。
 */
export function foldName(name: string): string {
  return name.normalize("NFKC").toLowerCase();
}

/**
 * 只看字符串的检查：相对路径、/ 分隔、没有空段 / . / ..、不碰隐藏文件（也挡住 .git 和网关自己的临时文件），
 * 文档必须是 .md 且不在 assets/ 里，图片必须直接放在某个 assets/ 下且是认得的图片扩展名。返回路径分段。
 */
export function checkRelative(rel: unknown, kind: PathKind): string[] {
  if (typeof rel !== "string" || rel.length === 0) throw bad("空");
  if (rel.length > MAX_PATH_CHARS) throw bad("太长");
  if (rel.includes("\0") || rel.includes("\\")) throw bad("含有 NUL 或反斜杠");
  if (rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) throw bad("不能是绝对路径");
  const segs = rel.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === "..") throw bad("含有空段、. 或 ..");
    if (s.startsWith(".")) throw bad("不能是隐藏文件或目录");
  }
  const name = segs[segs.length - 1];
  const dirs = segs.slice(0, -1).map(foldName);
  if (kind === "doc") {
    if (extOf(name) !== "md") throw bad("文档必须是 .md");
    if (dirs.includes(ASSET_DIR)) throw bad(`文档不能放在 ${ASSET_DIR}/ 里`);
  } else {
    if (dirs[dirs.length - 1] !== ASSET_DIR) throw bad(`图片必须在 ${ASSET_DIR}/ 下`);
    if (!(extOf(name) in IMAGE_TYPES)) throw bad("不是认得的图片类型");
  }
  return segs;
}

const inside = (root: string, p: string) => p === root || p.startsWith(root + sep);

/** abs 解开符号链接后的真实路径：已存在的那几级用 realpath（也拿到磁盘上真实的大小写），还不存在的几级原样接上。 */
async function realLocation(root: string, abs: string): Promise<string> {
  for (let p = abs; inside(root, p); p = dirname(p)) {
    try {
      return join(await realpath(p), relative(p, abs));
    } catch (e) {
      if (errno(e) !== "ENOENT" && errno(e) !== "ENOTDIR") throw e;
    }
  }
  return abs;
}

/**
 * 所有文件操作的唯一入口：把页面给的相对路径变成绝对路径，保证它落在文库里。
 * root 必须是文库的真实路径（realpath 过）。目标或它的上级是符号链接时，按解开后的真实位置再查一遍：
 * 跳出文库、指向隐藏文件、指向别的类型的文件（文档链到 .txt、图片链到 .git/config）都拒绝。
 * 返回的是链接本身的路径（改名、删除动的是链接），要写内容时调用方自己 realpath。
 * 检查和真正读写之间不加锁：本机别的程序在这期间换掉符号链接不在防护范围内。
 */
export async function resolveInLibrary(root: string, rel: unknown, kind: PathKind): Promise<string> {
  const abs = join(root, ...checkRelative(rel, kind));
  if (!inside(root, abs) || abs === root) throw bad("跳出文库");
  const real = await realLocation(root, abs);
  if (real === abs) return abs;
  if (!inside(root, real) || real === root) throw bad("经符号链接跳出文库");
  try {
    checkRelative(relative(root, real).split(sep).join("/"), kind);
  } catch {
    throw bad("符号链接指向的不是文库里合规的位置");
  }
  return abs;
}

/** 正文里的图片地址（相对 doc 所在目录；没有 doc 时相对文库根目录）→ 文库内相对路径。不碰文件系统。 */
export function assetPathFromSrc(doc: string | undefined, src: unknown): string {
  if (doc !== undefined) checkRelative(doc, "doc");
  if (typeof src !== "string" || src.length === 0) throw bad("空");
  if (src.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) throw bad("不能是绝对路径或网址");
  const base = doc === undefined ? "" : posix.dirname(doc);
  const p = posix.normalize(posix.join(base === "." ? "" : base, src));
  if (p === ".." || p.startsWith("../")) throw bad("跳出文库");
  checkRelative(p, "asset");
  return p;
}

/** 文库内的图片路径 → 写进 doc 正文的相对地址。 */
export function srcFromAssetPath(doc: string | undefined, path: string): string {
  if (doc === undefined) return path;
  const dir = posix.dirname(doc);
  return dir === "." ? path : posix.relative(dir, path);
}

/** doc 旁边的图片目录（文库内相对路径）。 */
export function assetDirFor(doc: string | undefined): string {
  if (doc === undefined) return ASSET_DIR;
  checkRelative(doc, "doc");
  const dir = posix.dirname(doc);
  return dir === "." ? ASSET_DIR : `${dir}/${ASSET_DIR}`;
}
