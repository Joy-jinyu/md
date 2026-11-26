/**
 * 同步落到本机的那几步：把远端的全文写进一篇文档（写之前把本机这版存进版本历史）、记下同步记录、从 Gist 建一篇新文档。
 * 开着的这篇要经 store/document.ts（先写完没存的改动，换掉以后重新载入编辑页）；别的直接写存储。
 */
import { type Phrase, t } from "../../i18n";
import { documentStore } from "../../store/backend";
import { flush, latestDocument, replaceDocument, type SaveResult, STALE } from "../../store/document";
import { addSnapshot } from "../../store/history";
import { createDocument, currentDocId, noteMeta } from "../../store/library";
import { type GistLink, putSyncRecord, syncRecordOf } from "../../store/sync-store";
import { type Gist, gistDocName } from "../../sync/github";

let reloadCurrent: () => Promise<void> = async () => undefined;

/** 编辑页挂上时给：开着的这篇被换了内容，重新载入编辑页。 */
export function onCurrentReplaced(reload: () => Promise<void>) {
  reloadCurrent = reload;
}

const storageFull = () => t("本机存储已满，本机这版存不进版本历史，所以没有换。删掉不用的文档腾出空间后再同步。", "Storage is full, so the local version could not be saved to version history. The document is unchanged. Free some space and try again.");

function whyNot(result: Extract<SaveResult, { ok: false }>): string {
  if (result.error.conflict || result.error.deleted) return t("这篇在别处改过或删了，先处理顶上的冲突条，再同步。", "This document was edited or deleted elsewhere. Resolve the conflict above, then sync again.");
  return t(`这篇没能保存（${result.error.detail}），先没有换。`, `Could not save this document (${result.error.detail}). The document is unchanged.`);
}

/** 本机这篇现在的全文：开着的那篇先把没存的改动写进去。读不到（不在了）是 null；开着的那篇写不进去时抛带原因的错。 */
export async function localText(id: string): Promise<string | null> {
  if (id === currentDocId()) {
    const saved = await flush();
    if (!saved.ok) throw new Error(whyNot(saved));
    return latestDocument();
  }
  return (await documentStore.read(id))?.text ?? null;
}

/**
 * 把 `text` 写进 `id` 那篇，换之前本机这版存进版本历史。`expected`：本机这篇应该还是这些字（判定时读到的），
 * 同步途中又改了就不换（返回原因，下次同步再比）。成了返回 null。
 */
export async function replaceLocal(id: string, text: string, expected: string | null): Promise<Phrase | null> {
  if (id === currentDocId()) {
    const saved = await flush();
    if (!saved.ok) return () => whyNot(saved);
    const mine = latestDocument();
    if (expected !== null && mine !== expected) return () => STALE.error.detail;
    if (mine !== text && !(await addSnapshot(id, mine))) return storageFull;
    // 存进历史要等一会儿，这期间又打的字由 replaceDocument 在同一个排队任务里拦下
    const result = await replaceDocument(text, { id, text: mine });
    if (!result.ok) return result === STALE ? () => STALE.error.detail : () => whyNot(result);
    await reloadCurrent();
    return null;
  }
  const now = await documentStore.read(id);
  if (!now) return () => t("这篇在本机已经不在了。", "This document is no longer on this device.");
  if (expected !== null && now.text !== expected) return () => STALE.error.detail;
  if (now.text !== text && !(await addSnapshot(id, now.text))) return storageFull;
  const written = await documentStore.write(id, text, now.version);
  if (!written.ok) return () => t("同步时这篇在别处又改了，没有换。再同步一次。", "This document changed elsewhere during sync. No replacement was made. Try syncing again.");
  noteMeta(written.meta);
  return null;
}

/** 同步成了：记下这时两边的文本（基线）、远端版本和文件名。保留「不同步这篇」的选择。 */
export async function linkTo(id: string, gist: Gist, base: string, login: string) {
  const link: GistLink = { gistId: gist.id, fileName: gist.fileName, base, version: gist.version, login, syncedAt: Date.now() };
  const record = await syncRecordOf(id);
  await putSyncRecord(id, { ...record, link });
}

/** 把一个 Gist 拉成本机的一篇新文档，并连上它。返回新文档的名字。 */
export async function pullAsNew(gist: Gist, login: string): Promise<string> {
  const meta = await createDocument(gist.text, gistDocName(gist.fileName));
  await linkTo(meta.id, gist, gist.text, login);
  return meta.name;
}
