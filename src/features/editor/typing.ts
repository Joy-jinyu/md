/**
 * 打字时把写完整的 Markdown 写法换成对应的节点：任务项 `[ ] `、链接 `[字](地址)`、图片 `![说明](地址)`、公式块 `$$` 加回车、先成对再填字的行内代码。
 * 这几种编辑器的输入规则做不了（规则给不了随输入变的属性，也换不成原子节点），所以在文档改动后由 JS 补；
 * 不补的话它们留成字面文字，保存时被加上转义（`\[字](地址)`），再打开就不是用户写的意思了。
 */
import { chain, command, deleteRange, insertContent, type RichEditorSession, setLink, setMark, setTextSelection, updateAttributes } from "nsh/base";

/** `session.resolve` 给的位置信息里用到的几项；`start` / `end` 是所在文本块内容的两端。 */
interface Resolved {
  depth: number;
  parentOffset: number;
  parent: string;
  start: number;
  end: number;
}

interface Found {
  start: number;
  node: { content?: unknown[] };
}

const resolve = (session: RichEditorSession, pos: number) => session.resolve(pos) as Resolved;

const TASK = /^\[( |x|X)\] $/;
/** 结尾刚写完的 `[字](地址)` 或 `![说明](地址)`；地址里不能有空格和括号。 */
const LINK = /(!?)\[([^[\]\n]*)\]\(([^()\s]+)\)$/;
const MATH_FENCE = "$$";

/** 记最近多少次修订的光标位置：够从 onChange 往回找到它上一次修订就行。 */
const REMEMBERED = 16;

/**
 * 按修订号记光标位置，分辨「刚打了一个字」和「刚按了回车」。
 * 只在这两种时候转换：删除、撤销、粘贴、挪光标、换块类型都不算，不然退格删到 `)` 后面、或者光标没动的改动也会被转掉。
 * 要按修订号查、不能只看「最近两次」：一次按键后面可能紧跟着别的修订（斜杠菜单在网址的 `/` 后面关掉自己就是一次），
 * 等 onChange 到的时候「最近一次」已经不是打字那一次了。
 */
export function createTypedTracker() {
  const heads = new Map<number, number>();
  /** 在哪个文本块里打过几个还没用掉的反引号。 */
  let ticks = { block: -1, count: 0 };
  return {
    /** 在起点为 `block` 的文本块里刚打了一个反引号。换了块就从头数。 */
    backtickTyped(block: number) {
      ticks = { block, count: ticks.block === block ? ticks.count + 1 : 1 };
    },
    /** 这一块里有没有一对刚打的反引号可用；`spend` 时用掉。 */
    backtickPair(block: number, spend = false) {
      const has = ticks.block === block && ticks.count >= 2;
      if (has && spend) ticks = { block, count: ticks.count - 2 };
      return has;
    },
    /** 修订事件和 onChange 都来报：这次修订之后光标在哪。同一次修订只记第一回。 */
    note(head: number, revision: number) {
      if (heads.has(revision)) return;
      heads.set(revision, head);
      if (heads.size > REMEMBERED) heads.delete(Math.min(...heads.keys()));
    },
    /** 这次修订里光标往后走了几格：打一个字是 1，回车新起一段是 2；上一次修订没记到就是 0。 */
    advance(revision: number) {
      const now = heads.get(revision);
      const before = heads.get(revision - 1);
      return now === undefined || before === undefined ? 0 : now - before;
    },
  };
}

/**
 * 无序列表唯一一项开头的 `[ ] ` / `[x] `：换成任务项。
 * 列表里还有别的项时不换（一个列表在编辑器里不能半是任务半不是）；项在有序列表里也不换。
 * 段首的 `[ ] ` 不用管，编辑器自带的规则会转。
 */
function taskItem(session: RichEditorSession, here: Resolved, head: number, before: string): boolean {
  const match = TASK.exec(before);
  if (!match || here.parent !== "paragraph" || head !== here.end) return false;
  const item = session.findParentNode("listItem") as Found | null;
  const list = session.findParentNode("bulletList") as Found | null;
  if (!item || !list || item.start + 1 !== here.start || (list.node.content ?? []).length !== 1) return false;
  // 最里面那层列表得是无序的：有序列表套在无序列表里时，往外找也能找到一个无序列表
  const ordered = session.findParentNode("orderedList") as Found | null;
  if (ordered && ordered.start > list.start) return false;
  const steps = [deleteRange({ from: here.start, to: head }), command("toggleTaskList")];
  if (match[1] !== " ") steps.push(updateAttributes("taskItem", { checked: true }));
  return session.run(chain(steps));
}

