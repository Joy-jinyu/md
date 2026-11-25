/** 从 Markdown 原文里取文档名：第一个 ATX 标题（`# …`）的文字，没有时是空串。 */
export function markdownTitle(markdown: string): string {
  return /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/m.exec(markdown)?.[1]?.trim() ?? "";
}
