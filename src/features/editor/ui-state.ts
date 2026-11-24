/** 编辑页里各部件的开关：大纲、专注、命令面板、查找条。每开一次编辑页建一份。 */
import { LayoutAnimation, reduceMotion, signal } from "nsh";

/** 查找条的状态：关着、只查找、查找并替换。 */
export type FindMode = null | "find" | "replace";

export function createUi() {
  return {
    outlineOpen: signal(false),
    focusOn: signal(false),
    paletteOpen: signal(false),
    findMode: signal<FindMode>(null),
  };
}

export type Ui = ReturnType<typeof createUi>;

/** 大纲侧栏开合的过渡时长（毫秒），DESIGN.md「动效」定的。 */
const OUTLINE_SLIDE_MS = 180;

/**
 * 开合大纲侧栏，正文跟着滑过去让位。
 * 用 LayoutAnimation 而不是类上的 transition：nsh 的 transition 只管颜色、透明度、变形这些，位置和宽度的变化不会动（0.6.0 web host 实测）。
 */
export function toggleOutline(ui: Ui) {
  if (!reduceMotion()) LayoutAnimation.configureNext(LayoutAnimation.create(OUTLINE_SLIDE_MS, "easeInEaseOut"));
  ui.outlineOpen.set(!ui.outlineOpen());
}
