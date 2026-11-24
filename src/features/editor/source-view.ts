/** 所见即所得文档的源码视图（Cmd+Alt+/）：同一个会话，切过去是把它写成 Markdown，切回来是把改过的 Markdown 读回去。 */
import { signal } from "nsh";
import { chain, type EditorRef, scrollIntoView, setTextSelection } from "nsh/base";
import { joinEndings, splitEndings } from "../../doc/line-endings";
import { isEmptyParagraph } from "../../doc/to-markdown";
import { markChanged } from "../../store/document";
import { loadMarkdown } from "./convert";
import { blockIndexAt, caretPosIn, type Node, topBlocks } from "./outline";
import type { RichOpened } from "./rich-session";
import { selectionRange } from "./selection";
import { blockAtLine, lineOfBlock } from "./source-align";
import type { SourceFind } from "./SourcePane";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 不算空段落的顶层块：原文切片里的块序号是按这个数的（见 doc/save.ts 的 bindOrigin）。 */
const realBlocks = (doc: RichOpened) => topBlocks(doc.session.getJSON() as Node).filter((b) => !isEmptyParagraph(b.node));

/** `tooBig` 判断一份 Markdown 是不是超过了所见即所得的上限（EditorScreen 定的）。 */
export function createSourceView(doc: RichOpened, find: SourceFind, tooBig: (markdown: string) => boolean) {
  const { session } = doc;
  /** 开着时是交给源码编辑框的初始文字。 */
  const view = signal<{ text: string } | null>(null);
  const notice = signal("");
  let endings = splitEndings("");
  let base = "";
  let current = "";
  let startLine = 0;
  let closing = false;

  const open = () => {
    const markdown = doc.dump();
    endings = splitEndings(markdown);
    base = current = endings.text;
    const blocks = realBlocks(doc);
    const caret = blocks.length > 0 ? blockIndexAt(blocks, selectionRange(session).head) : 0;
    startLine = lineOfBlock(loadMarkdown(markdown).pending, caret);
    notice.set("");
    view.set({ text: base });
  };

  /** 改过才读回会话；读不进、或者变得太大，就留在源码视图并说明原因。返回是否可以回去。 */
  const commit = (): boolean => {
    if (current === base) return true;
    const markdown = joinEndings(current, endings);
    if (tooBig(markdown)) {
      notice.set("改完以后超过了所见即所得能流畅打开的上限，先留在源码视图。");
      return false;
    }
    try {
      doc.load(markdown);
    } catch (e) {
      console.error("load from source failed", e);
      notice.set(`这份源码没能读进所见即所得（${messageOf(e)}），先留在源码视图，内容没有丢。`);
      return false;
    }
    markChanged(doc.dump);
    return true;
  };

  const close = async () => {
    if (closing) return;
    closing = true;
    try {
      const line = (await find.ref()?.selections())?.[0]?.head.line ?? 0;
      if (!commit()) return;
      find.attach(null);
      view.set(null);
      notice.set("");
      const blocks = realBlocks(doc);
      const target = blocks[blockAtLine(loadMarkdown(doc.dump()).pending, line)];
      if (target) session.run(chain([setTextSelection(caretPosIn(target)), scrollIntoView()]));
      setTimeout(() => session.focus(), 0);
    } finally {
      closing = false;
    }
  };

  return {
    view,
    notice,
    isOn: () => view() !== null,
    toggle: () => (view() ? void close() : open()),
    edited: (text: string) => {
      current = text;
      markChanged(() => joinEndings(current, endings));
    },
    ready: (ref: EditorRef) => {
      ref.goToLine(startLine);
      ref.focus();
    },
  };
}
