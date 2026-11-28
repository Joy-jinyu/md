import { isUtf8 } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { describeError, errno, GatewayError } from "./errors.mts";
import { sniffImage } from "./image.mts";
import { assetDirFor, assetPathFromSrc, extOf, foldName, resolveInLibrary, srcFromAssetPath } from "./paths.mts";
import { ASSET_DIR, HEAD_BYTES, IMAGE_TYPES, MAX_ASSET_BYTES, MAX_DOC_BYTES, type DocMeta, type ImageExt } from "./protocol.ts";

/** 文档的版本：内容的 SHA-256。内容不变版本就不变，和改动时间无关。 */
export function versionOf(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 列目录最多往下几层，防止目录太深时一直走。 */
const MAX_DEPTH = 16;

/** 网关自己的临时文件以 . 开头：列表、监听、路径检查都不认隐藏文件，页面看不到它们。 */
const tempName = (abs: string) => join(dirname(abs), `.pairdown-${randomBytes(6).toString("hex")}.tmp`);
const TEMP_RE = /^\.pairdown-[0-9a-f]{12}\.tmp$/;

/** ignoreBOM：保留开头的 BOM，原样读出、原样写回，字节不变。 */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** 给 list 的 head 用：和上面不同，开头的 BOM 会被去掉。 */
const headUtf8 = new TextDecoder("utf-8", { fatal: true });

async function unlinkQuiet(p: string): Promise<void> {
  try {
    await unlink(p);
  } catch (e) {
    if (errno(e) !== "ENOENT") throw e;
  }
}

/**
 * 先写同目录的临时文件并落盘，再改名到目标：中途断电不会留下写了一半的文件。
 * exclusive 时用硬链接代替改名，目标已存在就失败（EEXIST），不覆盖。
 */
async function writeAtomic(abs: string, data: Uint8Array | string, exclusive: boolean): Promise<void> {
  const tmp = tempName(abs);
  const fh = await open(tmp, "wx");
  try {
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (exclusive) await link(tmp, abs);
    else await rename(tmp, abs);
  } finally {
    await unlinkQuiet(tmp);
  }
}

/** 清掉上次没走完（进程被杀、断电）留下的临时文件。不跟符号链接，不进隐藏目录；出错只记日志。 */
async function sweepTemp(dir: string, depth: number, log: (s: string) => void): Promise<void> {
  if (depth > MAX_DEPTH) return;
  try {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (d.isFile() && TEMP_RE.test(d.name)) await unlinkQuiet(join(dir, d.name));
      else if (d.isDirectory() && !d.name.startsWith(".")) await sweepTemp(join(dir, d.name), depth + 1, log);
    }
  } catch (e) {
    log(`清理临时文件时跳过一个目录：${describeError(e)}`);
  }
}

const notFound = (rel: string) => new GatewayError("not-found", `找不到：${rel}`);
const docTooLarge = () => new GatewayError("too-large", `文档超过 ${MAX_DOC_BYTES / 1024 / 1024} MiB`);

/** 把 node 的文件错误换成协议错误码；不认识的原样抛出，由 server 记成 internal。 */
function mapFsError(e: unknown, rel: string): never {
  const code = errno(e);
  if (code === "ENOENT" || code === "ENOTDIR") throw notFound(rel);
  if (code === "EISDIR" || code === "EPERM") throw new GatewayError("bad-path", `不是文件：${rel}`);
  if (code === "EEXIST") throw new GatewayError("exists", `已存在：${rel}`);
  throw e;
}

/** 建上级目录；路径里有一级是文件时 mkdir 报 EEXIST / ENOTDIR，这不是「目标已存在」，回 bad-path。 */
async function mkdirParent(abs: string, rel: string): Promise<void> {
  try {
    await mkdir(dirname(abs), { recursive: true });
  } catch (e) {
    const code = errno(e);
    if (code === "EEXIST" || code === "ENOTDIR") throw new GatewayError("bad-path", `上级不是文件夹：${rel}`);
    mapFsError(e, rel);
  }
}

async function readBytes(abs: string, rel: string): Promise<Buffer> {
  try {
    return await readFile(abs);
  } catch (e) {
    mapFsError(e, rel);
  }
}

/** 读文档字节，超过 MAX_DOC_BYTES 不读。 */
async function readDocBytes(abs: string, rel: string): Promise<Buffer> {
  const s = await stat(abs).catch((e) => mapFsError(e, rel));
  if (!s.isFile()) throw new GatewayError("bad-path", `不是文件：${rel}`);
  if (s.size > MAX_DOC_BYTES) throw docTooLarge();
  const bytes = await readBytes(abs, rel);
  if (bytes.byteLength > MAX_DOC_BYTES) throw docTooLarge();
  return bytes;
}

