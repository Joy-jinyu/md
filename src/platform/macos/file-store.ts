/**
 * macOS 的文库文件夹（实施计划 10.2）：`~/Documents/Pairdown` 里（含子文件夹）的每个 .md / .markdown 文件是一篇，id 是文库内的相对路径。
 * 版本是内容的 SHA-256：只要内容变了就变，和改动时间无关（别的程序改了文件、时间和大小都没变也能发现），和网关一样。
 * 写入先写同目录下的临时文件再改名盖过去：rename 在同一个文件系统里是原子的，中途断电不留半个文件。
 * nsh 0.6.0 没有监听文件的接口，外面改了靠窗口重新获得焦点时比对（编辑页的 checkExternal）。
 * 要 nsh.json 的 `capabilities.fs` 给这个文件夹读写、`capabilities.homeDir` 给出用户目录。
 */
import { t } from "../../i18n";
import { cleanFileStem, dirOf, stemOf as stemWith } from "../../doc/file-name";
import { ASSET_DIR } from "../../../gateway/src/protocol";
import { type DocMeta, type DocProblem, type DocumentStore, NameTaken, type ReadResult, type WriteResult } from "../../store/document-store";
import { AssetRejected, assetName, assetPathFromSrc, assetSrc, checkImage, mimeOf, sniffImage } from "../../store/image-file";

/** 给人看的文库位置。 */
export const LIBRARY_FOLDER = "~/Documents/Pairdown";

/** nsh 一次最多写 8 MiB（fs.writeFile 的上限，2026-11-25 实测超了报 ERR_OUT_OF_RANGE）：更大的文件读进来也存不回去，不打开。 */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** 往子文件夹里找 .md 最多找几层：防止链接环、巨大的目录树拖住启动。 */
const MAX_DEPTH = 6;

type Fs = typeof import("fs/promises");
const fsModule = (): Promise<Fs> => import("fs/promises");

let rootPath: string | null = null;

/** 文库的绝对路径。用户目录要 `capabilities.homeDir`。 */
export async function libraryRoot(): Promise<string> {
  rootPath ??= `${(await import("os")).homedir()}/Documents/Pairdown`;
  return rootPath;
}

const codeOf = (e: unknown) => (typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined);

/** 文库认的扩展名：和 nsh.json 的 fileTypes 一致，「打开方式」交来的 .markdown 也能原地编辑。 */
const DOC_EXT = /\.(md|markdown)$/i;
/** 写入时的临时文件名（点开头，列表里看不见）。 */
const TEMP_FILE = /^\.pairdown-[0-9a-f-]+\.tmp$/;

/** 文库里一篇的 id 合不合规：相对路径、`/` 分隔、不含 `..` 和空段、不碰隐藏文件、以 .md / .markdown 结尾。不合规抛错。 */
export function checkId(id: string): void {
  const parts = id.split("/");
  const bad = id === "" || id.includes("\\") || id.includes("\u0000") || !DOC_EXT.test(id) || parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith("."));
  if (bad) throw new Error(t(`文档路径不对：${id}`, `Invalid document path: ${id}`));
}

