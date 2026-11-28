/** 菜单栏「段落」里的 YAML Front Matter 和脚注：插进对应的原子节点，再选中它（选中后可以点「编辑」改源码）。 */
import { insertContent, insertContentAt, type RichEditorSession, setTextSelection } from "nsh/base";
import { buildIndex, revealNode } from "./doc-index";
import { type Node, nodeSize } from "./outline";

const docOf = (session: RichEditorSession) => session.getJSON() as Node;

/** 文首没有 front matter 就插一个空的（写出来是 `---\n\n---`），有就跳过去；然后选中它。 */
export function goToFrontMatter(session: RichEditorSession) {
  if (docOf(session).content?.[0]?.type !== "frontmatter") {
    session.run(insertContentAt(0, { type: "frontmatter", attrs: { yaml: "" } }));
  }
  revealNode(session, 0);
}

/** 在光标处插一个脚注引用 `[^n]`（n 取没用过的最小数字），文末补上它的定义行 `[^n]:` 并选中。 */
export function insertFootnote(session: RichEditorSession) {
  const index = buildIndex(docOf(session));
  let n = 1;
  while (index.footnotes.has(String(n)) || index.firstRefs.has(String(n))) n++;
  const label = String(n);
  // 有选区时插在选区末尾，不替换选中的字
  const { anchor = 0, head = anchor } = session.selection;
  if (anchor !== head) session.run(setTextSelection(Math.max(anchor, head)));
  if (!session.run(insertContent({ type: "footnoteRef", attrs: { label } }))) return;
  const end = nodeSize(docOf(session)) - 2;
  if (!session.run(insertContentAt(end, { type: "rawBlock", attrs: { src: `[^${label}]:` } }))) return;
  revealNode(session, end);
}
