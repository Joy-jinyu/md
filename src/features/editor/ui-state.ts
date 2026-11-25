/** 编辑页里各部件的开关：专注、打字机、命令面板、查找条每开一次编辑页建一份；侧栏跨文档保留。 */
import { cleanup, LayoutAnimation, reduceMotion, signal } from "nsh";

/** 查找条的状态：关着、只查找、查找并替换。 */
export type FindMode = null | "find" | "replace";

export function createUi() {
  return {
    focusOn: signal(false),
    typewriterOn: signal(false),
    paletteOpen: signal(false),
    findMode: signal<FindMode>(null),
  };
}

export type Ui = ReturnType<typeof createUi>;

/** 开着的编辑页登记「把焦点还给正文（原来的光标处）」，编辑页外层的对话框关掉后调。同一时间只有一个编辑页。 */
let editorFocus: (() => void) | null = null;

export function provideEditorFocus(focus: () => void) {
  editorFocus = focus;
  cleanup(() => {
    if (editorFocus === focus) editorFocus = null;
  });
}

/**
 * 对话框关掉后把焦点还给正文：放到下一轮，等对话框先收起（同命令面板的 close）。
 * macOS 窗口里对话框关掉后焦点不会自己回到正文；浏览器会，再给一次也没有副作用。
 */
export const returnFocusToEditor = () => setTimeout(() => editorFocus?.(), 0);

/** 瞬时浮层（快速打开、命令面板）登记的「收起」：返回刚才是不是开着。 */
const transients = new Set<() => boolean>();

export function registerTransient(close: () => boolean) {
  transients.add(close);
  cleanup(() => transients.delete(close));
}

/** 文档被换掉（换一篇、重新载入、在别处删了）时收起全部瞬时浮层；返回有没有收起什么。 */
export function closeTransients(): boolean {
  let closed = false;
  for (const close of transients) closed = close() || closed;
  return closed;
}

/** 侧栏的两页：文档列表、大纲。 */
export type SidebarTab = "docs" | "outline";

/** 侧栏开没开、在哪一页。放在模块顶层：切文档时编辑页整个重建，侧栏不该跟着收起。 */
export const sidebar = {
  open: signal(false),
  tab: signal<SidebarTab>("docs"),
};

/** 侧栏开合的过渡时长（毫秒），DESIGN.md「动效」定的。 */
const SIDEBAR_SLIDE_MS = 180;

/**
 * 开合侧栏，正文跟着滑过去让位。用 LayoutAnimation 而不是类上的 transition：nsh 的 transition 只管颜色、透明度、变形这些，位置和宽度的变化不会动（0.6.0 web host 实测）。
 * 给了 `tab`：侧栏开着且正在这一页就收起，否则打开到这一页（命令「大纲」「文档列表」）；不给：开着就收起、收着就按上次那页打开（顶栏按钮）。
 */
export function toggleSidebar(tab?: SidebarTab) {
  if (!reduceMotion()) LayoutAnimation.configureNext(LayoutAnimation.create(SIDEBAR_SLIDE_MS, "easeInEaseOut"));
  const closing = sidebar.open() && (tab === undefined || sidebar.tab() === tab);
  if (tab && !closing) sidebar.tab.set(tab);
  sidebar.open.set(!closing);
}
