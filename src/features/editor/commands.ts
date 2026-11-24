/** 编辑页的全部命令：斜杠菜单、命令面板、快捷键都从这一张表取。 */
import { colorScheme, setColorScheme } from "nsh";
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  command,
  deleteColumn,
  deleteRow,
  deleteTable,
  insertContent,
  insertTable,
  type RichCommand,
  type RichEditorSession,
  unsetAllMarks,
} from "nsh/base";
import { STRIKE_KEY } from "../../platform";
import { requestFile } from "../files/requests";
import { settingsOpen } from "../settings/open";
import { runHeadingStep } from "./heading-step";
import { toggleOutline, type Ui } from "./ui-state";

/** 能用编辑框改源码的原子节点。 */
export type AtomKind = "mathBlock" | "mathInline" | "diagram";

/** 命令执行时能用到的东西。 */
export interface CommandContext {
  ui: Ui;
  /** 所见即所得的会话；在源码视图里是 null，这时只有「视图」组的命令能用。 */
  session: RichEditorSession | null;
  askLink(): void;
  askAtom(kind: AtomKind): void;
  /** 在所见即所得和源码之间切换；只能用源码方式打开的文档是 null。 */
  toggleSource: (() => void) | null;
}

export type CommandGroup = "块" | "格式" | "表格" | "视图" | "文件";

/**
 * 一条命令。`rich` 是只靠编辑器命令就能完成的；要读状态、要弹框的写在 `act` 里。
 * `key` 是默认键，用 ProseMirror 的写法（`Mod-Shift-p`）；现在实际用哪个键问 `keybindings.ts` 的 `keyOf`（设置里可以改）。
 * 带 `rich` 的由编辑器的键表处理，其余由 JS 截下来。
 */
export interface AppCommand {
  id: string;
  label: string;
  /** 英文名和拼音首字母，过滤时和 label 一起比。 */
  keywords: string[];
  group: CommandGroup;
  key?: string;
  /** 出现在斜杠菜单里。 */
  slash?: boolean;
  /** 菜单里行首的小记号，一眼认出是哪种块。 */
  glyph?: string;
  rich?: RichCommand;
  act?: (ctx: CommandContext) => void;
}

const heading = (level: number): AppCommand => ({
  id: `block.h${level}`,
  label: `标题 ${level}`,
  keywords: [`h${level}`, "heading", `bt${level}`],
  group: "块",
  glyph: `H${level}`,
  key: `Mod-${level}`,
  slash: true,
  rich: command("setHeading", { level }),
});

