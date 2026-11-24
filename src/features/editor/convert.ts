import { bindOrigin as bindSlices, openDoc, saveDoc, type Origin, type PendingOrigin } from "../../doc/save";
import type { DocJSON } from "../../doc/types";
import { parseMarkdown } from "./parse";

export type { DocJSON, Origin, PendingOrigin };

/** 打开：Markdown 原文 → 编辑器 JSON（format: "json" 建会话用）+ 待配对的原文切片 */
export function loadMarkdown(src: string): { json: DocJSON; pending: PendingOrigin } {
  return openDoc(parseMarkdown(src));
}

/** 会话建好后调一次：用会话规范化后的 JSON 和原文切片配对 */
export function bindOrigin(pending: PendingOrigin, sessionJson: DocJSON): Origin {
  return bindSlices(pending, sessionJson);
}

/** 保存：会话当前的 JSON → Markdown；没改过的顶层块逐字节写回原文 */
export function dumpMarkdown(sessionJson: DocJSON, origin: Origin): string {
  return saveDoc(sessionJson, origin);
}
