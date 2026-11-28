/**
 * macOS 菜单栏的内容（菜单栏本身由 platform 的 `setMenuBar` 放）：照 Typora 的菜单排，菜单项就是命令表里的命令，快捷键取现在生效的键（设置里改过的也算）。
 * 菜单选中时用编辑页登记的执行函数跑：命令要用那一页的上下文（源码切换、专注开关）。和按键走同一个去重（keys.ts 的 `once`），同一下按键菜单和 keymap 都报上来也只算一次。
 */
import { cleanup, effect } from "nsh";
import { t } from "../../i18n";
import { type AppMenu, type MenuEntry, setMenuBar, type SystemMenuRole } from "../../platform";
import { ALERT_KINDS, type AppCommand, type CommandContext, commandById, menuEnabled } from "./commands";
import { keyOf } from "./keybindings";
import { toKeymapName } from "./keys";

type Layout = { kind: "command"; id: string } | { kind: "separator" } | { kind: "role"; role: SystemMenuRole } | { kind: "submenu"; label: () => string; items: Layout[] };

const cmd = (...ids: string[]): Layout[] => ids.map((id) => ({ kind: "command", id }));
const role = (...roles: SystemMenuRole[]): Layout[] => roles.map((r) => ({ kind: "role", role: r }));
const sep: Layout = { kind: "separator" };
const sub = (label: () => string, items: Layout[]): Layout => ({ kind: "submenu", label, items });

/** 菜单栏的全部菜单，顺序照 Typora。只在 macOS 应用里出现，所以 macOS 才有的命令（文章、文件树、访达）直接放。 */
const MENUS: { label: () => string; items: Layout[] }[] = [
  { label: () => "Pairdown", items: [...role("about"), sep, ...cmd("view.settings"), sep, ...role("hide", "hideOthers", "showAll"), sep, ...role("quit")] },
  {
    label: () => t("文件", "File"),
    items: [
      ...cmd("file.new", "file.newWindow"),
      sep,
      ...cmd("file.open", "file.quickOpen"),
      sep,
      ...cmd("file.saveAs", "file.history"),
      sep,
      ...cmd("file.exportHtml"),
      sep,
      ...cmd("file.reveal", "file.sync"),
      sep,
      ...role("close"),
    ],
  },
  {
    label: () => t("编辑", "Edit"),
    items: [
      ...role("undo", "redo"),
      sep,
      ...role("cut", "copy", "paste"),
      ...cmd("edit.pastePlain", "edit.copyMarkdown"),
      ...role("selectAll"),
      sep,
      sub(() => t("选择", "Selection"), cmd("edit.selectWord", "edit.selectLine", "edit.selectFormat")),
      sub(() => t("查找", "Find"), cmd("view.find", "view.findNext", "view.findPrevious", "view.replace")),
      sep,
      ...cmd("edit.jumpTop", "edit.jumpBottom"),
    ],
  },
  {
    label: () => t("段落", "Paragraph"),
    items: [
      ...cmd("block.h1", "block.h2", "block.h3", "block.h4", "block.h5", "block.h6"),
      sep,
      ...cmd("block.paragraph"),
      sep,
      ...cmd("format.headingUp", "format.headingDown"),
      sep,
      sub(() => t("表格", "Table"), [
        ...cmd("block.table"),
        sep,
        ...cmd("table.rowBefore", "table.rowAfter", "table.columnBefore", "table.columnAfter"),
        sep,
        ...cmd("table.deleteRow", "table.deleteColumn", "table.delete"),
      ]),
      sep,
      ...cmd("block.math", "block.code", "block.codeLanguage", "block.codeCopy", "block.mermaid"),
      sep,
      ...cmd("block.quote"),
      sub(() => t("提示块", "Callout"), cmd(...ALERT_KINDS.map((k) => `block.alert.${k.alert}`))),
      sep,
      ...cmd("block.ordered", "block.bullet", "block.task"),
      sep,
      ...cmd("block.rule", "block.toc", "block.frontmatter"),
      sep,
      ...cmd("block.footnote"),
    ],
  },
  {
    label: () => t("格式", "Format"),
    items: [
      ...cmd("format.bold", "format.italic", "format.underline", "format.code", "format.strike", "format.highlight"),
      sep,
      ...cmd("inline.math", "inline.link"),
      sub(() => t("图片", "Image"), [
        ...cmd("insert.image"),
        sep,
        ...cmd("image.width.25%", "image.width.50%", "image.width.75%", "image.width.100%", "image.width.natural"),
        sep,
        ...cmd("image.align.left", "image.align.center", "image.align.right", "image.align.none"),
        sep,
        ...cmd("image.alt", "image.delete"),
        sep,
        ...cmd("image.transferAll"),
      ]),
      sep,
      ...cmd("format.clear"),
    ],
  },
  {
    label: () => t("视图", "View"),
    items: [
      ...cmd("view.source"),
      sep,
      ...cmd("view.sidebar", "view.outline", "view.articles", "view.tree", "view.search"),
      sep,
      ...cmd("view.focus", "view.typewriter"),
      sep,
      ...cmd("view.palette"),
    ],
  },
  { label: () => t("主题", "Themes"), items: cmd("theme.system", "theme.light", "theme.dark") },
  { label: () => t("窗口", "Window"), items: [...role("minimize", "zoom"), sep, ...role("toggleFullScreen")] },
  {
    label: () => t("帮助", "Help"),
    items: [...cmd("help.markdown"), sep, ...cmd("help.website", "help.changelog", "help.feedback"), sep, ...cmd("help.shortcuts")],
  },
];

