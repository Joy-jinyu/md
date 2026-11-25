/**
 * 内存里的文件系统，给 `open` 的 `modules` 换掉应用的 `fs/promises` 和 `os.homedir`：macOS 的测试一律用它，
 * 不然应用会真的读写这台机器上的 ~/Documents/Pairdown。测试直接改 `files`，当成别的程序改了文件。
 * 替身的返回值过桥时只留数据（方法、错误码都会丢，2026-11-25 实测），所以只给数据，出错只给 message。
 */
export const HOME = "/Users/t";
export const LIBRARY = `${HOME}/Documents/Pairdown`;

const S_IFDIR = 0o040755;
const S_IFREG = 0o100644;

type Data = string | Uint8Array;

const encode = (data: Data) => (typeof data === "string" ? new TextEncoder().encode(data) : data);
/** 应用写进来的字节过桥后可能是普通数组或 `{ "0": … }` 这样的对象（2026-11-25 实测），收成 Uint8Array。 */
const bytesOf = (data: unknown) => (data instanceof Uint8Array ? data : Uint8Array.from(Object.values(data as Record<string, number>)));
/** 不合法的字节换成替换字符，BOM 留着：只给测试比对用。 */
const loose = (data: Data) => (typeof data === "string" ? data : new TextDecoder("utf-8", { ignoreBOM: true }).decode(data));

/** `seed` 的键：`/` 开头是绝对路径，否则是文库里的相对路径。值可以是文字，也可以是字节（不是 UTF-8 的文件）。 */
export function memoryFs(seed: Record<string, Data> = {}) {
  const files = new Map<string, Data>(Object.entries(seed).map(([k, v]) => [k.startsWith("/") ? k : `${LIBRARY}/${k}`, v]));
  const dirs = new Set<string>();
  let clock = 1_700_000_000_000;
  const mtimes = new Map<string, number>();
  const touch = (path: string) => mtimes.set(path, (clock += 1000));
  const isDir = (path: string) => dirs.has(path) || [...files.keys()].some((f) => f.startsWith(`${path}/`));
  const missing = (path: string) => new Error(`ENOENT: no such file: ${path}`);
  const children = (path: string) => {
    const names = new Set<string>();
    for (const p of [...files.keys(), ...dirs]) if (p.startsWith(`${path}/`)) names.add(p.slice(path.length + 1).split("/")[0]);
    return [...names].sort();
  };
  const fs = {
    exists: (path: string) => files.has(path) || isDir(path),
    mkdir: (path: string) => {
      dirs.add(path);
    },
    readdir: (path: string) => {
      if (!isDir(path)) throw missing(path);
      return children(path);
    },
    stat: (path: string) => {
      const data = files.get(path);
      if (data !== undefined) return { size: encode(data).length, mode: S_IFREG, mtimeMs: mtimes.get(path) ?? clock };
      if (isDir(path)) return { size: 0, mode: S_IFDIR, mtimeMs: clock };
      throw missing(path);
    },
    /** 不给编码时给字节：Uint8Array 过桥会变成 `{ "0": … }` 这样的对象（2026-11-25 实测），所以给普通数组。 */
    readFile: (path: string, encoding?: string) => {
      const data = files.get(path);
      if (data === undefined) throw missing(path);
      return encoding ? loose(data) : [...encode(data)];
    },
    writeFile: (path: string, data: Data) => {
      files.set(path, typeof data === "string" ? data : bytesOf(data));
      touch(path);
    },
    rename: (from: string, to: string) => {
      const text = files.get(from);
      if (text === undefined) throw missing(from);
      files.delete(from);
      files.set(to, text);
      touch(to);
    },
    unlink: (path: string) => {
      if (!files.delete(path)) throw missing(path);
    },
  };
  return {
    files,
    /** 文库里的文件（相对路径 → 内容），临时文件也在内。 */
    library: () => Object.fromEntries([...files].filter(([p]) => p.startsWith(`${LIBRARY}/`)).map(([p, t]) => [p.slice(LIBRARY.length + 1), loose(t)])),
    /** 文库里一个文件的原始字节。 */
    bytes: (rel: string) => [...encode(files.get(`${LIBRARY}/${rel}`) ?? "")],
    /** 外面改了 / 建了一个文件。 */
    put(rel: string, data: Data) {
      fs.writeFile(rel.startsWith("/") ? rel : `${LIBRARY}/${rel}`, data);
    },
    modules: { os: { homedir: HOME }, "fs/promises": fs },
  };
}
