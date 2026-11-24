/** 读编辑器选区和块位置的小工具。 */
import type { RichEditorSession } from "nsh/base";

/** 选区的两端（from ≤ to）、会动的那一端和选区种类。 */
export function selectionRange(session: RichEditorSession) {
  const { anchor = 0, head = anchor, type } = session.selection;
  return { from: Math.min(anchor, head), to: Math.max(anchor, head), head, type };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 起始位置在 `pos` 的块在正文内容框里的位置；编辑器还没显示、或 `pos` 不是块的开头时是 null。 */
export function blockRect(session: RichEditorSession, pos: number): Rect | null {
  try {
    return session.nodeRect(pos) as Rect | null;
  } catch {
    return null;
  }
}
