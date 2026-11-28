/** 平台差异的唯一位置：features 只引这里导出的值。 */
import { type Phrase, t } from "../i18n";
import { cleanup, effect, keymap, platform, type Point } from "nsh";
import { Application, currentWindow, Menu, type MenuItem, type MenuRole, titleBar, type WindowRef } from "nsh/desktop";
import type { FileLibrary } from "../store/backend";
import { createFileStore, LIBRARY_FOLDER, locateFile, readFileBytes } from "./macos/file-store";
import { saveToDownloads } from "./macos/save";
import { downloadText } from "./web/download";

/** 苹果键位（macOS，或苹果电脑上的浏览器）：Mod 是 Command，和 Ctrl 是两个键。 */
const appleKeys = keymap.label("mod+a").startsWith("⌘");

export const APPLE_KEYS = appleKeys;

/** 跑在浏览器里：有些组合键浏览器自己先处理，应用拦不住。 */
export const IN_BROWSER = platform.name === "web";

export const IS_MACOS = platform.name === "macos";

/** 有鼠标、能悬停（macOS、桌面浏览器）。手机和平板的浏览器没有悬停，靠悬停才出现的按钮在那里要常驻。 */
export const CAN_HOVER = platform.desktop;

function systemKey(zh: string, en: string, keys: string[]) {
  return { get label() { return t(zh, en); }, keys };
}

/** 由系统和编辑器内核管、应用不改的键，设置页里列出来给人查。键用 keymap 的写法，多个写法用数组。 */
export const SYSTEM_KEYS = [
  systemKey("到行首 / 行尾", "Start / end of line", appleKeys ? ["mod+arrowleft", "mod+arrowright", "home", "end"] : ["home", "end"]),
  systemKey("按词移动", "Move by word", appleKeys ? ["alt+arrowleft", "alt+arrowright"] : ["mod+arrowleft", "mod+arrowright"]),
  systemKey("到文首 / 文末", "Start / end of document", appleKeys ? ["mod+arrowup", "mod+arrowdown"] : ["mod+home", "mod+end"]),
  systemKey("全选", "Select all", ["mod+a"]),
  systemKey("撤销 / 重做", "Undo / redo", appleKeys ? ["mod+z", "mod+shift+z"] : ["mod+z", "mod+y"]),
  systemKey("复制 / 剪切 / 粘贴", "Copy / cut / paste", ["mod+c", "mod+x", "mod+v"]),
];

/**
 * 源码编辑器里移动光标的键（keymap 的写法）→ 编辑器命令。nsh 0.6.0 的源码编辑器在 web host 上自己不处理这几个键
 * （2026-11-24 实测 Home、Cmd+←、Ctrl+A 都不动），由应用接过来转成它的命令。
 * 苹果键位上 Cmd+ 方向键、Ctrl+A / E 是行和文档的两端；别处 Ctrl+A 是全选、Ctrl+ 方向键是按词，不能接。
 */
export const SOURCE_MOVE_KEYS: Record<string, string> = {
  home: "moveLineStart",
  end: "moveLineEnd",
  "shift+home": "selectLineStart",
  "shift+end": "selectLineEnd",
  ...(appleKeys
    ? {
        "mod+arrowleft": "moveLineStart",
        "mod+arrowright": "moveLineEnd",
        "mod+shift+arrowleft": "selectLineStart",
        "mod+shift+arrowright": "selectLineEnd",
        "ctrl+a": "moveLineStart",
        "ctrl+e": "moveLineEnd",
        "mod+arrowup": "moveDocumentStart",
        "mod+arrowdown": "moveDocumentEnd",
        "mod+shift+arrowup": "selectDocumentStart",
        "mod+shift+arrowdown": "selectDocumentEnd",
      }
    : {}),
};

