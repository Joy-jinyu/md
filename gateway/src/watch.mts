import { watch } from "node:fs";
import { lstat } from "node:fs/promises";
import { join, sep } from "node:path";
import { describeError, errno } from "./errors.mts";
import type { Library } from "./library.mts";
import { checkRelative, extOf } from "./paths.mts";
import type { ChangedEvent, ServerMessage } from "./protocol.ts";

/** 攒一小段时间再推：编辑器保存一次常常触发好几个事件。 */
const DEBOUNCE_MS = 150;

/** 是文档还是图片；隐藏文件（含网关的临时文件）、别的文件返回 null。 */
function kindOf(rel: string): "doc" | "asset" | null {
  for (const kind of ["doc", "asset"] as const) {
    try {
      checkRelative(rel, kind);
      return kind;
    } catch {
      // 不是这一类，试下一类
    }
  }
  return null;
}

/**
 * 不是文档也不是图片的路径，要不要让页面重新 list：现在是目录（改名后的新名字、新建的目录），
 * 或者已经不在了且没有扩展名（多半是删掉、改走的目录）。
 * 已删的路径分不清原来是目录还是文件，按「没扩展名」猜：编辑器保存时的临时文件大都带扩展名，不会一直触发 relist。
 */
async function needsRelist(root: string, rel: string): Promise<boolean> {
  try {
    return (await lstat(join(root, rel))).isDirectory();
  } catch (e) {
    if (errno(e) !== "ENOENT") throw e;
    return extOf(rel.slice(rel.lastIndexOf("/") + 1)) === "";
  }
}

/** 一批里每个文档单独取版本：一个读不了（EACCES）只跳过它自己，记日志。 */
async function collectChanges(lib: Library, batch: [string, "doc" | "asset"][], log: (s: string) => void): Promise<ChangedEvent["changes"]> {
  const all = await Promise.all(
    batch.map(async ([path, kind]) => {
      try {
        return { path, version: kind === "doc" ? await lib.versionIfExists(path) : null };
      } catch (e) {
        log(`取 ${path} 的版本失败，这次不推它：${describeError(e)}`);
        return null;
      }
    }),
  );
  return all.filter((c) => c !== null);
}

async function anyNeedsRelist(root: string, paths: string[], log: (s: string) => void): Promise<boolean> {
  const hits = await Promise.all(
    paths.map((p) =>
      needsRelist(root, p).catch((e) => {
        log(`查看 ${p} 失败，按需要重新列表处理：${describeError(e)}`);
        return true;
      }),
    ),
  );
  return hits.includes(true);
}

/**
 * 监听文库文件夹（含子目录），把改动的文档 / 图片攒成一条 changed 推出去；
 * 目录改名、删除、新建推 relist。返回停止监听的函数。
 */
export function watchLibrary(lib: Library, emit: (e: ServerMessage) => void, log: (s: string) => void): () => void {
  const pending = new Map<string, "doc" | "asset">();
  const others = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const flush = async () => {
    timer = undefined;
    const batch = [...pending];
    const maybeDirs = [...others];
    pending.clear();
    others.clear();
    const changes = await collectChanges(lib, batch, log);
    if (changes.length > 0) emit({ type: "changed", changes });
    if (await anyNeedsRelist(lib.root, maybeDirs, log)) emit({ type: "relist" });
  };
  const watcher = watch(lib.root, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const rel = filename.split(sep).join("/");
    if (rel.split("/").some((s) => s.startsWith("."))) return;
    const kind = kindOf(rel);
    if (kind) pending.set(rel, kind);
    else others.add(rel);
    timer ??= setTimeout(() => void flush().catch((e) => log(`推送改动失败：${describeError(e)}`)), DEBOUNCE_MS);
  });
  // 监听自己出错（文库里有读不了的目录、目录被删）只记日志，网关不退出
  watcher.on("error", (e) => log(`监听文库出错：${describeError(e)}`));
  watcher.on("error", (e) => log(`监听文库出错：${describeError(e)}`));
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