function decodeDoc(bytes: Uint8Array, rel: string): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new GatewayError("not-utf8", `不是 UTF-8 编码，不能编辑：${rel}`);
  }
}

function encodeDoc(text: string): Buffer {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.byteLength > MAX_DOC_BYTES) throw docTooLarge();
  return bytes;
}

/** 不限大小地算文件的版本（边读边算）：给 changed 事件和 remove 的比对用，大文档也要有版本。 */
async function hashFile(abs: string, rel: string): Promise<string> {
  const h = createHash("sha256");
  try {
    for await (const chunk of createReadStream(abs)) h.update(chunk as Buffer);
  } catch (e) {
    mapFsError(e, rel);
  }
  return h.digest("hex");
}

/** 末尾半个多字节字符（被字节上限截断的）去掉。 */
function wholeChars(bytes: Uint8Array): Uint8Array {
  let i = bytes.length - 1;
  while (i >= 0 && bytes.length - i <= 3 && (bytes[i] & 0xc0) === 0x80) i--;
  if (i < 0) return bytes;
  const lead = bytes[i];
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return bytes.length - i < need ? bytes.subarray(0, i) : bytes;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await lstat(abs);
    return true;
  } catch (e) {
    if (errno(e) === "ENOENT") return false;
    throw e;
  }
}

/** 文库：一个文件夹，里面的 .md 是文档，`assets/` 里是图片。所有路径都过 resolveInLibrary。 */
export class Library {
  readonly root: string;
  private readonly log: (s: string) => void;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(root: string, log: (s: string) => void) {
    this.root = root;
    this.log = log;
  }

  /** dir 必须是已存在的文件夹；之后都按它的真实路径比对。打开时顺手清掉上次残留的临时文件。 */
  static async open(dir: string, log: (s: string) => void = (s) => console.error(s)): Promise<Library> {
    const root = await realpath(dir);
    if (!(await stat(root)).isDirectory()) throw new Error(`不是文件夹：${dir}`);
    await sweepTemp(root, 0, log);
    return new Library(root, log);
  }

  get name(): string {
    return basename(this.root);
  }

