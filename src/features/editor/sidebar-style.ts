/**
 * 侧栏两页（文档、大纲）共用的边线和行样式，规则见 DESIGN.md「M3：文档库」的「侧栏排版」。
 * 底色边线 x=8：面板左右各留 8；内容线 x=16：行里的字再进 8。两页都从这里取，不各写一遍。
 */

/** 面板左右内边距：页签、搜索框、工具行、列表外面都套它（底色边线）。 */
export const SIDE_PAD = "px-2";

/** 不在行里的一段字（搜索状态、空态）：落在内容线上，和行里的标题左边对齐。 */
export const SIDE_TEXT = "px-4 text-xs text-subtle";

/** 一行（搜索结果、大纲）：圆角底，左右内边距 8，按下洗色，键盘聚焦画外框。选中时调用处加 `bg-pressed`，没选中时才加 `hover:bg-hover`（选中的行悬停不变浅）。 */
export const SIDE_ROW = "rounded-(--radius-sm) px-2 active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** 列表本身：底色边线以内，行与行隔 2（相邻两行的圆角底不连成一片），上面留 4 给第一行的聚焦外框。 */
export const SIDE_LIST = "gap-0.5 px-2 pb-2 pt-1";
