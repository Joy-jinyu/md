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
  wrapIn,
} from "nsh/base";
import { t } from "../../i18n";
import { APPLE_KEYS, IN_BROWSER, SIGN_IN_FLOW, STRIKE_KEY } from "../../platform";
import { syncConfigured } from "../../sync/config";
import { requestFile } from "../files/requests";
import { historyOpen, quickOpenOpen, requestLibrary } from "../library/requests";
import { settingsOpen } from "../settings/open";
import { syncOpen } from "../sync/open";
import { copyAsMarkdown } from "./copy-markdown";
import { runHeadingStep } from "./heading-step";
import { altEditRequest, canResize, deleteImage, selectedImage, setImageAttr } from "./images";
import { insertRule } from "./insert-rule";
import { selectFormat, selectLine, selectWord } from "./select";
import { toggleSidebar, type Ui } from "./ui-state";

/** 能用编辑框改源码的原子节点。 */
export type AtomKind = "mathBlock" | "mathInline" | "diagram" | "frontmatter" | "rawBlock";

/** 命令执行时能用到的东西。 */
export interface CommandContext {
  ui: Ui;
  /** 所见即所得的会话；在源码视图里是 null，这时只有「视图」组的命令能用。 */
  session: RichEditorSession | null;
  askLink(): void;
  askAtom(kind: AtomKind): void;
  /** 在所见即所得和源码之间切换；只能用源码方式打开的文档是 null。 */
  toggleSource: (() => void) | null;
  /** 光标所在代码块的工具（语言、复制）；光标不在代码块里时什么也不做。源码视图里没有。 */
  codeBlock?: { chooseLanguage(): void; copy(): void };
  /** 图片：弹选择框插图、把这篇的外链图片都转存到本地。源码视图里没有。 */
  images?: { insert(): void; transferAll(): void };
}

export type CommandGroup = "块" | "格式" | "编辑" | "表格" | "视图" | "文件";

const GROUP_NAMES: Record<CommandGroup, string> = {
  块: "Blocks",
  格式: "Formatting",
  编辑: "Edit",
  表格: "Table",
  视图: "View",
  文件: "File",
};

export const commandGroupLabel = (group: CommandGroup) => t(group, GROUP_NAMES[group]);

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
  get label() { return t(`标题 ${level}`, `Heading ${level}`); },
  keywords: [`h${level}`, "heading", `bt${level}`],
  group: "块",
  glyph: `H${level}`,
  key: `Mod-${level}`,
  slash: true,
  rich: command("setHeading", { level }),
});

/** GitHub 的五种提示块：把当前段落包进带类型的引用，写出 `> [!NOTE]` 这样的头。 */
export const ALERT_KINDS = [
  { alert: "note", get label() { return t("备注", "Note"); }, pinyin: "bz" },
  { alert: "tip", get label() { return t("提示", "Tip"); }, pinyin: "ts" },
  { alert: "important", get label() { return t("重要", "Important"); }, pinyin: "zy" },
  { alert: "warning", get label() { return t("警告", "Warning"); }, pinyin: "jg" },
  { alert: "caution", get label() { return t("小心", "Caution"); }, pinyin: "xx" },
] as const;

const ALERTS: AppCommand[] = ALERT_KINDS.map((k) => ({
  id: `block.alert.${k.alert}`,
  get label() { return t(`提示块：${k.label}`, `Callout: ${k.label}`); },
  keywords: ["alert", "callout", "tsk", k.alert, k.pinyin],
  group: "块",
  glyph: "!",
  slash: true,
  rich: wrapIn("blockquote", { alert: k.alert }),
}));

