/** 从编辑器 JSON 或 Markdown 原文里取标题：顶栏的文档名、锚点跳转的目标位置。 */

export interface Node {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
}

/** 没有内容时仍占两个位置（开、闭）的文本块；其余没有内容的节点是叶子，占一个位置。 */
const TEXTBLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/** ProseMirror 的 nodeSize：文字按字符数，叶子 1，其余 2 + 子节点。 */
function nodeSize(node: Node): number {
  if (node.type === "text") return node.text?.length ?? 0;
  if (!node.content) return TEXTBLOCKS.has(node.type) ? 2 : 1;
  return node.content.reduce((sum, child) => sum + nodeSize(child), 2);
}

function textOf(node: Node): string {
  return node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(textOf).join("");
}

/** 一个顶层块：在文档里的起始位置、占多少位置、节点本身。 */
export interface TopBlock {
  pos: number;
  size: number;
  node: Node;
}

/** 全部顶层块，按顺序。 */
export function topBlocks(doc: Node): TopBlock[] {
  let pos = 0;
  return (doc.content ?? []).map((node) => {
    const block = { pos, size: nodeSize(node), node };
    pos += block.size;
    return block;
  });
}

/** `pos` 落在第几个顶层块里；文档是空的时候是 -1。 */
export function blockIndexAt(blocks: TopBlock[], pos: number): number {
  let index = blocks.length - 1;
  while (index > 0 && blocks[index].pos > pos) index--;
  return index;
}

/** 光标放进这个块时该落的位置：顺着第一个子节点往里走到第一个文本块的开头（列表、引用、表格都要走几层）；公式、分隔线这类没有文字的块就是块本身的位置。 */
export function caretPosIn(block: TopBlock): number {
  let pos = block.pos;
  let node: Node | undefined = block.node;
  while (node && !TEXTBLOCKS.has(node.type)) {
    if (!node.content?.length) return block.pos;
    node = node.content[0];
    pos += 1;
  }
  return pos + 1;
}

/** 一个顶层标题：起始位置、级别、文字。 */
export interface HeadingEntry {
  pos: number;
  level: number;
  text: string;
}

/** 顶层标题，按顺序。 */
export function headingStarts(doc: Node): HeadingEntry[] {
  return topBlocks(doc)
    .filter((b) => b.node.type === "heading")
    .map((b) => ({ pos: b.pos, level: typeof b.node.attrs?.level === "number" ? b.node.attrs.level : 1, text: textOf(b.node) }));
}

/** 光标所在的那一节：最后一个起始位置不超过 `pos` 的标题的下标，前面没有标题时是 -1。 */
export function currentHeading(headings: HeadingEntry[], pos: number): number {
  let index = -1;
  for (let i = 0; i < headings.length && headings[i].pos <= pos; i++) index = i;
  return index;
}

/** 文档名：第一个顶层标题的文字，没有标题时是空串。 */
export function documentTitle(doc: Node): string {
  const heading = (doc.content ?? []).find((block) => block.type === "heading");
  return heading ? textOf(heading).trim() : "";
}

/** 源码方式打开时的文档名：第一个 ATX 标题（`# …`）的文字，没有时是空串。 */
export function markdownTitle(markdown: string): string {
  return /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/m.exec(markdown)?.[1]?.trim() ?? "";
}
