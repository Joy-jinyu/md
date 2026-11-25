/**
 * 让光标所在的行停在合适的地方：打字机模式下停在正文区的垂直中间；平时打字时光标下面至少留出一截空白，不贴着窗口底边。
 * 编辑器自己只会滚到刚好露出光标，也没有滚动余量或滚到指定位置的接口（nsh 0.6.0 的类型里只有不带对齐的 scrollIntoView）。
 * 做法：在 contentLayer 里放一个看不见的方块，盖在光标的位置上，再让它 `reveal`——contentLayer 在编辑器滚动的那个盒子里，
 * reveal 会把编辑器的滚动挪到让这个方块居中（或露出）的位置（S0 第 11 项，2026-11-25 web host 实测）。
 */
import { cleanup, type MouseEvent as PointerEvent, signal, View, type ViewRef, windowSize } from "nsh";
import type { RichEditorSession } from "nsh/base";
import { type Rect, selectionRange } from "./selection";

/** 平时打字时光标下面至少留多少空白（pt）：大约四行正文，打到窗口底部时下面还看得见几行。 */
const BOTTOM_ROOM = 120;
/** 跳到没挂上的块时最多估几次、每次等多久（毫秒）让那一片挂上：2026-11-25 web host 实测（600 段、带表格和图的长文）第一次估完就挂上，后几次是修正的余量。 */
const REACH_TRIES = 4;
const REACH_WAIT = 50;
/** 挂上以后再居中几次（每次隔 REACH_WAIT 的两倍）：上面的块挂上后量出的高和估的不一样，目标会被挤走。 */
const SETTLE_PASSES = 3;
/** 拿视口那一处的文档位置时取的横坐标（内容盒的点）：正文列左边内边距里面一点，落在文字上。 */
const PROBE_X = 40;
/** 跳转的目标算「已经看得见」的范围（窗口里的点）：上面让出顶栏和查找条（44 + 44），下面留一行。 */
const SIGHT_TOP = 96;
const SIGHT_BOTTOM = 40;

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