/**
 * 删除线的快捷键。苹果键位上照 Typora 用 Ctrl+Shift+`；别处 Mod 就是 Ctrl，
 * 会和行内代码的 Mod+Shift+` 撞上，改用 Typora Windows 版的 Alt+Shift+5。
 */
export const STRIKE_KEY = appleKeys ? "Ctrl-Shift-`" : "Alt-Shift-5";

/**
 * 「粘贴为纯文本」要应用自己接的键。浏览器里 Cmd/Ctrl+Shift+V 本来就是按纯文本粘贴，不用接也接不到；
 * macOS 应用里没有这个默认行为，要自己读剪贴板。
 */
export const PLAIN_PASTE_KEY = platform.name === "macos" ? "Mod-Shift-v" : null;

/** 另存的结果：一句「存到哪了」；`confirmed` 是能不能确定文件已经落盘。 */
export interface SavedFile {
  message: Phrase;
  confirmed: boolean;
}

/**
 * 把一段文字存成用户拿得到的文件。`type` 是浏览器下载时的文件类型（默认 Markdown）。
 * 浏览器里是下载：位置由浏览器定，用户可能在「存到哪」的框里点了取消，页面无从知道，所以 `confirmed` 是 false。
 * 桌面应用里存进「下载」文件夹，写完才返回，`confirmed` 是 true。
 */
export async function saveTextFile(name: string, text: string, type?: string): Promise<SavedFile> {
  if (IN_BROWSER) {
    downloadText(name, text, type);
    return { message: () => t(`已交给浏览器下载：${name}`, `Download sent to your browser: ${name}`), confirmed: false };
  }
  const path = await saveToDownloads(name, text);
  return { message: () => t(`已存到 ${path}`, `Saved to ${path}`), confirmed: true };
}

/**
 * 离开时把没写的改动存下来。`stash` 同步记下改动（应急键）、返回记没记稳；`save` 是正常的写入，返回存没存上。要在组件渲染时调（监听跟着组件走）。
 * 浏览器里关标签页、刷新、跳走时 IndexedDB 的写入来不及提交（2026-11-25 实测丢字），所以先 `stash`：
 * 记稳了直接放行；没记稳就不放行，浏览器会问要不要离开，同时照常 `save`。页面真的没了（`quit`）时再记一次。
 * 别处（macOS 应用）：要退出时先记应急键再存，存上了才退；没存上（文件刚被别的程序改过、写不进去）就不退，把窗口显示出来让人看冲突条。
 * 已经拦过一次、又要退时照退：改动在应急键里，下次打开时并回去——不然磁盘一直写不进去时应用就退不掉了。真退出（`quit`，nsh 最多等 200ms）时再记一次、存一次。
 */
export function saveBeforeLeaving(stash: () => boolean, save: () => Promise<boolean>) {
  if (!IN_BROWSER) {
    let refused = false;
    cleanup(
      Application.on("quitRequest", () => {
        const stashed = stash();
        void save().then((ok) => {
          if (ok || (refused && stashed)) return Application.quit();
          refused = true;
          Application.cancelQuitRequest();
          showWindow();
        });
      }),
    );
    cleanup(
      Application.on("quit", () => {
        stash();
        return save().then(() => undefined);
      }),
    );
    return;
  }
  cleanup(
    Application.on("quitRequest", () => {
      if (stash()) Application.quit();
      else void save();
    }),
  );
  cleanup(Application.on("quit", () => void stash()));
}

/** macOS 应用的主窗口（`keepWindowOnClose` 时记下）：窗口收着时 `showWindow` 用它。 */
let mainWindow: WindowRef | null = null;

/** 把收起的窗口显示出来、放到最前（macOS 关窗只是把窗口藏起来）。没有窗口的地方什么都不做。 */
export function showWindow() {
  mainWindow?.show();
  mainWindow?.focus();
}