let runner: ((c: AppCommand) => void) | null = null;

/** 文件、视图、主题、帮助以外的命令都是改正文的：别的输入框（查找框、链接框、设置里录键）有焦点时，它们的快捷键留给那个输入框。 */
const EDITING = /^(?!(view|file|theme|help)\.)/;

/** 菜单的快捷键写法：`-`、`=` 换成 nsh 文档里明写的 `minus`、`plus`（desktop.d.ts 的 MenuItem.shortcut）。 */
const menuShortcut = (key: string) => toKeymapName(key).replace(/\+-$/, "+minus").replace(/\+=$/, "+plus");

function entry(item: Layout, ctx: CommandContext): MenuEntry {
  switch (item.kind) {
    case "separator":
    case "role":
      return item;
    case "submenu":
      return { kind: "submenu", label: item.label(), items: item.items.map((i) => entry(i, ctx)) };
    case "command": {
      const c = commandById(item.id);
      const key = keyOf(c);
      return {
        kind: "command",
        command: {
          label: c.label,
          shortcut: key ? menuShortcut(key) : undefined,
          checked: c.checked?.(ctx),
          disabled: !menuEnabled(c, ctx),
          when: EDITING.test(c.id) ? "auto" : "always",
          onSelect: () => runner?.(c),
        },
      };
    }
  }
}

/**
 * 编辑页（所见即所得或源码）每建一次调一次：登记它的执行函数和上下文，按现在的键重建菜单栏。
 * 勾选和灰掉跟着开关变（源码视图、专注、侧栏、主题…）：读到的都是信号，变了 effect 重跑、整个菜单栏重放。
 * 编辑页在改键后会整个重建，所以菜单上的键跟着变。没有菜单栏的地方（网页）`setMenuBar` 什么都不做。
 */
export function installAppMenu(run: (c: AppCommand) => void, ctx: CommandContext) {
  runner = run;
  // 编辑页卸掉（换文档、加载中、出错）后菜单不再指向旧的那一页
  cleanup(() => {
    if (runner === run) runner = null;
  });
  effect(() => setMenuBar(MENUS.map((m): AppMenu => ({ label: m.label(), items: m.items.map((i) => entry(i, ctx)) }))));
}
