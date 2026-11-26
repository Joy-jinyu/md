/**
 * macOS 菜单栏里文件、视图两个菜单放哪些命令（菜单栏本身由 platform 的 `setMenuBar` 放）。菜单项就是命令表里的命令，快捷键取现在生效的键（设置里改过的也算）。
 * 菜单选中时用编辑页登记的执行函数跑：视图命令要用那一页的上下文（源码切换、专注开关）。和按键走同一个去重（keys.ts 的 `once`），同一下按键菜单和 keymap 都报上来也只算一次。
 */
import { effect } from "nsh";
import { type MenuCommand, setMenuBar } from "../../platform";
import { type AppCommand, commandById } from "./commands";
import { keyOf } from "./keybindings";
import { toKeymapName } from "./keys";

const FILE_MENU = ["file.new", "file.open", "file.saveAs", "file.exportHtml", "file.quickOpen"];
const VIEW_MENU = ["view.source", "view.focus", "view.typewriter", "view.outline", "view.settings"];

let runner: ((c: AppCommand) => void) | null = null;

function item(id: string): MenuCommand {
  const c = commandById(id);
  const key = keyOf(c);
  return { label: c.label, shortcut: key ? toKeymapName(key) : undefined, onSelect: () => runner?.(c) };
}

/**
 * 编辑页（所见即所得或源码）每建一次调一次：登记它的执行函数，按现在的键重建菜单栏。
 * 编辑页在改键后会整个重建，所以菜单上的键跟着变。没有菜单栏的地方（网页）`setMenuBar` 什么都不做。
 */
export function installAppMenu(run: (c: AppCommand) => void) {
  runner = run;
  effect(() => setMenuBar(FILE_MENU.map(item), VIEW_MENU.map(item)));
}