/** `reached`：跳转补滚完了（滚过去的那一片新挂上了块，盖在块上的东西要重量位置）。 */
export function createCaretFollow(session: RichEditorSession, reached: () => void) {
  const box = signal<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  const pointer = createPointer(session);
  let node: ViewRef | null = null;
  /** 内容盒的高（没挂上的块按估计的高算）：contentLayer 里铺满的那个方块报上来。 */
  let contentHeight = 0;
  /** 正在补滚的那一轮：新的跳转来了先停掉旧的，不然两轮互相拽。 */
  let reachTimer: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => clearTimeout(reachTimer));
  /** 选区头的框；选中的是整个节点（脚注定义、公式块）时取节点的框：块状原子节点前面的位置 coordsAtPos 量不出来（2026-11-25 实测）。 */
  const caret = (): Rect | null => {
    try {
      const { head, type } = selectionRange(session);
      if (type === "node") return (session.nodeRect(head) ?? session.coordsAtPos(head)) as Rect | null;
      return session.coordsAtPos(head) as Rect | null;
    } catch (e) {
      console.warn("caret position unavailable", e);
      return null;
    }
  };
  /** 内容盒里纵坐标 `y` 那一处的文档位置；那一片没挂上是 null。 */
  const posAt = (y: number): number | null => {
    try {
      return session.posAtCoords({ x: PROBE_X, y });
    } catch (e) {
      console.warn("position at point unavailable", e);
      return null;
    }
  };
  /**
   * 选区头所在的块还没挂上时（nsh 0.7.0 起长文档只挂视口附近的块，scrollIntoView 对从没挂上过的块不滚；焦点不在编辑器里时对挂上了的也不一定滚，2026-11-25 web host 实测）：
   * 先按它在全文里的位置比例估一个高度滚过去；那一片挂上后用那里实际的文档位置修正，再滚；挂上了就把它滚到正文区中间。
   */
  const settle = (passes: number) => {
    reveal(0, "center");
    reached();
    if (passes > 1) reachTimer = setTimeout(() => settle(passes - 1), REACH_WAIT * 2);
  };
  /** 选区头在窗口里看得见：跳转时看得见就不挪（查找一处处往下走时不来回晃）。 */
  const inSight = (): boolean => {
    try {
      const r = session.pageCoordsAtPos(selectionRange(session).head) as Rect | null;
      return !!r && r.y >= SIGHT_TOP && r.y + r.height <= windowSize().height - SIGHT_BOTTOM;
    } catch (e) {
      console.warn("caret page position unavailable", e);
      return false;
    }
  };
  /** 目标看得见就不挪，但上面的块挂上、量出真高以后它还会被挤走（2026-11-25 web host 实测：停在窗口底边）：隔一会儿再看几次，挤出去了再居中。 */
  const watchSight = (passes: number) => {
    if (passes <= 0) return;
    reachTimer = setTimeout(() => (inSight() ? watchSight(passes - 1) : settle(SETTLE_PASSES)), REACH_WAIT * 2);
  };
  const reach = (tries: number, lastY: number | null) => {
    if (caret()) {
      if (tries < REACH_TRIES || !inSight()) settle(SETTLE_PASSES);
      else watchSight(SETTLE_PASSES);
      return;
    }
    if (tries === 0 || !node || contentHeight <= 0) return;
    const head = selectionRange(session).head;
    const perPos = contentHeight / Math.max(1, session.characters("nodeSize"));
    const here = lastY === null ? null : posAt(lastY);
    const y = here === null || lastY === null ? head * perPos : lastY + (head - here) * perPos;
    const target = Math.max(0, Math.min(contentHeight - 1, y));
    box.set({ x: 0, y: target, width: 1, height: 1 });
    node.reveal({ vertical: "center", horizontal: "nearest", animated: false });
    reachTimer = setTimeout(() => reach(tries - 1, target), REACH_WAIT);
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
    /** 量到 0 的那次不算：跳转的那一下内容层会报一次 0（2026-11-25 web host 实测）。 */
    measure: (height: number) => {
      if (height > 0) contentHeight = height;
    },
    /**
     * 跳转（查找、大纲、目录、脚注……）设好选区、跑过 scrollIntoView 以后调：目标没挂上、或者不在窗口里时滚到正文区中间。
     * 等 REACH_WAIT 再看，不是下一轮就看：下一轮时滚动后挂上的块还没量完，量出的位置偏上（之后再变见 `watchSight`）。
     */
    reach: () => {
      clearTimeout(reachTimer);
      reachTimer = setTimeout(() => reach(REACH_TRIES, null), REACH_WAIT);
    },
    /** 把光标所在的行滚到正文区的垂直中间（打字机模式）。 */
    center: () => reveal(0, "center"),
    /** 光标下面留不够空白时往上滚一点；够的话不动。 */
    keepRoom: () => reveal(BOTTOM_ROOM, "nearest"),
  };
}

export type CaretFollow = ReturnType<typeof createCaretFollow>;

/** 开着的编辑页的 follow：跳转的地方（节点视图拿到的 editor 和编辑页的会话不是同一个对象）经 `reachSelection` 找到它。 */
let mounted: CaretFollow | null = null;

/** 选区设好、scrollIntoView 跑过以后调：选区头的块要是还没挂上，补滚过去（见 createCaretFollow 的 reach）。 */
export function reachSelection() {
  mounted?.reach();
}

/**
 * 放进 RichEditor 的 contentLayer：看不见、不接点击，只给 reveal 当目标。外面包一条 1 点宽、和内容盒一样高的竖条，量内容的高。
 * 竖条不能铺满整个内容盒：无头测试按它算遮挡，节点视图里的按钮就按不到了；里面要有这个方块，不然它只报一次高 0（2026-11-25 实测）。
 */
export function CaretMarker(props: { follow: CaretFollow }) {
  const b = () => props.follow.box();
  mounted = props.follow;
  cleanup(() => {
    if (mounted === props.follow) mounted = null;
  });
  return (
    <View class="pointer-events-none absolute inset-y-0 left-0 w-px" onLayout={(e) => props.follow.measure(e.bounds.size.height)}>
      <View ref={props.follow.attach} class="absolute" style={{ left: b().x, top: b().y, width: b().width, height: b().height, pointerEvents: "none" }} />
    </View>
  );
}
