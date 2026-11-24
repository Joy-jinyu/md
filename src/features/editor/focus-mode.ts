/** 专注模式：光标所在的顶层块照常显示，其余的淡下去。 */
import type { RichDecoration, RichEditorSession } from "nsh/base";
import { blockIndexAt, type Node, topBlocks } from "./outline";
import { FOCUS_KEY } from "./rich-session";
import { selectionRange } from "./selection";

const DIMMED = "opacity-35";

export function createFocusMode(session: RichEditorSession) {
  // 交装饰本身会让编辑器再报一次修订；记下上次按什么算的，没变就不再交，免得绕圈
  let painted = "";
  const clear = () => {
    if (painted === "") return;
    painted = "";
    session.setDecorations(FOCUS_KEY, []);
  };
  const sync = (on: boolean) => {
    if (!on) return clear();
    const blocks = topBlocks(session.getJSON() as Node);
    const current = blockIndexAt(blocks, selectionRange(session).head);
    const size = blocks.reduce((sum, b) => sum + b.size, 0);
    const signature = `${current}:${blocks.length}:${size}`;
    if (signature === painted) return;
    painted = signature;
    const dim: RichDecoration[] = blocks
      .filter((_, i) => i !== current)
      .map((b) => ({ from: b.pos, to: b.pos + b.size, kind: "node", attrs: { class: DIMMED } }));
    session.setDecorations(FOCUS_KEY, dim);
  };
  return { sync };
}
