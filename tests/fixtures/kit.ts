import { createRichEditor, type RichEditorSession } from "nsh/base";
import { bindOrigin, dumpMarkdown, loadMarkdown, type DocJSON, type Origin, type PendingOrigin } from "../../src/features/editor/convert";
import { editorExtensions } from "../../src/features/editor/schema";

export type Node = NonNullable<DocJSON["content"]>[number];

export interface Opened {
  session: RichEditorSession;
  json: DocJSON;
  pending: PendingOrigin;
  origin: Origin;
}

/** 让出这一轮 JS 调用：nsh 单次调用超过 2000ms 会被中断 */
export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export function session(json: DocJSON): RichEditorSession {
  return createRichEditor({ content: json, format: "json", extensions: editorExtensions() });
}

/** 和真实使用一样：读入 → 建会话 → 用会话的 JSON 配对原文 */
export function openDoc(src: string): Opened {
  const { json, pending } = loadMarkdown(src);
  const s = session(json);
  const live = s.getJSON();
  return { session: s, json: live, pending, origin: bindOrigin(pending, live) };
}

/** 全部块强制重写：配对时块数对不上，按约定全部当作改过 */
export function forceRewrite(opened: Opened): string {
  return dumpMarkdown(opened.json, bindOrigin(opened.pending, { type: "doc", content: [] }));
}

function isEmptyParagraph(node: Node): boolean {
  return node.type === "paragraph" && (node.content ?? []).length === 0;
}

/** 经真实会话规范化，再去掉 Markdown 表达不了的空段落；用完立刻释放会话（Rust 侧内存不等 GC） */
export function normalize(json: DocJSON): Node[] {
  using s = session(json);
  return (s.getJSON().content ?? []).filter((n) => !isEmptyParagraph(n));
}

/** 把写出的 Markdown 重新读成编辑器 JSON */
export function reread(md: string): Node[] {
  return normalize(loadMarkdown(md).json);
}

/** 第一处不同的顶层块，没有不同返回 null（失败信息只给这一块，避免整篇打印） */
export function firstBlockDiff(want: Node[], got: Node[]): string | null {
  const n = Math.max(want.length, got.length);
  for (let i = 0; i < n; i++) {
    const a = JSON.stringify(want[i]);
    const b = JSON.stringify(got[i]);
    if (a !== b) return `block ${i} of ${want.length}/${got.length}\n  want ${a}\n  got  ${b}`;
  }
  return null;
}

/** 第一处不同的字符附近，没有不同返回 null */
export function firstTextDiff(want: string, got: string): string | null {
  if (want === got) return null;
  let i = 0;
  while (i < want.length && want[i] === got[i]) i++;
  return `at ${i}: want ${JSON.stringify(want.slice(Math.max(0, i - 40), i + 60))}\n        got  ${JSON.stringify(got.slice(Math.max(0, i - 40), i + 60))}`;
}

const LEAVES = new Set(["text", "hardBreak", "image", "horizontalRule", "mathInline", "htmlInline", "footnoteRef", "mathBlock", "rawBlock", "frontmatter", "diagram", "toc"]);

/** 节点在文档里占的位置数（ProseMirror 的 nodeSize） */
export function nodeSize(node: Node): number {
  if (node.type === "text") return (node.text ?? "").length;
  if (LEAVES.has(node.type)) return 1;
  return 2 + (node.content ?? []).reduce((n, c) => n + nodeSize(c), 0);
}