const baseOf = (id: string) => id.slice(id.lastIndexOf("/") + 1);
const stemOf = (id: string) => stemWith(id, DOC_EXT);
const extOf = (id: string) => DOC_EXT.exec(id)?.[0] ?? ".md";
const hashOf = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const bytesOf = (text: string) => new TextEncoder().encode(text).length;
/** BOM 原样留在文字里（写回时原样写出去）；不是合法 UTF-8 时抛错，不按替换字符硬读（存回去会把原文写坏）。 */
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** 字节 → 文字；不是 UTF-8 是 null。 */
function decode(bytes: Uint8Array): string | null {
  try {
    // 测试替身给的字节过桥后是普通数组（nsh 的测试桥只留数据，2026-11-25 实测），转回来；真机上本来就是 Uint8Array
    return utf8.decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
}

function metaOf(id: string, size: number, updatedAt: number, version: string, problem?: DocProblem): DocMeta {
  const meta: DocMeta = { id, name: stemOf(id), title: "", updatedAt, version, size };
  return problem ? { ...meta, problem } : meta;
}

/** stat 的 mode 里的文件类型位（POSIX S_IFMT / S_IFDIR / S_IFREG）。不用 Stats 的 isDirectory()：只看数据，测试的替身也能给。 */
const S_IFMT = 0o170000;
const isDir = (mode: number) => (mode & S_IFMT) === 0o040000;
const isFile = (mode: number) => (mode & S_IFMT) === 0o100000;

/** `sweep`：顺手删掉上次写到一半留下的临时文件（应用启动后第一次列表时）。 */
async function walk(fs: Fs, root: string, rel: string, depth: number, out: string[], sweep: boolean) {
  for (const name of await fs.readdir(rel ? `${root}/${rel}` : root)) {
    const path = rel ? `${rel}/${name}` : name;
    if (sweep && TEMP_FILE.test(name)) await fs.unlink(`${root}/${path}`).catch((e: unknown) => console.warn("old temp file not removed", path, e));
    if (name.startsWith(".")) continue;
    try {
      const { mode } = await fs.stat(`${root}/${path}`);
      if (isDir(mode) && depth < MAX_DEPTH) await walk(fs, root, path, depth + 1, out, sweep);
      else if (isFile(mode) && DOC_EXT.test(name)) out.push(path);
    } catch (e) {
      // 链接指到文库外、读不了的子文件夹：跳过它，不挡住整个列表
      console.warn("library entry skipped", path, e);
    }
  }
}

/** 每个文件上次判出的编码问题，按改动时间和大小认：没变就不再整篇读一遍。 */
const encodingSeen = new Map<string, { mtimeMs: number; size: number; problem?: DocProblem }>();

async function encodingProblem(fs: Fs, path: string, mtimeMs: number, size: number): Promise<DocProblem | undefined> {
  const seen = encodingSeen.get(path);
  if (seen && seen.mtimeMs === mtimeMs && seen.size === size) return seen.problem;
  const problem = decode(await fs.readFile(path)) === null ? ("not-utf8" as const) : undefined;
  encodingSeen.set(path, problem ? { mtimeMs, size, problem } : { mtimeMs, size });
  return problem;
}

/** 列表里的一项：太大的、不是 UTF-8 的标上 problem（照样列出来，不能打开）。读不了的返回 null。 */
async function describe(fs: Fs, root: string, id: string): Promise<DocMeta | null> {
  try {
    const stat = await fs.stat(`${root}/${id}`);
    if (stat.size > MAX_FILE_BYTES) return metaOf(id, stat.size, stat.mtimeMs, "", "too-large");
    return metaOf(id, stat.size, stat.mtimeMs, "", await encodingProblem(fs, `${root}/${id}`, stat.mtimeMs, stat.size));
  } catch (e) {
    console.warn("library file skipped", id, e);
    return null;
  }
}

/** 读一篇的原文；没有是 null。太大、不是 UTF-8 抛给人看的错。 */
async function readText(fs: Fs, root: string, id: string): Promise<string | null> {
  checkId(id);
  const path = `${root}/${id}`;
  if (!(await fs.exists(path))) return null;
  try {
    if ((await fs.stat(path)).size > MAX_FILE_BYTES) throw new Error(t(`「${id}」超过 8 MB，应用存不回去，所以不打开`, `“${id}” exceeds 8 MB. Pairdown cannot save it back, so it was not opened.`));
    const text = decode(await fs.readFile(path));
    if (text === null) throw new Error(t(`「${id}」不是 UTF-8 编码的文本，打不开（先用别的工具转成 UTF-8）`, `“${id}” is not UTF-8 text. Convert it to UTF-8 before opening it.`));
    return text;
  } catch (e) {
    if (codeOf(e) === "ENOENT") return null;
    throw e;
  }
}

/**
 * 先写同目录下的临时文件（点开头，列表里看不见），再改名盖过去；中途失败删掉临时文件。
 * `before`：改名前最后再查一次（新建时查目标还空着）。nsh 的 fs 没有独占创建（`wx`）和硬链接，只能把查和改名挨得尽量近。
 */
async function writeAtomic(fs: Fs, path: string, data: string | Uint8Array, before?: () => Promise<void>) {
  if ((typeof data === "string" ? bytesOf(data) : data.length) > MAX_FILE_BYTES) throw new Error(t("这篇超过 8 MB，应用一次写不进去。拆成几篇再存", "This document exceeds 8 MB. Split it into smaller documents to save it."));
  const temp = `${dirOf(path)}.pairdown-${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data);
    await before?.();
    await fs.rename(temp, path);
  } catch (e) {
    if (await fs.exists(temp).catch(() => false)) await fs.unlink(temp).catch((err: unknown) => console.warn("temp file left behind", err));
    throw e;
  }
}

async function written(fs: Fs, root: string, id: string, text: string): Promise<DocMeta> {
  const stat = await fs.stat(`${root}/${id}`);
  return metaOf(id, stat.size, stat.mtimeMs, hashOf(text));
}

/**
 * 目标名字空着才行。只改大小写时（访达默认不分大小写）`exists` 查到的可能就是它自己：
 * nsh 的 stat 不给 inode，改看文件夹里有没有一个名字一字不差的别的文件。
 */
async function freeTarget(fs: Fs, root: string, id: string, from?: string) {
  const taken = () => new NameTaken(t(`文库里已经有「${id}」了`, `The library already contains “${id}”`), id);
  if (from === undefined || from.toLowerCase() !== id.toLowerCase()) {
    if (await fs.exists(`${root}/${id}`)) throw taken();
    return;
  }
  const dir = dirOf(id) ? `${root}/${dirOf(id).slice(0, -1)}` : root;
  if ((await fs.readdir(dir)).includes(baseOf(id))) throw taken();
}

let swept = false;

async function listLibrary(fs: Fs, root: string): Promise<DocMeta[]> {
  const ids: string[] = [];
  await walk(fs, root, "", 0, ids, !swept);
  swept = true;
  return (await Promise.all(ids.map((id) => describe(fs, root, id)))).filter((m): m is DocMeta => m !== null);
}

export function createFileStore(): DocumentStore {
  const ready = async () => {
    const [fs, root] = await Promise.all([fsModule(), libraryRoot()]);
    await fs.mkdir(root, { recursive: true });
    return { fs, root };
  };
  const fileName = (dir: string, name: string, ext = ".md") => `${dir}${cleanFileStem(name) || "未命名"}${ext}`;
  return {
    async list() {
      const { fs, root } = await ready();
      return listLibrary(fs, root);
    },
    async read(id): Promise<ReadResult | null> {
      const { fs, root } = await ready();
      const text = await readText(fs, root, id);
      return text === null ? null : { text, version: hashOf(text) };
    },
    async write(id, text, baseVersion): Promise<WriteResult> {
      const { fs, root } = await ready();
      const now = await readText(fs, root, id);
      if (now === null) return { ok: false, version: "" };
      const version = hashOf(now);
      if (version !== baseVersion) return { ok: false, version };
      await writeAtomic(fs, `${root}/${id}`, text);
      return { ok: true, meta: await written(fs, root, id, text) };
    },
    async create(name, text) {
      const { fs, root } = await ready();
      const id = fileName("", name);
      const free = () => freeTarget(fs, root, id);
      await free();
      await writeAtomic(fs, `${root}/${id}`, text, free);
      return written(fs, root, id, text);
    },
    async rename(id, name) {
      checkId(id);
      const { fs, root } = await ready();
      const to = fileName(dirOf(id), name, extOf(id));
      if (!(await fs.exists(`${root}/${id}`))) throw new Error(t("这篇文档已经不在了（可能在别处删掉了）", "This document is no longer available. It may have been deleted elsewhere."));
      if (to !== id) {
        await freeTarget(fs, root, to, id);
        await fs.rename(`${root}/${id}`, `${root}/${to}`);
      }
      const stat = await fs.stat(`${root}/${to}`);
      return metaOf(to, stat.size, stat.mtimeMs, "");
    },
    async remove(id) {
      checkId(id);
      const { fs, root } = await ready();
      if (await fs.exists(`${root}/${id}`)) await fs.unlink(`${root}/${id}`);
    },
    async putAsset(docId, bytes) {
      checkId(docId);
      const name = assetName(bytes, checkImage(bytes, MAX_FILE_BYTES));
      const { fs, root } = await ready();
      const dir = `${root}/${dirOf(docId)}${ASSET_DIR}`;
      const path = `${dir}/${name}`;
      if (!(await fs.exists(path))) {
        await fs.mkdir(dir, { recursive: true });
        await writeAtomic(fs, path, bytes);
      }
      return assetSrc(name);
    },
    /**
     * nsh 0.6.0 的 fs 没有 realpath，解不了符号链接：assets/ 里的符号链接指向文库外时，能不能读到全靠 nsh.json 的 `capabilities.fs`
     * （只给文库和「下载」）。读到的字节照样按文件头认，不是图片就不显示。
     */
    async getAsset(docId, src) {
      checkId(docId);
      const rel = assetPathFromSrc(docId, src);
      if (!rel) return null;
      const { fs, root } = await ready();
      const path = `${root}/${rel}`;
      if (!(await fs.exists(path))) return null;
      if ((await fs.stat(path)).size > MAX_FILE_BYTES) throw new Error(t(`图片「${rel}」超过 8 MB，不显示`, `“${rel}” exceeds the 8 MB image limit`));
      const raw = await fs.readFile(path);
      const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
      const ext = sniffImage(bytes);
      return ext ? { mime: mimeOf(ext), bytes } : null;
    },
  };
}

/** 系统交来的文件（打开方式、拖进窗口）：在文库里就给出它的 id；不在就试着读出内容（应用只能读文库和「下载」，别处读不了是 null）。 */
export async function locateFile(path: string): Promise<{ kind: "library"; id: string } | { kind: "outside"; name: string; text: string | null }> {
  const root = await libraryRoot();
  if (path.startsWith(`${root}/`)) {
    const id = path.slice(root.length + 1);
    checkId(id);
    return { kind: "library", id };
  }
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|markdown|mdown|txt)$/i, "") || "未命名";
  let bytes: Uint8Array;
  try {
    const fs = await fsModule();
    if ((await fs.stat(path)).size > MAX_FILE_BYTES) return { kind: "outside", name, text: null };
    bytes = await fs.readFile(path);
  } catch (e) {
    // 多半是 ERR_ACCESS_DENIED：nsh 不因为系统交来了这个文件就给读它的权限（只给文库和「下载」）
    console.warn("opened file unreadable", e);
    return { kind: "outside", name, text: null };
  }
  const text = decode(bytes);
  if (text === null) throw new Error(t(`「${name}」不是 UTF-8 编码的文本，打不开`, `“${name}” cannot be opened because it is not UTF-8 text`));
  return { kind: "outside", name, text };
}

/** 系统交来的一个本地文件（拖进窗口的图片）的字节；应用只能读文库和「下载」，别处抛 ERR_ACCESS_DENIED。超过 8 MiB 不读，抛 AssetRejected。 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const fs = await fsModule();
  if ((await fs.stat(path)).size > MAX_FILE_BYTES) throw new AssetRejected(t("图片超过 8 MB，先压缩一下再放进来", "Compress the image to 8 MB or less before inserting it"));
  const raw = await fs.readFile(path);
  return raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
}