  /** 改动文件的操作排成一队，网关自己的读 - 比对 - 写之间不会互相插队。 */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<DocMeta[]> {
    const out: DocMeta[] = [];
    await this.walk("", 0, out);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** 不跟符号链接，不进隐藏目录和 assets/。读不了的子目录、遍历中途消失的文件跳过并记日志。 */
  private async walk(rel: string, depth: number, out: DocMeta[]): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(join(this.root, rel), { withFileTypes: true });
    } catch (e) {
      if (rel === "") throw e;
      this.log(`列文档时跳过目录 ${rel}：${describeError(e)}`);
      return;
    }
    for (const d of entries) {
      if (d.name.startsWith(".")) continue;
      const child = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory() && foldName(d.name) !== ASSET_DIR) await this.walk(child, depth + 1, out);
      else if (d.isFile() && extOf(d.name) === "md") {
        const meta = await this.meta(child);
        if (meta) out.push(meta);
      }
    }
  }

  /** 列表里的一项；超过上限或不是 UTF-8 的标上 problem，能编辑的带上 head。读不了返回 null。 */
  private async meta(child: string): Promise<DocMeta | null> {
    const abs = join(this.root, child);
    try {
      const s = await stat(abs);
      const base = { path: child, size: s.size, mtimeMs: Math.floor(s.mtimeMs) };
      if (s.size > MAX_DOC_BYTES) return { ...base, problem: "too-large" };
      const bytes = await readFile(abs);
      if (!isUtf8(bytes)) return { ...base, problem: "not-utf8" };
      return { ...base, head: headUtf8.decode(wholeChars(bytes.subarray(0, HEAD_BYTES))) };
    } catch (e) {
      this.log(`列文档时跳过 ${child}：${describeError(e)}`);
      return null;
    }
  }

  async read(rel: unknown): Promise<{ text: string; version: string }> {
    const abs = await resolveInLibrary(this.root, rel, "doc");
    const bytes = await readDocBytes(abs, String(rel));
    return { text: decodeDoc(bytes, String(rel)), version: versionOf(bytes) };
  }

  /** 当前版本，文件不在（或路径已经不合规）时为 null。给 changed 事件用；不是 UTF-8、太大的文档也有版本。 */
  async versionIfExists(rel: string): Promise<string | null> {
    try {
      return await hashFile(await resolveInLibrary(this.root, rel, "doc"), rel);
    } catch (e) {
      if (e instanceof GatewayError) return null;
      throw e;
    }
  }

  /** 符号链接文档写到它指向的文件上（resolveInLibrary 已经查过指向的位置），链接本身保留。 */
  write(rel: unknown, text: string, baseVersion: string): Promise<{ version: string }> {
    return this.serial(async () => {
      const bytes = encodeDoc(text);
      const abs = await resolveInLibrary(this.root, rel, "doc");
      const current = await readDocBytes(abs, String(rel));
      decodeDoc(current, String(rel));
      const version = versionOf(current);
      if (version !== baseVersion) throw new GatewayError("conflict", "文件在别处改过了", version);
      const target = await realpath(abs).catch((e) => mapFsError(e, String(rel)));
      await writeAtomic(target, bytes, false).catch((e) => mapFsError(e, String(rel)));
      return { version: versionOf(bytes) };
    });
  }

  create(rel: unknown, text = ""): Promise<{ version: string }> {
    return this.serial(async () => {
      const bytes = encodeDoc(text);
      const abs = await resolveInLibrary(this.root, rel, "doc");
      await mkdirParent(abs, String(rel));
      await writeAtomic(abs, bytes, true).catch((e) => mapFsError(e, String(rel)));
      return { version: versionOf(bytes) };
    });
  }

  rename(rel: unknown, to: unknown): Promise<void> {
    return this.serial(async () => {
      const from = await resolveInLibrary(this.root, rel, "doc");
      const dest = await resolveInLibrary(this.root, to, "doc");
      try {
        const src = await lstat(from);
        if (!src.isFile()) throw new GatewayError("bad-path", `不是文件：${String(rel)}`);
        // macOS 默认不分大小写：只改大小写时目标「已存在」且就是它自己。
        // 同一个 inode 但名字折叠后不同，是硬链接：照样算已存在（rename 对同一文件的两个硬链接什么都不做）
        const d = await lstat(dest).catch(() => null);
        const sameEntry = d !== null && d.ino === src.ino && d.dev === src.dev && foldName(from) === foldName(dest);
        if (d !== null && !sameEntry) throw new GatewayError("exists", `已存在：${String(to)}`);
        await mkdirParent(dest, String(to));
        await rename(from, dest);
      } catch (e) {
        if (e instanceof GatewayError) throw e;
        mapFsError(e, String(rel));
      }
    });
  }

  remove(rel: unknown, baseVersion?: string): Promise<void> {
    return this.serial(async () => {
      const abs = await resolveInLibrary(this.root, rel, "doc");
      if (baseVersion !== undefined) {
        const current = await hashFile(abs, String(rel));
        if (current !== baseVersion) throw new GatewayError("conflict", "文件在别处改过了", current);
      }
      await unlink(abs).catch((e) => mapFsError(e, String(rel)));
    });
  }

  /** 存图片：文件名是内容哈希，已有同一张就直接返回它。 */
  putAsset(doc: string | undefined, bytes: Uint8Array): Promise<{ path: string; src: string; existed: boolean }> {
    if (bytes.byteLength > MAX_ASSET_BYTES) return Promise.reject(new GatewayError("too-large", "图片超过 10 MiB"));
    const ext = sniffImage(bytes);
    if (!ext) return Promise.reject(new GatewayError("bad-type", "不是认得的图片（png、jpg、gif、webp、avif）"));
    return this.serial(async () => {
      const path = `${assetDirFor(doc)}/${versionOf(bytes).slice(0, 16)}.${ext}`;
      const abs = await resolveInLibrary(this.root, path, "asset");
      let existed = await exists(abs);
      if (!existed) {
        await mkdirParent(abs, path);
        existed = await writeAtomic(abs, bytes, true).then(() => false, (e) => (errno(e) === "EEXIST" ? true : Promise.reject(e)));
      }
      return { path, src: srcFromAssetPath(doc, path), existed };
    });
  }

  async getAsset(doc: string | undefined, src: unknown): Promise<{ path: string; mime: string; bytes: Buffer }> {
    const path = assetPathFromSrc(doc, src);
    const abs = await resolveInLibrary(this.root, path, "asset");
    const s = await stat(abs).catch((e) => mapFsError(e, path));
    if (!s.isFile()) throw new GatewayError("bad-path", `不是文件：${path}`);
    if (s.size > MAX_ASSET_BYTES) throw new GatewayError("too-large", "图片超过 10 MiB");
    return { path, mime: IMAGE_TYPES[extOf(path) as ImageExt], bytes: await readBytes(abs, path) };
  }
}
