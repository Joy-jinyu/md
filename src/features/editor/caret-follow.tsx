/**
 * 让光标所在的行停在合适的地方：打字机模式下停在正文区的垂直中间；平时打字时光标下面至少留出一截空白，不贴着窗口底边。
 * 编辑器自己只会滚到刚好露出光标，也没有滚动余量或滚到指定位置的接口（nsh 0.6.0 的类型里只有不带对齐的 scrollIntoView）。
 * 做法：在 contentLayer 里放一个看不见的方块，盖在光标的位置上，再让它 `reveal`——contentLayer 在编辑器滚动的那个盒子里，
 * reveal 会把编辑器的滚动挪到让这个方块居中（或露出）的位置（S0 第 11 项，2026-11-25 web host 实测）。
 */
import { type MouseEvent as PointerEvent, signal, View, type ViewRef } from "nsh";
import type { RichEditorSession } from "nsh/base";
import { type Rect, selectionRange } from "./selection";

/** 平时打字时光标下面至少留多少空白（pt）：大约四行正文，打到窗口底部时下面还看得见几行。 */
const BOTTOM_ROOM = 120;

interface Point {
  x: number;
  y: number;
}

/**
 * 选区这次变化是不是鼠标点出来、拖出来的。nsh 0.6.0 不报编辑器里的鼠标按下，web host 上编辑器里的按键也不冒泡到外层的 onKeyDown（2026-11-25 实测），
 * 只能这样认：鼠标按着在动；或者鼠标动过、松开过之后还没被键盘用过（armed），新选区又就在鼠标下面（同一行，或鼠标指着的位置在选区里）。
 * 认成键盘一次就不再信鼠标停着的位置，直到鼠标再动或再松开：不然光标经过鼠标停着的那一行时会隔一下居中一下。
 * 代价：键盘挪过光标后鼠标一点不动、原地再点一下，这一下会居中。
 */
function createPointer(session: RichEditorSession) {
  let at: Point | null = null;
  let pressed = false;
  let armed = false;
  const near = (from: number, to: number, head: number): boolean => {
    if (!at || !armed) return false;
    try {
      const pos = session.posAtPageCoords(at);
      if (pos !== null && pos >= from && pos <= to) return true;
      const r = session.pageCoordsAtPos(head) as Rect | null;
      return !!r && Math.abs(r.y + r.height / 2 - at.y) < r.height / 2;
    } catch (e) {
      console.warn("pointer position unavailable", e);
      return false;
    }
  };
  return {
    move: (e: PointerEvent) => {
      at = e.pagePosition;
      pressed = e.pressedButton !== null;
      armed = true;
    },
    up: (e: PointerEvent) => {
      at = e.pagePosition;
      pressed = false;
      armed = true;
    },
    /** 按着键拖出编辑器时还在选（编辑器会自己往下滚），不算离开。 */
    leave: (e: PointerEvent) => {
      if (e.pressedButton !== null) return;
      at = null;
      pressed = false;
    },
    /** 不是鼠标带来的选区变化：顺手作废鼠标停着的位置。 */
    drives: (from: number, to: number, head: number) => {
      const yes = pressed || near(from, to, head);
      if (!yes) armed = false;
      return yes;
    },
    /** 打了字：之后的光标移动按键盘算。 */
    typed: () => {
      armed = false;
      pressed = false;
    },
  };
}

export function createCaretFollow(session: RichEditorSession) {
  const box = signal<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  const pointer = createPointer(session);
  let node: ViewRef | null = null;
  const caret = (): Rect | null => {
    try {
      return session.coordsAtPos(selectionRange(session).head) as Rect | null;
    } catch (e) {
      console.warn("caret position unavailable", e);
      return null;
    }
  };
  const reveal = (extra: number, vertical: "center" | "nearest") => {
    const r = caret();
    if (!r || !node) return;
    box.set({ x: r.x, y: r.y, width: 1, height: r.height + extra });
    node.reveal({ vertical, horizontal: "nearest", animated: false });
  };
  return {
    box,
    pointer,
    attach: (ref: ViewRef) => {
      node = ref;
    },
    /** 把光标所在的行滚到正文区的垂直中间（打字机模式）。 */
    center: () => reveal(0, "center"),
    /** 光标下面留不够空白时往上滚一点；够的话不动。 */
    keepRoom: () => reveal(BOTTOM_ROOM, "nearest"),
  };
}

export type CaretFollow = ReturnType<typeof createCaretFollow>;

/** 放进 RichEditor 的 contentLayer：看不见、不接点击，只给 reveal 当目标。 */
export function CaretMarker(props: { follow: CaretFollow }) {
  const b = () => props.follow.box();
  return <View ref={props.follow.attach} class="absolute" style={{ left: b().x, top: b().y, width: b().width, height: b().height, pointerEvents: "none" }} />;
}