/** 顺序就是斜杠菜单和命令面板里的顺序：常用的在前，正文和四到六级标题在后。 */
const BLOCKS: AppCommand[] = [
  heading(1),
  heading(2),
  heading(3),
  { id: "block.bullet", label: "无序列表", keywords: ["ul", "bullet", "list", "wxlb"], group: "块", glyph: "•", key: "Mod-Alt-u", slash: true, rich: command("toggleBulletList") },
  { id: "block.ordered", label: "有序列表", keywords: ["ol", "ordered", "number", "yxlb"], group: "块", glyph: "1.", key: "Mod-Alt-o", slash: true, rich: command("toggleOrderedList") },
  { id: "block.task", label: "任务列表", keywords: ["todo", "task", "check", "rwlb"], group: "块", glyph: "☐", slash: true, rich: command("toggleTaskList") },
  { id: "block.quote", label: "引用", keywords: ["quote", "blockquote", "yy"], group: "块", glyph: "❝", key: "Mod-Alt-q", slash: true, rich: command("toggleBlockquote") },
  { id: "block.code", label: "代码块", keywords: ["code", "pre", "dmk"], group: "块", glyph: "</>", key: "Mod-Alt-c", slash: true, rich: command("toggleCodeBlock") },
  { id: "block.table", label: "表格", keywords: ["table", "bg"], group: "块", glyph: "▦", key: "Mod-Alt-t", slash: true, rich: insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { id: "block.rule", label: "分隔线", keywords: ["hr", "rule", "divider", "fgx"], group: "块", glyph: "—", slash: true, rich: command("setHorizontalRule") },
  { id: "inline.link", label: "链接", keywords: ["link", "url", "lj"], group: "块", glyph: "↗", key: "Mod-k", slash: true, act: (ctx) => ctx.askLink() },
  { id: "block.math", label: "公式块", keywords: ["math", "latex", "formula", "gsk"], group: "块", glyph: "∑", slash: true, act: (ctx) => ctx.askAtom("mathBlock") },
  { id: "inline.math", label: "行内公式", keywords: ["inline math", "imath", "hngs"], group: "块", glyph: "x²", slash: true, act: (ctx) => ctx.askAtom("mathInline") },
  { id: "block.mermaid", label: "Mermaid 图", keywords: ["mermaid", "diagram", "lct", "tu"], group: "块", glyph: "◇", slash: true, act: (ctx) => ctx.askAtom("diagram") },
  { id: "block.toc", label: "目录", keywords: ["toc", "contents", "ml"], group: "块", glyph: "≡", slash: true, rich: insertContent({ type: "toc" }) },
  { id: "block.paragraph", label: "正文", keywords: ["text", "paragraph", "zw"], group: "块", glyph: "¶", key: "Mod-0", slash: true, rich: command("setParagraph") },
  heading(4),
  heading(5),
  heading(6),
];

/** 粗体 / 斜体 / 下划线 / 高亮的默认键和 StarterKit 自带的一样（Mod-b / i / u、Mod-Shift-h）；设置里改走以后，旧键由 `keybindings.ts` 的 `shadowedDefaults` 挡掉。 */
const FORMATS: AppCommand[] = [
  { id: "format.bold", label: "粗体", keywords: ["bold", "ct"], group: "格式", key: "Mod-b", rich: command("toggleBold") },
  { id: "format.italic", label: "斜体", keywords: ["italic", "xt"], group: "格式", key: "Mod-i", rich: command("toggleItalic") },
  { id: "format.underline", label: "下划线", keywords: ["underline", "xhx"], group: "格式", key: "Mod-u", rich: command("toggleUnderline") },
  { id: "format.strike", label: "删除线", keywords: ["strike", "scx"], group: "格式", key: STRIKE_KEY, rich: command("toggleStrike") },
  { id: "format.code", label: "行内代码", keywords: ["inline code", "hndm"], group: "格式", key: "Mod-Shift-`", rich: command("toggleCode") },
  { id: "format.highlight", label: "高亮", keywords: ["highlight", "mark", "gl"], group: "格式", key: "Mod-Shift-h", rich: command("toggleHighlight") },
  { id: "format.clear", label: "清除格式", keywords: ["clear", "plain", "qcgs"], group: "格式", key: "Mod-\\", rich: unsetAllMarks() },
  { id: "format.headingUp", label: "标题升一级", keywords: ["promote", "btsj"], group: "格式", key: "Mod-=", act: (ctx) => ctx.session && runHeadingStep(ctx.session, "up") },
  { id: "format.headingDown", label: "标题降一级", keywords: ["demote", "btjj"], group: "格式", key: "Mod--", act: (ctx) => ctx.session && runHeadingStep(ctx.session, "down") },
];

/** 光标不在表格里时这些命令什么也不做（编辑器命令返回 false，键会落到别的绑定上）。 */
const TABLES: AppCommand[] = [
  { id: "table.rowBefore", label: "上方加行", keywords: ["row above", "sfjh"], group: "表格", rich: addRowBefore() },
  { id: "table.rowAfter", label: "下方加行", keywords: ["row below", "xfjh"], group: "表格", key: "Mod-Enter", rich: addRowAfter() },
  { id: "table.deleteRow", label: "删行", keywords: ["delete row", "sh"], group: "表格", key: "Mod-Shift-Backspace", rich: deleteRow() },
  { id: "table.columnBefore", label: "左侧加列", keywords: ["column left", "zcjl"], group: "表格", rich: addColumnBefore() },
  { id: "table.columnAfter", label: "右侧加列", keywords: ["column right", "ycjl"], group: "表格", rich: addColumnAfter() },
  { id: "table.deleteColumn", label: "删列", keywords: ["delete column", "sl"], group: "表格", rich: deleteColumn() },
  { id: "table.delete", label: "删表", keywords: ["delete table", "sb"], group: "表格", rich: deleteTable() },
];

const toggle = (s: { (): boolean; set(v: boolean): void }) => s.set(!s());

/**
 * 替换没用 Typora 的 Cmd+H：苹果系统把它留给「隐藏窗口」，应用绑不上（nsh 0.6.0 实测），改成 Cmd+Alt+F。
 * 源码视图没用 Typora 的 Cmd+/：nsh 的源码编辑器自己把它当「切换注释」吃掉，应用收不到，进去了就按不回来；
 * Cmd+Alt+/ 在两种编辑器里应用都收得到（2026-11-24 web host 实测），进出用同一个键。
 */
const VIEWS: AppCommand[] = [
  { id: "view.find", label: "查找", keywords: ["find", "search", "cz"], group: "视图", key: "Mod-f", act: (ctx) => ctx.ui.findMode.set("find") },
  { id: "view.replace", label: "查找并替换", keywords: ["replace", "th"], group: "视图", key: "Mod-Alt-f", act: (ctx) => ctx.ui.findMode.set("replace") },
  { id: "view.outline", label: "大纲", keywords: ["outline", "dg"], group: "视图", key: "Mod-Shift-l", act: (ctx) => toggleOutline(ctx.ui) },
  { id: "view.focus", label: "专注模式", keywords: ["focus", "zzms"], group: "视图", key: "F8", act: (ctx) => toggle(ctx.ui.focusOn) },
  { id: "view.source", label: "源码视图", keywords: ["source", "markdown", "ymst"], group: "视图", key: "Mod-Alt-/", act: (ctx) => ctx.toggleSource?.() },
  { id: "view.palette", label: "命令面板", keywords: ["command palette", "mlmb"], group: "视图", key: "Mod-Shift-p", act: (ctx) => ctx.ui.paletteOpen.set(true) },
  { id: "view.settings", label: "设置（快捷键）", keywords: ["settings", "shortcuts", "keys", "sz", "kjj"], group: "视图", key: "Mod-,", act: () => settingsOpen.set(true) },
  { id: "view.appearance", label: "切换深色 / 浅色", keywords: ["dark", "light", "theme", "ss"], group: "视图", act: () => setColorScheme(colorScheme() === "dark" ? "light" : "dark") },
];

const FILES: AppCommand[] = [
  { id: "file.open", label: "打开文件…", keywords: ["open", "import", "dkwj", "dr"], group: "文件", key: "Mod-o", act: () => requestFile("open") },
  { id: "file.saveAs", label: "另存为…", keywords: ["save as", "export", "download", "lcw", "dc"], group: "文件", key: "Mod-Shift-s", act: () => requestFile("saveAs") },
];

export const COMMANDS: AppCommand[] = [...BLOCKS, ...FORMATS, ...TABLES, ...VIEWS, ...FILES];

export const SLASH_COMMANDS = COMMANDS.filter((c) => c.slash);

export function commandById(id: string): AppCommand {
  const found = COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(`没有这条命令：${id}`);
  return found;
}

/** 不在正文里起作用、焦点在哪都该能用的命令（视图和文件两组）：键另外绑在应用级 keymap 上。 */
export const isViewCommand = (c: AppCommand) => c.group === "视图" || c.group === "文件";

/** 源码视图里也能用的命令；大纲、专注只对所见即所得有意义。 */
const WORKS_IN_SOURCE = new Set(["view.find", "view.replace", "view.palette", "view.appearance", "view.settings", "file.open", "file.saveAs"]);

/** 这条命令现在能不能用。 */
export function available(c: AppCommand, ctx: CommandContext): boolean {
  if (c.id === "view.source") return ctx.toggleSource !== null;
  return ctx.session !== null || WORKS_IN_SOURCE.has(c.id);
}

/** 执行一条命令；现在不能用就什么也不做。设置对话框开着时也不执行：那时按下的键是在录新的快捷键。 */
export function runCommand(c: AppCommand, ctx: CommandContext) {
  if (settingsOpen() || !available(c, ctx)) return;
  if (c.rich) ctx.session?.run(c.rich);
  else c.act?.(ctx);
}

/** 按输入过滤：名字或关键词里含有输入的留下，以输入开头的排前面。不分大小写，忽略空格。 */
export function filterCommands(list: AppCommand[], query: string): AppCommand[] {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return list;
  const rank = (c: AppCommand) => {
    const words = [c.label, ...c.keywords].map((w) => w.toLowerCase().replace(/\s+/g, ""));
    if (words.some((w) => w.startsWith(q))) return 0;
    return words.some((w) => w.includes(q)) ? 1 : 2;
  };
  return list
    .map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r < 2)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.c);
}
