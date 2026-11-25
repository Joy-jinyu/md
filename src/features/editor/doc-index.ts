/** 节点视图要看全文的东西（目录要的标题、脚注引用要的定义）：停手后由编辑页刷新；以及跳到某一处。 */
import { signal } from "nsh";
import { chain, type RichEditorSession, scrollIntoView, setNodeSelection, setTextSelection } from "nsh/base";
import { reachSelection } from "./caret-follow";
import { eachNode, type HeadingEntry, headingStarts, type Node } from "./outline";

/** 脚注定义行：`[^标签]: 内容`（前面最多三个空格）。 */
const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*/;

export interface FootnoteDef {
  pos: number;
  /** 定义的内容（去掉 `[^标签]:`，续行的缩进收成一个空格）。 */
  text: string;
}

export interface DocIndex {
  headings: HeadingEntry[];
  /** 标签 → 定义；同名的只认第一个，和 Markdown 的规则一样。 */
  footnotes: Map<string, FootnoteDef>;
  /** 标签 → 正文里第一个引用的位置。 */
  firstRefs: Map<string, number>;
}

/** 脚注定义块的标签；不是脚注定义时是 null。 */
export function footnoteLabel(src: string): string | null {
  return FOOTNOTE_DEF.exec(src)?.[1] ?? null;
}

function footnoteText(src: string): string {
  return src.replace(FOOTNOTE_DEF, "").replace(/\s*\n\s*/g, " ").trim();
}

/** 从编辑器 JSON 算出索引。 */
export function buildIndex(doc: Node): DocIndex {
  const footnotes = new Map<string, FootnoteDef>();
  const firstRefs = new Map<string, number>();
  eachNode(doc, (node, pos) => {
    if (node.type === "rawBlock") {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const label = footnoteLabel(src);
      if (label !== null && !footnotes.has(label)) footnotes.set(label, { pos, text: footnoteText(src) });
      return false;
    }
    if (node.type === "footnoteRef") {
      const label = String(node.attrs?.label ?? "");
      if (!firstRefs.has(label)) firstRefs.set(label, pos);
    }
  });
  return { headings: headingStarts(doc), footnotes, firstRefs };
}

/**
 * 开着的那篇的索引。只有一个：编辑页同一时间只有一个所见即所得编辑器。
 * 不按会话对象分开存：节点视图拿到的 `editor` 和编辑页手里的会话不是同一个 JS 对象（nsh 0.6.0 实测，按对象存取取不到）。
 */
const current = signal<DocIndex>({ headings: [], footnotes: new Map(), firstRefs: new Map() });

/** 开着的那篇的索引（响应式：在 JSX 里读会跟着刷新）。 */
export const docIndex = (): DocIndex => current();

/** 打开时和文档改过之后重算；编辑页在停手后调，不在每次按键里算。 */
export function refreshDocIndex(session: RichEditorSession) {
  current.set(buildIndex(session.getJSON() as Node));
}

/** 节点视图量出新大小的次数：展开 front matter、目录变长这种排版变化编辑器不报修订，盖在正文上的东西靠它重量位置。 */
const laidOut = signal(0);

/** 响应式：节点视图的大小变过（在 effect 里读会跟着重跑）。 */
export const nodeViewsLaidOut = (): number => laidOut();

/** 节点视图的 onLayout 调。 */
export const noteNodeViewLayout = () => laidOut.update((n) => n + 1);

/** 光标放到 `pos` 处并滚过去。 */
export function revealText(session: RichEditorSession, pos: number) {
  session.run(chain([setTextSelection(pos), scrollIntoView()]));
  reachSelection();
  session.focus();
}

/** 选中从 `pos` 开始的那个节点（原子块）并滚过去。 */
export function revealNode(session: RichEditorSession, pos: number) {
  session.run(chain([setNodeSelection(pos), scrollIntoView()]));
  reachSelection();
  session.focus();
}
