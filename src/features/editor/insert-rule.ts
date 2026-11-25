/** 插入分隔线（斜杠菜单、命令面板）。 */
import { chain, command, insertContentAt, type RichEditorSession, setTextSelection } from "nsh/base";

const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/**
 * 编辑器自带的 setHorizontalRule 在文末插入时，后面没有段落，选区停在分隔线这个节点上：接着打的字会把分隔线替换掉，
 * 从命令面板插入时光标还会跳回文首（2026-11-25 web host 实测，L-M2.1）。这时在分隔线后面补一个空段落，光标放进去。
 */
export function insertRule(session: RichEditorSession) {
  if (!session.run(command("setHorizontalRule"))) return;
  const { type, anchor = 0, head = anchor } = session.selection;
  const parent = (session.resolve(head) as { parent: string }).parent;
  if (type === "text" && TEXTBLOCKS.has(parent)) return;
  const rule = type === "node" ? Math.min(anchor, head) : head - 1;
  if (session.nodeAt(rule)?.type !== "horizontalRule") return;
  session.run(chain([insertContentAt(rule + 1, { type: "paragraph" }), setTextSelection(rule + 2)]));
}
