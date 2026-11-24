/** 块把手：鼠标停在哪个顶层块上，它左边就出一个把手。拖动换位置，点一下出「转成 / 复制一份 / 删除」。 */
import { signal, Text, View } from "nsh";
import { chain, deleteRange, insertContentAt, type RichEditorSession, setTextSelection } from "nsh/base";
import { tip } from "../../ui/tooltip";
import { commandById } from "./commands";
import { blockIndexAt, type Node, type TopBlock, topBlocks } from "./outline";
import { blockRect, type Rect } from "./selection";

/** 把手离正文左边多远、多大（点）。正文列左边有 32 的留白，放得下。 */
const HANDLE_GAP = 26;
const HANDLE_WIDTH = 20;
const HANDLE_HEIGHT = 24;
/** 按下后移动超过这么多才算拖动，否则算点击。 */
const DRAG_SLOP = 4;

/** 能直接转成正文 / 标题的块。 */
const CONVERTIBLE = new Set(["paragraph", "heading"]);
const CONVERT_TO = ["block.paragraph", "block.h1", "block.h2", "block.h3"];

interface Hover {
  block: TopBlock;
  rect: Rect;
}

interface Point {
  x: number;
  y: number;
}

export function createBlockHandle(session: RichEditorSession) {
  const hover = signal<Hover | null>(null);
  const menuOpen = signal(false);
  let blocks: TopBlock[] = [];
  let blocksAt = -1;
  /** 顶层块的表按修订号缓存，鼠标移动时不重读整篇。 */
  const currentBlocks = () => {
    if (blocksAt !== session.revision) {
      blocks = topBlocks(session.getJSON() as Node);
      blocksAt = session.revision;
    }
    return blocks;
  };
  /** 正在拖：这期间文档变了也不收起把手，不然拖到一半把手没了，手势就断了。 */
  let dragging = false;
  const hide = () => {
    if (dragging) return;
    if (menuOpen()) menuOpen.set(false);
    if (hover()) hover.set(null);
  };
  /** 鼠标在编辑器上移动：找出它下面的顶层块。菜单开着时不跟着换块。 */
  const move = (page: Point) => {
    if (menuOpen()) return;
    const pos = session.posAtPageCoords(page);
    if (pos === null) return;
    const list = currentBlocks();
    const block = list[blockIndexAt(list, pos)];
    if (!block || hover()?.block.pos === block.pos) return;
    const rect = blockRect(session, block.pos);
    hover.set(rect ? { block, rect } : null);
  };
  const act = (run: (block: TopBlock) => void) => {
    const target = hover()?.block;
    hide();
    if (target) run(target);
    session.focus();
  };
  const convert = (id: string) =>
    act((b) => {
      const c = commandById(id);
      if (c.rich) session.run(chain([setTextSelection(b.pos + 1), c.rich]));
    });
  const duplicate = () => act((b) => session.run(insertContentAt(b.pos + b.size, b.node)));
  const remove = () => act((b) => session.run(deleteRange({ from: b.pos, to: b.pos + b.size })));
  const closeMenu = () => {
    if (menuOpen()) menuOpen.set(false);
  };
  const setDragging = (on: boolean) => {
    dragging = on;
  };
  return { hover, menuOpen, move, hide, closeMenu, convert, duplicate, remove, session, setDragging };
}

export type BlockHandleState = ReturnType<typeof createBlockHandle>;

/** 把手上的按下—移动—松开：移动过了就是拖块，没移动就是点击。 */
function dragHandlers(h: BlockHandleState) {
  let start: Point | null = null;
  let dragging = false;
  const drag = (on: boolean) => {
    dragging = on;
    h.setDragging(on);
  };
  const end = () => {
    if (dragging) h.session.endDrag();
    drag(false);
    start = null;
  };
  return {
    onStartShouldSetResponder: () => true,
    onResponderGrant: (e: { pageX: number; pageY: number }) => {
      start = { x: e.pageX, y: e.pageY };
      drag(false);
    },
    onResponderMove: (e: { pageX: number; pageY: number }) => {
      const block = h.hover()?.block;
      if (!start || !block) return;
      const point = { x: e.pageX, y: e.pageY };
      if (!dragging) {
        if (Math.abs(point.x - start.x) + Math.abs(point.y - start.y) < DRAG_SLOP) return;
        drag(true);
        h.menuOpen.set(false);
        h.session.dragBlock(block.pos, start);
      }
      h.session.dragTo(point);
    },
    onResponderRelease: () => {
      const wasDragging = dragging;
      end();
      if (wasDragging) h.hide();
      else h.menuOpen.set(!h.menuOpen());
    },
    // 没有 onPress 的话，web host 会把这次按下同时交给正文：光标跳走，拖动时还会拉出一段选区一起被搬走（2026-11-24 实测）
    onPress: () => undefined,
    onResponderTerminate: end,
  };
}

function MenuItem(props: { label: string; testID: string; danger?: boolean; onPress: () => void }) {
  return (
    <View
      testID={props.testID}
      role="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      class="h-[30px] justify-center rounded-(--radius-sm) px-2 hover:bg-hover active:bg-pressed"
    >
      <Text class="text-[13px]" classList={{ "text-destructive": !!props.danger, "text-popover-foreground": !props.danger }}>
        {props.label}
      </Text>
    </View>
  );
}

/** 放进 RichEditor 的 contentLayer：位置用正文内容框里的点。 */
export function BlockHandle(props: { handle: BlockHandleState }) {
  const h = props.handle;
  const drag = dragHandlers(h);
  return (
    <If when={h.hover()}>
      {(hover) => (
        <>
          <View
            testID="block-handle"
            role="button"
            accessibilityLabel="块操作，可拖动"
            tooltip={tip("拖动换位置，点击出菜单")}
            style={{ left: hover().rect.x - HANDLE_GAP, top: hover().rect.y + 3, width: HANDLE_WIDTH, height: HANDLE_HEIGHT }}
            class="absolute items-center justify-center rounded-(--radius-sm) hover:bg-hover active:bg-pressed"
            {...drag}
          >
            <Text class="text-[15px] font-bold leading-4 text-muted-foreground">⋮⋮</Text>
          </View>
          <If when={h.menuOpen()}>
            <View
              testID="block-menu"
              accessibilityLabel="块操作"
              style={{ left: hover().rect.x - HANDLE_GAP, top: hover().rect.y + 3 + HANDLE_HEIGHT + 4 }}
              class="absolute w-[140px] rounded-(--radius) border border-border bg-popover p-1"
            >
              <If when={CONVERTIBLE.has(hover().block.node.type)}>
                <Each of={CONVERT_TO} key={(id) => id}>
                  {(id) => <MenuItem testID={`block-menu-${id()}`} label={`转成${commandById(id()).label}`} onPress={() => h.convert(id())} />}
                </Each>
                <View class="my-1 h-px bg-border" />
              </If>
              <MenuItem testID="block-menu-duplicate" label="复制一份" onPress={h.duplicate} />
              <MenuItem testID="block-menu-delete" label="删除" danger onPress={h.remove} />
            </View>
          </If>
        </>
      )}
    </If>
  );
}