/**
 * macOS 关窗：nsh 0.7.0 起关掉最后一个窗口应用不退出、留在程序坞（用户 2026-11-25 定：跟随）。窗口真关掉的话里面的内容跟着拆掉，
 * 点程序坞图标时没有东西可显示，所以关窗按钮改成把窗口藏起来：先记应急键（`stash`）、再存盘（`save`），存上了才藏；
 * 没存上（文件刚被别的程序改过、删了、写不进去）窗口留着，冲突条、保存状态露在外面让人处理。
 * 点程序坞图标（`reopen`）时再显示，文档、光标、撤销都还在，显示后调 `back`（藏着的时候文件可能被别的程序改过）。
 * 只能在组件渲染时调（`currentWindow()` 的要求）。别处什么都不做（网页关标签页见 `saveBeforeLeaving`）。
 */
export function keepWindowOnClose(stash: () => boolean, save: () => Promise<boolean>, back: () => void) {
  if (platform.name !== "macos") return;
  const win = currentWindow();
  mainWindow = win;
  cleanup(() => {
    if (mainWindow === win) mainWindow = null;
  });
  win.set({ closeOnPress: false });
  win.on("closePress", () => {
    stash();
    void save().then((ok) => ok && win.hide());
  });
  cleanup(
    Application.on("reopen", () => {
      showWindow();
      back();
    }),
  );
}

/** 这台设备上的文库文件夹：macOS 应用是 `~/Documents/Pairdown`，别处没有（网页里用网关或浏览器本地）。 */
export const fileLibrary = (): FileLibrary | null => (platform.name === "macos" ? { store: createFileStore(), folder: LIBRARY_FOLDER } : null);

/** 网页里启动时先试着连本机网关。 */
export const PROBE_GATEWAY = IN_BROWSER;

/** 菜单栏上的一条命令：名字、快捷键（keymap 的写法，没有是 undefined）、选中时做什么。`checked` 给了就是带勾的项；`disabled` 是现在用不了（灰掉）。 */
export interface MenuCommand {
  label: string;
  shortcut: string | undefined;
  onSelect: () => void;
  checked?: boolean;
  disabled?: boolean;
  /** 别的输入框有焦点时快捷键归谁（nsh MenuItem.when）：编辑类命令给 "auto"，让查找框、链接框里的 ⌘B、⇧⌘V 留给输入框自己。 */
  when?: "always" | "auto";
}

/** 系统负责做的菜单项（关于、隐藏、撤销、最小化…），名字由这里给。 */
export type SystemMenuRole = MenuRole;

/** 菜单里的一项：应用的命令、分隔线、系统项、子菜单。 */
export type MenuEntry =
  | { kind: "command"; command: MenuCommand }
  | { kind: "separator" }
  | { kind: "role"; role: SystemMenuRole }
  | { kind: "submenu"; label: string; items: MenuEntry[] };

/** 菜单栏上的一个菜单。 */
export interface AppMenu {
  label: string;
  items: MenuEntry[];
}

/** macOS 把标题放进工具栏，由系统绘制和处理红黄绿按钮。 */
export function configureEditorTitleBar(showToolbar: () => boolean) {
  if (!IS_MACOS) return;
  const window = currentWindow();
  effect(() => window.set({ titleBar: showToolbar() ? { style: "hidden", height: 40 } : { style: "default" } }));
}

export const editorTitleBarArea = titleBar;

export function showDocumentMenu(items: readonly (MenuItem | null)[], anchor?: Point) {
  return Menu.popup(items, anchor);
}

/** 从编辑器组件跟踪当前文档名，交给系统标题栏显示。 */
export function bindDocumentWindowTitle(title: () => string) {
  const window = currentWindow();
  effect(() => window.set({ title: title() }));
}