/** 顺序就是斜杠菜单和命令面板里的顺序：常用的在前，正文和四到六级标题在后。 */
const BLOCKS: AppCommand[] = [
  heading(1),
  heading(2),
  heading(3),
  { id: "block.bullet", get label() { return t("无序列表", "Bulleted List"); }, keywords: ["ul", "bullet", "list", "wxlb"], group: "块", glyph: "•", key: "Mod-Alt-u", slash: true, rich: command("toggleBulletList") },
  { id: "block.ordered", get label() { return t("有序列表", "Numbered List"); }, keywords: ["ol", "ordered", "number", "yxlb"], group: "块", glyph: "1.", key: "Mod-Alt-o", slash: true, rich: command("toggleOrderedList") },
  { id: "block.task", get label() { return t("任务列表", "Task List"); }, keywords: ["todo", "task", "check", "rwlb"], group: "块", glyph: "☐", slash: true, rich: command("toggleTaskList") },
  { id: "block.quote", get label() { return t("引用", "Block Quote"); }, keywords: ["quote", "blockquote", "yy"], group: "块", glyph: "❝", key: "Mod-Alt-q", slash: true, rich: command("toggleBlockquote") },
  { id: "block.code", get label() { return t("代码块", "Code Block"); }, keywords: ["code", "pre", "dmk"], group: "块", glyph: "</>", key: "Mod-Alt-c", slash: true, rich: command("toggleCodeBlock") },
  { id: "block.codeLanguage", get label() { return t("设置代码块语言", "Set Code Block Language"); }, keywords: ["code language", "language", "szdmkyy", "yy"], group: "块", act: (ctx) => ctx.codeBlock?.chooseLanguage() },
  { id: "block.codeCopy", get label() { return t("复制代码块", "Copy Code Block"); }, keywords: ["copy code", "fzdmk"], group: "块", act: (ctx) => ctx.codeBlock?.copy() },
  { id: "block.table", get label() { return t("表格", "Table"); }, keywords: ["table", "bg"], group: "块", glyph: "▦", key: "Mod-Alt-t", slash: true, rich: insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { id: "block.rule", get label() { return t("分隔线", "Horizontal Rule"); }, keywords: ["hr", "rule", "divider", "fgx"], group: "块", glyph: "—", slash: true, act: (ctx) => ctx.session && insertRule(ctx.session) },
  { id: "inline.link", get label() { return t("链接", "Link"); }, keywords: ["link", "url", "lj"], group: "块", glyph: "↗", key: "Mod-k", slash: true, act: (ctx) => ctx.askLink() },
  // 插图照 Typora 用 Cmd+Ctrl+I；Mod 就是 Ctrl 的键位上没有这个组合，换成 Ctrl+Alt+I（Ctrl+Shift+I 是浏览器的开发者工具）
  { id: "insert.image", get label() { return t("插入图片…", "Insert Image…"); }, keywords: ["image", "picture", "img", "crtp", "tp"], group: "块", glyph: "▣", key: APPLE_KEYS ? "Mod-Ctrl-i" : "Ctrl-Alt-i", slash: true, act: (ctx) => ctx.images?.insert() },
  { id: "block.math", get label() { return t("公式块", "Math Block"); }, keywords: ["math", "latex", "formula", "gsk"], group: "块", glyph: "∑", slash: true, act: (ctx) => ctx.askAtom("mathBlock") },
  { id: "inline.math", get label() { return t("行内公式", "Inline Math"); }, keywords: ["inline math", "imath", "hngs"], group: "块", glyph: "x²", slash: true, act: (ctx) => ctx.askAtom("mathInline") },
  { id: "block.mermaid", get label() { return t("Mermaid 图", "Mermaid Diagram"); }, keywords: ["mermaid", "diagram", "lct", "tu"], group: "块", glyph: "◇", slash: true, act: (ctx) => ctx.askAtom("diagram") },
  ...ALERTS,
  { id: "block.toc", get label() { return t("目录", "Table of Contents"); }, keywords: ["toc", "contents", "ml"], group: "块", glyph: "≡", slash: true, rich: insertContent({ type: "toc" }) },
  { id: "block.paragraph", get label() { return t("正文", "Paragraph"); }, keywords: ["text", "paragraph", "zw"], group: "块", glyph: "¶", key: "Mod-0", slash: true, rich: command("setParagraph") },
  heading(4),
  heading(5),
  heading(6),
];

/** 粗体 / 斜体 / 下划线 / 高亮的默认键和 StarterKit 自带的一样（Mod-b / i / u、Mod-Shift-h）；设置里改走以后，旧键由 `keybindings.ts` 的 `shadowedDefaults` 挡掉。 */
const FORMATS: AppCommand[] = [
  { id: "format.bold", get label() { return t("粗体", "Bold"); }, keywords: ["bold", "ct"], group: "格式", key: "Mod-b", rich: command("toggleBold") },
  { id: "format.italic", get label() { return t("斜体", "Italic"); }, keywords: ["italic", "xt"], group: "格式", key: "Mod-i", rich: command("toggleItalic") },
  { id: "format.underline", get label() { return t("下划线", "Underline"); }, keywords: ["underline", "xhx"], group: "格式", key: "Mod-u", rich: command("toggleUnderline") },
  { id: "format.strike", get label() { return t("删除线", "Strikethrough"); }, keywords: ["strike", "scx"], group: "格式", key: STRIKE_KEY, rich: command("toggleStrike") },
  { id: "format.code", get label() { return t("行内代码", "Inline Code"); }, keywords: ["inline code", "hndm"], group: "格式", key: "Mod-Shift-`", rich: command("toggleCode") },
  { id: "format.highlight", get label() { return t("高亮", "Highlight"); }, keywords: ["highlight", "mark", "gl"], group: "格式", key: "Mod-Shift-h", rich: command("toggleHighlight") },
  { id: "format.clear", get label() { return t("清除格式", "Clear Formatting"); }, keywords: ["clear", "plain", "qcgs"], group: "格式", key: "Mod-\\", rich: unsetAllMarks() },
  { id: "format.headingUp", get label() { return t("标题升一级", "Promote Heading"); }, keywords: ["promote", "btsj"], group: "格式", key: "Mod-=", act: (ctx) => ctx.session && runHeadingStep(ctx.session, "up") },
  { id: "format.headingDown", get label() { return t("标题降一级", "Demote Heading"); }, keywords: ["demote", "btjj"], group: "格式", key: "Mod--", act: (ctx) => ctx.session && runHeadingStep(ctx.session, "down") },
];

/**
 * 选词 / 选行 / 选格式范围照 Typora 是 Cmd+D / L / E，但浏览器多半先拿走这三个键（书签、地址栏、搜索；keybindings.ts 的 BROWSER_KEYS），
 * 网页里默认换成 Ctrl+Alt（实施计划 4.4：拦不下的在 Web 上换成 Ctrl+Opt 组合）；macOS 应用里照 Typora。设置里都能改。
 * 「复制为 Markdown」的 Cmd+Shift+C 在浏览器里是开发者工具的「选取元素」，网页里换成 Ctrl+Alt+M（M 取 Markdown；Mod-Alt-m 没有别的命令占）。
 */
const typoraOrWeb = (typora: string, web: string) => (IN_BROWSER ? web : typora);

const imageWidth = (width: string | null, label: () => string, pinyin: string): AppCommand => ({
  id: `image.width.${width ?? "natural"}`,
  get label() { return t(`图片宽度：${label()}`, `Image width: ${label()}`); },
  keywords: ["image width", "resize", "tpkd", pinyin],
  group: "编辑",
  act: (ctx) => ctx.session && setImageAttr(ctx.session, "width", width),
});

const imageAlign = (align: string | null, label: () => string, pinyin: string): AppCommand => ({
  id: `image.align.${align ?? "none"}`,
  get label() { return t(`图片对齐：${label()}`, `Image alignment: ${label()}`); },
  keywords: ["image align", align ?? "none", "tpdq", pinyin],
  group: "编辑",
  act: (ctx) => ctx.session && setImageAttr(ctx.session, "align", align),
});

/** 图片操作条上的操作，键盘也能用（命令面板、设置里绑键）。宽度、对齐只在选中的图片能调大小时可用（见 `available`）。 */
const IMAGE_SIZE: AppCommand[] = [
  imageWidth("25%", () => "25%", "25"),
  imageWidth("50%", () => "50%", "50"),
  imageWidth("75%", () => "75%", "75"),
  imageWidth("100%", () => "100%", "100"),
  imageWidth(null, () => t("原始大小", "Original size"), "ysdx"),
  imageAlign("left", () => t("靠左", "Align left"), "kz"),
  imageAlign("center", () => t("居中", "Center"), "jz"),
  imageAlign("right", () => t("靠右", "Align right"), "ky"),
  imageAlign(null, () => t("不对齐", "No alignment"), "bdq"),
];

const IMAGE_EDITS: AppCommand[] = [
  { id: "image.alt", get label() { return t("编辑图片的替代文字", "Edit Image Alt Text"); }, keywords: ["alt text", "image description", "tdwz"], group: "编辑", act: () => altEditRequest.set(true) },
  { id: "image.delete", get label() { return t("删除图片", "Delete image"); }, keywords: ["delete image", "sctp"], group: "编辑", act: (ctx) => ctx.session && deleteImage(ctx.session) },
];

const EDITS: AppCommand[] = [
  { id: "edit.selectWord", get label() { return t("选中当前词 / 下一个相同的", "Select Word / Next Occurrence"); }, keywords: ["select word", "next occurrence", "xzc"], group: "编辑", key: typoraOrWeb("Mod-d", "Ctrl-Alt-d"), act: (ctx) => ctx.session && selectWord(ctx.session) },
  { id: "edit.selectLine", get label() { return t("选中当前行", "Select Current Line"); }, keywords: ["select line", "xzh"], group: "编辑", key: typoraOrWeb("Mod-l", "Ctrl-Alt-l"), act: (ctx) => ctx.session && selectLine(ctx.session) },
  { id: "edit.selectFormat", get label() { return t("选中当前格式范围", "Select Formatting Range"); }, keywords: ["select scope", "styled scope", "xzgsfw"], group: "编辑", key: typoraOrWeb("Mod-e", "Ctrl-Alt-e"), act: (ctx) => ctx.session && selectFormat(ctx.session) },
  { id: "edit.copyMarkdown", get label() { return t("复制为 Markdown", "Copy as Markdown"); }, keywords: ["copy markdown", "fzwmd"], group: "编辑", key: typoraOrWeb("Mod-Shift-c", "Ctrl-Alt-m"), act: (ctx) => ctx.session && copyAsMarkdown(ctx.session) },
  { id: "image.transferAll", get label() { return t("把这篇的外链图片都转存到本地", "Save All Linked Images Locally"); }, keywords: ["transfer images", "download images", "zctp", "tp"], group: "编辑", act: (ctx) => ctx.images?.transferAll() },
  ...IMAGE_SIZE,
  ...IMAGE_EDITS,
];

/** 光标不在表格里时这些命令什么也不做（编辑器命令返回 false，键会落到别的绑定上）。 */
const TABLES: AppCommand[] = [
  { id: "table.rowBefore", get label() { return t("上方加行", "Insert Row Above"); }, keywords: ["row above", "sfjh"], group: "表格", rich: addRowBefore() },
  { id: "table.rowAfter", get label() { return t("下方加行", "Insert Row Below"); }, keywords: ["row below", "xfjh"], group: "表格", key: "Mod-Enter", rich: addRowAfter() },
  { id: "table.deleteRow", get label() { return t("删行", "Delete Row"); }, keywords: ["delete row", "sh"], group: "表格", key: "Mod-Shift-Backspace", rich: deleteRow() },
  { id: "table.columnBefore", get label() { return t("左侧加列", "Insert Column Left"); }, keywords: ["column left", "zcjl"], group: "表格", rich: addColumnBefore() },
  { id: "table.columnAfter", get label() { return t("右侧加列", "Insert Column Right"); }, keywords: ["column right", "ycjl"], group: "表格", rich: addColumnAfter() },
  { id: "table.deleteColumn", get label() { return t("删列", "Delete Column"); }, keywords: ["delete column", "sl"], group: "表格", rich: deleteColumn() },
  { id: "table.delete", get label() { return t("删表", "Delete Table"); }, keywords: ["delete table", "sb"], group: "表格", rich: deleteTable() },
];

const toggle = (s: { (): boolean; set(v: boolean): void }) => s.set(!s());

/**
 * 替换没用 Typora 的 Cmd+H：苹果系统把它留给「隐藏窗口」，应用绑不上（nsh 0.6.0 实测），改成 Cmd+Alt+F。
 * 源码视图没用 Typora 的 Cmd+/：nsh 的源码编辑器自己把它当「切换注释」吃掉，应用收不到，进去了就按不回来；
 * Cmd+Alt+/ 在两种编辑器里应用都收得到（2026-11-24 web host 实测），进出用同一个键。
 */
const VIEWS: AppCommand[] = [
  { id: "view.find", get label() { return t("查找", "Find"); }, keywords: ["find", "search", "cz"], group: "视图", key: "Mod-f", act: (ctx) => ctx.ui.findMode.set("find") },
  { id: "view.replace", get label() { return t("查找并替换", "Find and Replace"); }, keywords: ["replace", "th"], group: "视图", key: "Mod-Alt-f", act: (ctx) => ctx.ui.findMode.set("replace") },
  { id: "view.outline", get label() { return t("大纲", "Outline"); }, keywords: ["outline", "dg"], group: "视图", key: "Mod-Shift-l", act: () => toggleSidebar("outline") },
  { id: "view.documents", get label() { return t("文档列表", "Document List"); }, keywords: ["documents", "files", "library", "wdlb"], group: "视图", act: () => toggleSidebar("docs") },
  { id: "view.focus", get label() { return t("专注模式", "Focus Mode"); }, keywords: ["focus", "zzms"], group: "视图", key: "F8", act: (ctx) => toggle(ctx.ui.focusOn) },
  { id: "view.typewriter", get label() { return t("打字机模式", "Typewriter Mode"); }, keywords: ["typewriter", "dzjms"], group: "视图", key: "F9", act: (ctx) => toggle(ctx.ui.typewriterOn) },
  { id: "view.source", get label() { return t("源码视图", "Source View"); }, keywords: ["source", "markdown", "ymst"], group: "视图", key: "Mod-Alt-/", act: (ctx) => ctx.toggleSource?.() },
  { id: "view.palette", get label() { return t("命令面板", "Command Palette"); }, keywords: ["command palette", "mlmb"], group: "视图", key: "Mod-Shift-p", act: (ctx) => ctx.ui.paletteOpen.set(true) },
  { id: "view.settings", get label() { return t("设置（快捷键）", "Settings (Shortcuts)"); }, keywords: ["settings", "shortcuts", "keys", "sz", "kjj"], group: "视图", key: "Mod-,", act: () => settingsOpen.set(true) },
  { id: "view.appearance", get label() { return t("切换深色 / 浅色", "Toggle Light / Dark Appearance"); }, keywords: ["dark", "light", "theme", "ss"], group: "视图", act: () => setColorScheme(colorScheme() === "dark" ? "light" : "dark") },
];

/**
 * 新建没用 Typora 的 Cmd+N：浏览器把它留给「新窗口」，网页收不到（keybindings.ts 的 RESERVED 里也挡着），改成 Cmd+Alt+N。
 * 快速打开照 Typora 用 Cmd+Shift+O；Windows 上的 Chrome 把 Ctrl+Shift+O 当书签管理器，拦不住的话在设置里换一个。
 */
const FILES: AppCommand[] = [
  { id: "file.new", get label() { return t("新建文档", "New Document"); }, keywords: ["new", "create", "xjwd"], group: "文件", key: "Mod-Alt-n", act: () => requestLibrary({ kind: "create" }) },
  { id: "file.quickOpen", get label() { return t("快速打开…", "Quick Open…"); }, keywords: ["quick open", "switch", "ksdk"], group: "文件", key: "Mod-Shift-o", act: () => quickOpenOpen.set(true) },
  { id: "file.history", get label() { return t("版本历史…", "Version History…"); }, keywords: ["history", "versions", "restore", "bbls"], group: "文件", act: () => historyOpen.set(true) },
  { id: "file.sync", get label() { return t("同步…", "Sync…"); }, keywords: ["sync", "github", "gist", "tb"], group: "文件", act: () => syncOpen.set(true) },
  { id: "file.open", get label() { return t("打开文件…", "Open File…"); }, keywords: ["open", "import", "dkwj", "dr"], group: "文件", key: "Mod-o", act: () => requestFile("open") },
  { id: "file.saveAs", get label() { return t("另存为…", "Save As…"); }, keywords: ["save as", "export", "download", "lcw", "dc"], group: "文件", key: "Mod-Shift-s", act: () => requestFile("saveAs") },
  { id: "file.exportHtml", get label() { return t("导出为 HTML…", "Export as HTML…"); }, keywords: ["export html", "print", "pdf", "dcwhtml", "dc"], group: "文件", act: () => requestFile("exportHtml") },
];

export const COMMANDS: AppCommand[] = [...BLOCKS, ...FORMATS, ...EDITS, ...TABLES, ...VIEWS, ...FILES];

export const SLASH_COMMANDS = COMMANDS.filter((c) => c.slash);

export function commandById(id: string): AppCommand {
  const found = COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(t(`没有这条命令：${id}`, `Unknown command: ${id}`));
  return found;
}

/** 不在正文里起作用、焦点在哪都该能用的命令（视图和文件两组）：键另外绑在应用级 keymap 上。 */
export const isViewCommand = (c: AppCommand) => c.group === "视图" || c.group === "文件";

/** 源码视图里也能用的命令；大纲、专注只对所见即所得有意义。 */
const WORKS_IN_SOURCE = new Set([
  "view.find",
  "view.replace",
  "view.palette",
  "view.appearance",
  "view.settings",
  "view.documents",
  "file.open",
  "file.saveAs",
  "file.exportHtml",
  "file.new",
  "file.quickOpen",
  "file.history",
  "file.sync",
]);

const NEEDS_RESIZABLE_IMAGE = new Set(IMAGE_SIZE.map((c) => c.id));
const NEEDS_IMAGE = new Set(IMAGE_EDITS.map((c) => c.id));

/** 这条命令现在能不能用。 */
export function available(c: AppCommand, ctx: CommandContext): boolean {
  if (c.id === "view.source") return ctx.toggleSource !== null;
  // 没配置同步（没有 client id）时不给入口；设置页的「同步」页签留着，那里说明怎么配
  if (c.id === "file.sync") return syncConfigured(SIGN_IN_FLOW === "web");
  if (NEEDS_RESIZABLE_IMAGE.has(c.id)) return ctx.session !== null && canResize(ctx.session);
  if (NEEDS_IMAGE.has(c.id)) return ctx.session !== null && selectedImage(ctx.session) !== null;
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
