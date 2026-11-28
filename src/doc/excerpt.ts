/**
 * 文档列表卡片上的摘要：存储层只给文件开头一小段原文（`DocMeta.head`），这里去掉 Markdown 记号，取前两行。
 * 浏览器本地、网关、macOS 文库三种来源都走这里。
 */
import { HEAD_BYTES } from "../../gateway/src/protocol";

const encoder = new TextEncoder();
/** BOM 和私用区的起点用码位拼出来，不写成字面字符：格式化钩子会把 `\u` 转义换成看不见的字。 */
const BOM = String.fromCharCode(0xfeff);
const PUA = 0xe000;

/** 原文开头最多 HEAD_BYTES 个 UTF-8 字节，按字符边界截断，去掉开头的 BOM。网关那边按同样的规矩在 Node 里截。 */
export function headOf(text: string): string {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  let bytes = 0;
  let end = 0;
  for (const ch of body) {
    bytes += encoder.encode(ch).length;
    if (bytes > HEAD_BYTES) break;
    end += ch.length;
  }
  return body.slice(0, end);
}

const FENCE = /^(```|~~~)/;
const TABLE_RULE = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;
/** 只有记号的行：setext 标题的下划线、分隔线。 */
const RULE_LINE = /^(=+|-+|(\*\s*){3,}|(_\s*){3,})$/;

function dropFrontMatter(lines: readonly string[]): readonly string[] {
  if (lines[0]?.trim() !== "---") return lines;
  const close = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
  return close === -1 ? [] : lines.slice(close + 1);
}

/** 反斜杠转义的字符先换成私用区的字，去完记号再换回来，`\*` 不会被当成强调。 */
const hide = (text: string) => text.replace(/\\([!-/:-@[-`{-~])/g, (_, ch: string) => String.fromCharCode(PUA + ch.charCodeAt(0)));
const HIDDEN = new RegExp(`[${String.fromCharCode(PUA)}-${String.fromCharCode(PUA + 0x7f)}]`, "g");
const unhide = (text: string) => text.replace(HIDDEN, (ch) => String.fromCharCode(ch.charCodeAt(0) - PUA));

/** 成对的强调才去掉记号：`2 * 3`、`a == b`、`snake_case` 原样留着。 */
const PAIRED: readonly [RegExp, string][] = [
  [/`([^`]+)`/g, "$1"],
  [/\*\*(\S(?:.*?\S)?)\*\*/g, "$1"],
  [/(^|[^\w])__(\S(?:.*?\S)?)__(?!\w)/g, "$1$2"],
  [/~~(\S(?:.*?\S)?)~~/g, "$1"],
  [/==(\S(?:.*?\S)?)==/g, "$1"],
  [/\*(\S(?:.*?\S)?)\*/g, "$1"],
  [/(^|[^\w])_(\S(?:.*?\S)?)_(?!\w)/g, "$1$2"],
];

function plain(line: string): string {
  let text = hide(line)
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?)+/, "")
    .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/<\/?[A-Za-z][\w:-]*(\s[^>]*)?\/?>/g, "");
  for (const [pattern, keep] of PAIRED) text = text.replace(pattern, keep);
  return unhide(text.replace(/\|/g, " ").replace(/\s+/g, " ").trim());
}

/** 文件开头 → 最多两行纯文字（用 `\n` 连起来）；什么都没有时是空串。 */
export function excerptOf(head: string): string {
  const lines = dropFrontMatter((head.startsWith(BOM) ? head.slice(1) : head).split(/\r?\n/));
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (FENCE.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && (TABLE_RULE.test(trimmed) || RULE_LINE.test(trimmed))) continue;
    const text = inFence ? trimmed.replace(/\s+/g, " ") : plain(line);
    if (text) out.push(text);
    if (out.length === 2) break;
  }
  return out.join("\n");
}
