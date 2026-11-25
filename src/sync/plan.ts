/**
 * 同步判定（实施计划 4.8）：每篇记三样——本地文本、上次同步时的文本（基线）、远端版本号，按它们决定这一篇做什么。纯函数。
 * 只有一边变了就直接跟上；两边都变了才是冲突，交给用户选，不自动丢任何一边（CLAUDE.md 强制规则 3）。
 */

/** 上次同步成功时记下的：那时两边的文本（基线）和远端的版本号。 */
export interface SyncedState {
  base: string;
  version: string;
}

/** 远端现在的版本号和全文。 */
export interface RemoteState {
  version: string;
  text: string;
}

/**
 * - `create`：还没同步过，建一个远端副本。
 * - `push` / `pull`：只有本地 / 只有远端变了。
 * - `adopt`：内容其实一样（远端只改了文件名、说明，或者两边改成了同样的字，只差换行符和末尾空行也算），只记下新的版本号，两边的文本都不动。
 * - `conflict`：两边都改了、改得不一样。
 * - `remote-deleted` / `local-deleted`：有一边没了，另一边还在：让用户选，不跟着删。
 * - `forget`：两边都没了，同步记录可以丢掉。
 */
export type Decision = "none" | "create" | "push" | "pull" | "adopt" | "conflict" | "remote-deleted" | "local-deleted" | "forget";

/** `local` 是 null：本地没有这一篇了；`synced` 是 null：没同步过；`remote` 是 null：远端没有了（404）。 */
export function decide(local: string | null, synced: SyncedState | null, remote: RemoteState | null): Decision {
  if (!synced) return local === null ? "none" : "create";
  if (local === null) return remote ? "local-deleted" : "forget";
  if (!remote) return "remote-deleted";
  const localChanged = !same(local, synced.base);
  // 版本号可能是空的、或者是秒级的 updated_at（github.ts 的 versionOf）：只看它会把同一秒里的改动当成没变，所以文本也比
  const remoteChanged = remote.version !== synced.version || !same(remote.text, synced.base);
  if (!remoteChanged) return localChanged ? "push" : "none";
  if (!localChanged) return same(remote.text, synced.base) ? "adopt" : "pull";
  if (same(remote.text, local)) return "adopt";
  return same(remote.text, synced.base) ? "push" : "conflict";
}

/** 比较时不算的差别：换行符（CRLF / LF）和末尾的空行。只差这些的两版当成一样，两边的文本都不改。 */
const normalized = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
export const same = (a: string, b: string) => a === b || normalized(a) === normalized(b);