const ROLE_LABELS: Record<SystemMenuRole, () => string> = {
  about: () => t("关于 Pairdown", "About Pairdown"),
  hide: () => t("隐藏 Pairdown", "Hide Pairdown"),
  hideOthers: () => t("隐藏其他", "Hide Others"),
  showAll: () => t("全部显示", "Show All"),
  quit: () => t("退出 Pairdown", "Quit Pairdown"),
  undo: () => t("撤销", "Undo"),
  redo: () => t("重做", "Redo"),
  cut: () => t("剪切", "Cut"),
  copy: () => t("复制", "Copy"),
  paste: () => t("粘贴", "Paste"),
  selectAll: () => t("全选", "Select All"),
  minimize: () => t("最小化", "Minimize"),
  zoom: () => t("缩放", "Zoom"),
  toggleFullScreen: () => t("切换全屏", "Toggle Full Screen"),
  close: () => t("关闭窗口", "Close Window"),
};

/** 菜单命令选中时先把收起的窗口显示出来：窗口收着时菜单栏照样能用，命令做了却看不见。 */
function toMenuItem(entry: MenuEntry): MenuItem {
  switch (entry.kind) {
    case "separator":
      return { type: "separator" };
    case "role":
      return { role: entry.role, label: ROLE_LABELS[entry.role]() };
    case "submenu":
      return { label: entry.label, submenu: entry.items.map(toMenuItem) };
    case "command": {
      const c = entry.command;
      return {
        label: c.label,
        shortcut: c.shortcut,
        checked: c.checked,
        disabled: c.disabled,
        when: c.when,
        onSelect: () => {
          showWindow();
          c.onSelect();
        },
      };
    }
  }
}

/** 放好系统菜单栏（只有 macOS 应用有，别处什么都不做）。菜单里放什么由编辑页给（app-menu.ts）；再调一次就整个换掉。 */
export function setMenuBar(menus: AppMenu[]) {
  if (platform.name !== "macos") return;
  Menu.setApplicationMenu(menus.map((m) => ({ label: m.label, submenu: m.items.map(toMenuItem) })));
}

/** 系统交来的文件在哪：文库里的给 id，文库外的给读出的内容（读不了是 null）。 */
export const locateOpenedFile = locateFile;

/**
 * 系统交来要打开的文件（访达里「打开方式」、双击、拖到程序坞图标，和拖进窗口）：macOS 应用里才有，给的是绝对路径。
 * 窗口收着时先显示出来。启动前就来了的文件 nsh 会在挂上监听时补交。返回停止监听的函数。
 */
export function onOpenFiles(handler: (paths: string[]) => void): () => void {
  if (platform.name !== "macos") return () => undefined;
  return Application.on("openFiles", ({ paths }) => {
    showWindow();
    handler(paths);
  });
}

/** 拖进窗口的文件（`file:` 地址）→ 绝对路径；只在 macOS 应用里处理，别处给空。 */
export function droppedPaths(uris: string[]): string[] {
  if (platform.name !== "macos") return [];
  return uris.filter((u) => u.startsWith("file://")).map((u) => decodeURIComponent(new URL(u).pathname));
}

/** 拖进窗口、从访达复制来的本地图片（绝对路径）的字节：只有 macOS 应用拿得到路径；读不了（不在文库和「下载」里）抛错。 */
export function readImageFile(path: string): Promise<Uint8Array> {
  if (platform.name !== "macos") return Promise.reject(new Error(t("这里读不了本地文件", "Local files cannot be read here")));
  return readFileBytes(path);
}

/**
 * GitHub 登录走哪种流程：网页里是网页授权（跳 GitHub 再回来，code 交给本站的 /token（站点 Worker）换 token）；
 * 桌面应用里是 Device Flow（显示用户码，应用直接请求 github.com，不受浏览器跨域限制）。
 */
export const SIGN_IN_FLOW: "web" | "device" = IN_BROWSER ? "web" : "device";

export { createMacLibraryDocument, createMacLibraryFolder, macLibraryFolders, macLibraryInfo, macLibraryPath } from "./macos/file-store";
export { revealInFinder } from "./macos/reveal";
