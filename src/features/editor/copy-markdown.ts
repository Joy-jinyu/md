/** 「复制为 Markdown」（Cmd+Shift+C）：选中的那段写成 Markdown 放进剪贴板；没有选区或全选时复制整篇（原文本身，逐字节）。 */
import { Clipboard } from "nsh";
import type { RichEditorSession } from "nsh/base";
import { cellSelectionText, selectionMarkdown } from "../../doc/selection-markdown";
import type { PMNode } from "../../doc/types";
import { latestDocument } from "../../store/document";
import { say } from "../library/receipt";
import { nodeSize } from "./outline";
import { selectionRange } from "./selection";

/** 选中的那段的 Markdown；没有选区是 null。节点选区（选中一张图、一个公式块）没有 head，范围是这个节点本身。 */
function selectedMarkdown(session: RichEditorSession): string | null {
  const sel = session.selection;
  const doc = session.getJSON() as PMNode;
  if (sel.type === "cell") return cellSelectionText(doc, sel.anchor ?? 0, sel.head ?? sel.anchor ?? 0);
  if (sel.type === "node" && sel.anchor !== undefined) {
    const node = session.nodeAt(sel.anchor) as PMNode | null;
    return node ? selectionMarkdown(doc, sel.anchor, sel.anchor + nodeSize(node)) : null;
  }
  const { from, to } = selectionRange(session);
  return from === to ? null : selectionMarkdown(doc, from, to);
}

export function copyAsMarkdown(session: RichEditorSession) {
  const selected = session.selection.type === "all" ? null : selectedMarkdown(session);
  const nothing = selected === null && session.selection.type !== "all";
  const text = selected ?? latestDocument();
  Clipboard.writeText(text).then(
    () => nothing && say("没有选中内容，已把整篇的 Markdown 复制到剪贴板。", "info"),
    (e: unknown) => {
      console.warn("copy as markdown failed", e);
      say("没能复制：写不了剪贴板。可以切到源码视图，选中后按复制键。", "warn");
    },
  );
}