export type TypedTracker = ReturnType<typeof createTypedTracker>;

/** 这段文字里反引号是单数个：光标在一段还没写完的行内代码里。 */
const insideOpenCode = (text: string) => (text.match(/`/g) ?? []).length % 2 === 1;

function linkOrImage(session: RichEditorSession, head: number, before: string): boolean {
  const match = LINK.exec(before);
  if (!match || session.isActive("link") || insideOpenCode(before.slice(0, match.index))) return false;
  const [whole, bang, label, target] = match;
  const from = head - whole.length;
  // 前面夹着行内公式这类不是文字的节点时，文字长度和位置对不上，对不上就不动
  if (from < 0 || session.textBetween(from, head, "\n") !== whole) return false;
  if (bang === "!") {
    const image = { type: "image", attrs: { src: target, alt: label, title: null } };
    return session.run(chain([deleteRange({ from, to: head }), insertContent(image)]));
  }
  if (label === "") return false;
  // 只删掉 `[` 和 `](地址)`，链接文字留在原处加上链接：文字里的加粗、行内代码不会丢
  const labelEnd = from + 1 + label.length;
  return session.run(
    chain([
      deleteRange({ from: labelEnd, to: head }),
      deleteRange({ from, to: from + 1 }),
      setTextSelection(from, labelEnd - 1),
      setLink({ href: target }),
      setTextSelection(labelEnd - 1),
    ]),
  );
}

/** 结尾是一对反引号包着的字，后面刚跟了一个不是反引号的字。 */
const CLOSED_CODE = /`([^`\n]+)`[^`]$/;

/**
 * 先打一对反引号、再回到中间填字的写法：编辑器自带的规则只认「刚打下收尾的那个反引号」，这种写法它转不了。
 * 等收尾的反引号后面再打一个字（空格、标点都行）时补转；那个字留在代码外面。
 * 只转这一块里刚打出来的那一对：文档里本来就有的字面反引号（用户特意转义的）不动，撤销回来的也不再转。
 */
function closedCode(session: RichEditorSession, tracker: TypedTracker, here: Resolved, head: number, before: string): boolean {
  const match = CLOSED_CODE.exec(before);
  if (!match || !tracker.backtickPair(here.start) || insideOpenCode(before.slice(0, match.index))) return false;
  const from = head - match[0].length;
  if (from < 0 || session.textBetween(from, head, "\n") !== match[0]) return false;
  const close = from + 1 + match[1].length;
  tracker.backtickPair(here.start, true);
  return session.run(
    chain([
      deleteRange({ from: close, to: close + 1 }),
      deleteRange({ from, to: from + 1 }),
      setTextSelection(from, close - 1),
      setMark("code"),
      setTextSelection(close),
    ]),
  );
}

/** 顶层一段只写了 `$$`，回车后光标在紧跟着的空段里：删掉那一段，交给公式编辑框。 */
function mathFence(session: RichEditorSession, here: Resolved): boolean {
  if (here.parent !== "paragraph" || here.depth !== 1 || here.parentOffset !== 0 || here.end !== here.start) return false;
  const beforeBlock = here.start - 2;
  if (beforeBlock < 1) return false;
  const above = resolve(session, beforeBlock);
  if (above.parent !== "paragraph" || above.depth !== 1) return false;
  if (session.textBetween(above.start, above.end, "\n") !== MATH_FENCE) return false;
  return session.run(deleteRange({ from: above.start - 1, to: above.end + 1 }));
}

/**
 * 文档改动后调。`tracker` 记着这次修订里光标往后走了几格（见 `createTypedTracker`）。
 * 返回 "math" 时调用方该打开公式编辑框。
 */
export function convertTyped(session: RichEditorSession, tracker: TypedTracker, revision: number): "math" | "done" | null {
  const advance = tracker.advance(revision);
  // 输入法组字中的字还没进文档；重做栈不空说明这次改动是撤销出来的
  if (session.composing || session.redoDepth > 0) return null;
  if (advance !== 1 && advance !== 2) return null;
  const { anchor = 0, head = anchor } = session.selection;
  if (anchor !== head || session.isActive("codeBlock") || session.isActive("code")) return null;
  const here = resolve(session, head);
  if (advance === 2) return mathFence(session, here) ? "math" : null;
  if (here.parent !== "paragraph" && here.parent !== "heading") return null;
  const before = session.textBetween(here.start, head, "\n");
  if (before.endsWith("`")) tracker.backtickTyped(here.start);
  return taskItem(session, here, head, before) || linkOrImage(session, head, before) || closedCode(session, tracker, here, head, before) ? "done" : null;
}
