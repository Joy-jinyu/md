/**
 * 存储那边来的变化：网关推来的文件改动、和网关断开 / 重连。
 * 开着的这篇被外面改了走和回焦时同一套比对（store/document.ts 的 checkExternal）：这里没改过直接载入，改过出冲突条。
 */
import { t } from "../../i18n";
import { backendLabel, beginSwitch, documentStore, gatewayLink, gatewayRefusal, probeGatewayAgain, useGateway } from "../../store/backend";
import { checkExternal, closeDocument, flush, followRename } from "../../store/document";
import type { DocProblem, StoreChange } from "../../store/document-store";
import { currentDocId, markOpened, refreshLibrary, startLibrary } from "../../store/library";
import { recoverUnsaved } from "../../store/unsaved";
import { say } from "./receipt";
import { requestLibrary } from "./requests";
import { handleError } from "../../doc/message";

/** 别处把开着的这篇改了名：跟过去（不当成「已在别处删除」）。返回跟没跟。 */
async function followIfRenamed(change: StoreChange): Promise<boolean> {
  const id = currentDocId();
  const moved = change.renamed?.find((r) => r.from === id);
  if (!moved) return false;
  await followRename(moved.from, moved.to);
  markOpened(moved.to);
  return true;
}

/**
 * 跟着存储的变化走（在选定存储之后调一次，跟应用一样长）。`reload`：开着的这篇被外面改了、这里没改过，编辑页重新载入它。
 * 重连上（`all`）时这里没改过的话接着保存断开期间没存上的改动。
 */
export function followStoreChanges(reload: () => void) {
  documentStore.watch?.((change) => {
    void followIfRenamed(change)
      .then(async () => {
        await refreshLibrary().catch((e: unknown) => handleError(e, { context: "library not refreshed", severity: "warn" }));
        const id = currentDocId();
        if (!id || (!change.all && !change.ids.includes(id))) return;
        const r = await checkExternal();
        if (r === "reload") reload();
        else if (r === "same") await flush();
      })
      .catch((e: unknown) => handleError(e, { context: "external change not checked", severity: "warn" }));
  });
}

/** 网关断开时页面顶上的那一句；连着、或者不是网关时是 null。 */
export function storageNotice(): string | null {
  const link = gatewayLink();
  if (!link || link.state === "connected") return null;
  if (link.state === "reconnecting") {
    const why = link.reason ? t(`（${link.reason}）`, ` (${link.reason})`) : "";
    return t(`和本机网关断开了${why}，正在重连。这里的修改没有丢：留在编辑器里，也记进了浏览器的应急存储，连上后接着保存。`, `Lost the connection to the local gateway${why}. Reconnecting… Your edits are in the editor and backed up in this browser. Saving will resume when the connection returns.`);
  }
  return t(`本机网关不再连接：${link.reason}。这里的修改留在编辑器里，可以先用「另存为」存成文件。`, `The local gateway disconnected: ${link.reason}. Your edits are still in the editor. Use Save As to keep a file copy.`);
}

/** 打不开的文档，说明原因。 */
export function problemText(problem: DocProblem): string {
  return problem === "not-utf8" ? t("不是 UTF-8 编码的文本，打不开", "Cannot open this file because it is not UTF-8 text") : t("文件太大，打不开", "Cannot open this file because it is too large");
}

/** 属于别的存储、还没补回去的修改：说一句在哪、什么时候补。 */
export function elsewhereText(tags: string[]): string {
  return t(`有没存上的修改属于${tags.map(backendLabel).join("、")}，用回那边时会补回去。`, `Unsaved edits belong to ${tags.map(backendLabel).join(", ")}. They will be restored when you switch back.`);
}

/**
 * 上次用网关、这次没连上时的「重新连接」：连上了就把开着的这篇存好关掉，换到网关的文库，补回那边没存上的修改，再开上次开的那篇。
 * 连不上、或者这里的修改存不上时什么都不换。正在同步时不换（同步记录会写进另一个后端），说一声等同步完。
 */
export async function reconnectGateway(): Promise<void> {
  const done = beginSwitch();
  if (!done) return say(() => t("正在同步，等同步完再重新连接本机网关。", "Wait for sync to finish before reconnecting to the local gateway."), "warn");
  try {
    await switchToGateway();
  } finally {
    done();
  }
}

async function switchToGateway(): Promise<void> {
  const gateway = await probeGatewayAgain();
  if (!gateway) {
    const refused = gatewayRefusal();
    return say(() => refused ? t(`网关拒绝了这个页面：${refused}。`, `The gateway refused this page: ${refused}.`) : t("还是没连上本机网关。确认网关在运行，再试一次。", "Could not connect to the local gateway. Make sure it is running and try again."), "warn");
  }
  const closed = await closeDocument();
  if (!closed.ok) {
    gateway.close();
    return say(() => t(`这里的文档还有修改没存上，先不换到网关（${closed.error.detail}）。`, `Could not switch to the gateway because this document has unsaved changes (${closed.error.detail}).`), "warn");
  }
  await useGateway(gateway);
  const note = await recoverUnsaved();
  requestLibrary({ kind: "open", id: await startLibrary() });
  say(note?.text ?? (() => t(`已连上本机网关的文库「${gateway.library()}」。`, `Connected to the local gateway library “${gateway.library()}”.`)), note?.tone ?? "info");
}
