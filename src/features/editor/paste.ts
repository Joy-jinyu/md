/** 粘贴：剪贴板里是 Markdown 文本时，按 Markdown 读成节点再插入，而不是一行一段地当字面文字贴进来。 */
import { command, type RichClipboardContent, type RichEditorSession, type RichNodeJSON, setTextSelection } from "nsh/base";
import { loadMarkdown } from "./convert";

/** 行首的块记号：标题、列表、引用、代码围栏、表格行、分隔线。 */
const BLOCK_SYNTAX = /^ {0,3}(?:#{1,6} |[-*+] |\d+[.)] |> |```|~~~|\||(?:-{3,}|\*{3,}|_{3,})\s*$)/m;
/** 行内记号：粗体、行内代码、删除线、高亮、链接和图片。 */
const INLINE_SYNTAX = /\*\*[^*\n]+\*\*|`[^`\n]+`|~~[^~\n]+~~|==[^=\n]+==|!?\[[^\]\n]*\]\([^)\s]+\)/;
/**
 * 剪贴板的 HTML 里有这些标签，说明来源本身带格式（网页、Word、另一个富文本编辑器），照 HTML 贴。
 * 代码编辑器复制出来的 HTML 只有上色用的 div / span，那种按 Markdown 文本读。
 */
const FORMATTED_HTML = /<(?:h[1-6]|ul|ol|li|table|blockquote|strong|em|b|i|a|img|code|p)\b/i;

/** 多行文字要有块记号才算 Markdown：只有行内记号的多行按 Markdown 读会把换行并成空格。单行有行内记号就算。 */
export const looksLikeMarkdown = (text: string) => BLOCK_SYNTAX.test(text) || (!text.trim().includes("\n") && INLINE_SYNTAX.test(text));

interface Resolved {
  parentOffset: number;
  start: number;
  end: number;
}

const caret = (session: RichEditorSession) => {
  const { anchor = 0, head = anchor } = session.selection;
  return { head, empty: anchor === head, at: session.resolve(head) as Resolved };
};

/**
 * 给要贴进来的几个块腾一个空块，光标放进去。
 * 直接往有字的块里插，第一个块会并进当前这一块、记号被吃掉（`intro` 后面贴 `## Sub` 成了 `introSub`，2026-11-24 审查时实测）。
 */
function openEmptyBlock(session: RichEditorSession) {
  if (!caret(session).empty) session.run(command("deleteSelection"));
  if (caret(session).at.end === caret(session).at.start) return;
  // 光标不在块首：从这里断开，后半截成了新的一块，光标在它开头
  if (caret(session).at.parentOffset > 0) session.run(command("splitBlock"));
  if (caret(session).at.end === caret(session).at.start) return;
  // 后半截还有字：再断一次，在它前面留出空块（空块里的位置是后半截开头往前 2）
  session.run(command("splitBlock"));
  session.run(setTextSelection(caret(session).head - 2));
}

/** 单独一段贴进行内时，两头的空格是用户选中带上的，Markdown 解析会去掉，补回来。 */
function withEdgeSpaces(text: string, inline: RichNodeJSON[]): RichNodeJSON[] {
  const lead = /^ +/.exec(text)?.[0] ?? "";
  const trail = /(?<=\S) +$/.exec(text)?.[0] ?? "";
  const space = (s: string): RichNodeJSON[] => (s === "" ? [] : [{ type: "text", text: s } as RichNodeJSON]);
  return [...space(lead), ...inline, ...space(trail)];
}

/**
 * 接在编辑器的 handlePaste 上：返回 true 表示这次粘贴已经自己处理了。
 * 代码块里照原样贴；只有一段时插成行内内容（不新起段）；表格格子里放不下多个块，交回编辑器默认处理。
 */
export function pasteMarkdown(session: RichEditorSession, clipboard: RichClipboardContent): boolean {
  const { text, html } = clipboard;
  if (text === "" || session.isActive("codeBlock")) return false;
  if (html !== "" && FORMATTED_HTML.test(html)) return false;
  if (!looksLikeMarkdown(text)) return false;
  let blocks: RichNodeJSON[];
  try {
    blocks = (loadMarkdown(text).json.content ?? []) as RichNodeJSON[];
  } catch (e) {
    console.warn("paste as markdown failed, pasting as plain text", e);
    return false;
  }
  if (blocks.length === 0) return false;
  const single = blocks.length === 1 && blocks[0].type === "paragraph";
  if (!single && session.isActive("table")) return false;
  // 钩子在编辑器处理粘贴的途中被问到，文档等它答完再改
  setTimeout(() => {
    if (!single) openEmptyBlock(session);
    const content = single ? withEdgeSpaces(text, (blocks[0].content ?? []) as RichNodeJSON[]) : blocks;
    // 插不进去就退回按纯文本贴，不能让这次粘贴凭空没了
    if (!session.insertContent(content)) session.pasteText(text);
  }, 0);
  return true;
}
