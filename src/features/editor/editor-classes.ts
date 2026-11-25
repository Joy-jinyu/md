/** 正文列的排版（DESIGN.md「字号」一节）：RichEditor 各部分和各节点、mark 的类。 */
import type { RichEditorClasses } from "nsh/base";

/** 块上下各 6：两个块之间 12。 */
const BLOCK = "my-1.5";
const heading = "mb-1.5 mt-5 font-semibold text-strong";
/**
 * 列表项之间只留 4：段落自带的上下 6 用项上的 -my-1.5 抵掉，再由列表的 gap-1 给。
 * 不抵的话紧凑列表每一项隔得和段落一样开，看起来像一段一段的（2026-11-24 实测）。
 * 外层盒子（content）上的 gap 对块不起作用（nsh 0.6.0 web host 实测），所以块距只能写在各个块上。
 */
const ITEM = "-my-1.5";
const ALERT = "pt-7 text-foreground";

export const EDITOR_CLASSES: RichEditorClasses = {
  root: "flex-1 text-foreground",
  content: "mx-auto w-full max-w-[760px] px-8 pb-10 pt-10",
  placeholder: "text-faint",
  listMarker: "text-muted-foreground",
  // 上边 13 = 段落的上留白 6 + 让 16 高的框在 30 的行高里居中的 7
  taskCheckbox: "mr-2 mt-[13px] size-4 rounded-[4px] border border-border-strong checked:border-primary checked:bg-primary",
  // 行、列的拖动把手：平时很淡，鼠标移上去才显出来，不抢表格边线
  tableGrip: "rounded-full bg-border-strong opacity-50 hover:bg-primary hover:opacity-100",
  nodes: {
    paragraph: `${BLOCK} text-[17px] leading-[30px]`,
    "heading[level=1]": `${heading} text-[30px] leading-[40px]`,
    "heading[level=2]": `${heading} text-[24px] leading-[34px]`,
    "heading[level=3]": `${heading} text-[20px] leading-[30px]`,
    "heading[level=4]": `${heading} text-[18px] leading-[28px]`,
    "heading[level=5]": `${heading} text-[17px] leading-[28px]`,
    "heading[level=6]": "mb-1.5 mt-5 text-[15px] font-semibold leading-[26px] text-muted-foreground",
    blockquote: `${BLOCK} border-l-[3px] border-border-strong pl-4 text-muted-foreground`,
    // 提示块：左边色条换成类型色，上面留 28 给类型标签（标签由 BlockOverlays 盖上去：挂件装饰的文字 web host 不显示，nsh 0.6.0 实测）
    "blockquote[alert=note]": `${ALERT} border-alert-note`,
    "blockquote[alert=tip]": `${ALERT} border-alert-tip`,
    "blockquote[alert=important]": `${ALERT} border-alert-important`,
    "blockquote[alert=warning]": `${ALERT} border-alert-warning`,
    "blockquote[alert=caution]": `${ALERT} border-alert-caution`,
    codeBlock: `${BLOCK} rounded-(--radius-sm) bg-muted px-4 py-3 font-mono text-[14px] leading-[22px]`,
    bulletList: `${BLOCK} gap-1 pl-6`,
    orderedList: `${BLOCK} gap-1 pl-6`,
    taskList: `${BLOCK} gap-1`,
    listItem: ITEM,
    taskItem: ITEM,
    horizontalRule: "my-4 h-px bg-border",
    table: "my-3",
    tableCell: "border border-border px-3 py-0.5",
    tableHeader: "border border-border bg-muted px-3 py-0.5 font-semibold",
    "tableCell[align=center]": "text-center",
    "tableCell[align=right]": "text-right",
    "tableHeader[align=center]": "text-center",
    "tableHeader[align=right]": "text-right",
    mathBlock: BLOCK,
    diagram: BLOCK,
    rawBlock: BLOCK,
    frontmatter: BLOCK,
    toc: BLOCK,
    mathInline: "align-middle",
    htmlInline: "align-middle",
  },
  marks: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
    strike: "line-through",
    // 不能给 mark 加左右内边距：nsh 0.6.0 算光标位置时不把它算进去，光标会画在偏左 8 的地方，
    // 行内代码末尾的光标看起来停在最后一个字前面、像是移不到最右边（2026-11-24 web host 实测，去掉 px-1 后对上）
    code: "rounded-(--radius-sm) bg-muted font-mono text-[15px]",
    link: "text-primary underline",
    highlight: "bg-warn-tint",
    // 上下标只能缩小字号：nsh 0.6.0 的 mark 不认 translate、align-*，也不认 em 字号，字只能落在基线上（2026-11-25 web host 实测）
    subscript: "text-[13px]",
    superscript: "text-[13px]",
  },
};
