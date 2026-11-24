/** 所见即所得和源码来回切时，让两边停在同一块上：顶层块的序号和源码行号互相换算。 */
import type { PendingOrigin } from "./convert";

const lineCount = (text: string) => text.split("\n").length - 1;

/** 每个原文切片从第几行开始（从 0 数），连同它管的顶层块范围。 */
function sliceLines(pending: PendingOrigin): { line: number; first: number; count: number }[] {
  let line = lineCount(pending.lead);
  return pending.slices.map((s) => {
    const entry = { line, first: s.first, count: s.count };
    line += lineCount(s.text) + lineCount(s.sep);
    return entry;
  });
}

/** 第 `block` 个顶层块（不算空段落）所在切片的起始行。 */
export function lineOfBlock(pending: PendingOrigin, block: number): number {
  const slices = sliceLines(pending);
  const hit = slices.findLast((s) => s.first <= block);
  return hit?.line ?? 0;
}

/** 第 `line` 行所在切片的第一个顶层块的序号。 */
export function blockAtLine(pending: PendingOrigin, line: number): number {
  const slices = sliceLines(pending);
  const hit = slices.findLast((s) => s.line <= line && s.count > 0);
  return hit?.first ?? 0;
}
