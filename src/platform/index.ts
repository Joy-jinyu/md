/** 平台差异的唯一位置：features 只引这里导出的值。 */
import { keymap, platform } from "nsh";
import { Application, Menu } from "nsh/desktop";
import type { FileLibrary } from "../store/backend";
import { createFileStore, LIBRARY_FOLDER, locateFile, readFileBytes } from "./macos/file-store";
import { saveToDownloads } from "./macos/save";
import { downloadText } from "./web/download";

/** 苹果键位（macOS，或苹果电脑上的浏览器）：Mod 是 Command，和 Ctrl 是两个键。 */
const appleKeys = keymap.label("mod+a").startsWith("⌘");

export const APPLE_KEYS = appleKeys;

/** 跑在浏览器里：有些组合键浏览器自己先处理，应用拦不住。 */
export const IN_BROWSER = platform.name === "web";

/** 由系统和编辑器内核管、应用不改的键，设置页里列出来给人查。键用 keymap 的写法，多个写法用数组。 */
export const SYSTEM_KEYS: { label: string; keys: string[] }[] = appleKeys
  ? [
      { label: "到行首 / 行尾", keys: ["mod+arrowleft", "mod+arrowright", "home", "end"] },
      { label: "按词移动", keys: ["alt+arrowleft", "alt+arrowright"] },
      { label: "到文首 / 文末", keys: ["mod+arrowup", "mod+arrowdown"] },
      { label: "全选", keys: ["mod+a"] },
      { label: "撤销 / 重做", keys: ["mod+z", "mod+shift+z"] },
      { label: "复制 / 剪切 / 粘贴", keys: ["mod+c", "mod+x", "mod+v"] },
    ]
  : [
      { label: "到行首 / 行尾", keys: ["home", "end"] },
      { label: "按词移动", keys: ["mod+arrowleft", "mod+arrowright"] },
      { label: "到文首 / 文末", keys: ["mod+home", "mod+end"] },
      { label: "全选", keys: ["mod+a"] },
      { label: "撤销 / 重做", keys: ["mod+z", "mod+y"] },
      { label: "复制 / 剪切 / 粘贴", keys: ["mod+c", "mod+x", "mod+v"] },
    ];

/**
 * 源码编辑器里移动光标的键（keymap 的写法）→ 编辑器命令。nsh 0.6.0 的源码编辑器在 web host 上自己不处理这几个键
 * （2026-11-24 实测 Home、Cmd+←、Ctrl+A 都不动），由应用接过来转成它的命令。
 * 苹果键位上 Cmd+方向键、Ctrl+A / E 是行和文档的两端；别处 Ctrl+A 是全选、Ctrl+方向键是按词，不能接。
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
  message: string;
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
    return { message: `已交给浏览器下载：${name}`, confirmed: false };
  }
  return { message: `已存到 ${await saveToDownloads(name, text)}`, confirmed: true };
}

/**
 * 离开时把没写的改动存下来。`stash` 同步记下改动、返回记没记稳；`save` 是正常的写入。
 * 浏览器里关标签页、刷新、跳走时 IndexedDB 的写入来不及提交（2026-11-25 实测丢字），所以先 `stash`：
 * 记稳了直接放行；没记稳就不放行，浏览器会问要不要离开，同时照常 `save`。页面真的没了（`quit`）时再记一次。
 * 别处：退出时等 `save`（nsh 最多等 200ms）。
 */
export function saveBeforeLeaving(stash: () => boolean, save: () => Promise<unknown>) {
  if (!IN_BROWSER) {
    Application.on("quit", () => save().then(() => undefined));
    return;
  }
  Application.on("quitRequest", () => {
    if (stash()) Application.quit();
    else void save();
  });
  Application.on("quit", () => void stash());
}

/** 这台设备上的文库文件夹：macOS 应用是 `~/Documents/Pairdown`，别处没有（网页里用网关或浏览器本地）。 */
export const fileLibrary = (): FileLibrary | null => (platform.name === "macos" ? { store: createFileStore(), folder: LIBRARY_FOLDER } : null);

/** 网页里启动时先试着连本机网关。 */
export const PROBE_GATEWAY = IN_BROWSER;

/** 菜单栏上的一条命令：名字、快捷键（keymap 的写法，没有是 undefined）、选中时做什么。 */
export interface MenuCommand {
  label: string;
  shortcut: string | undefined;
  onSelect: () => void;
}

/**
 * 放好系统菜单栏（只有 macOS 应用有，别处什么都不做）：应用菜单、文件、编辑（系统自带的撤销、剪切这些）、视图、窗口。
 * 文件和视图两个菜单里放什么由编辑页给。再调一次就整个换掉。
 */
export function setMenuBar(file: MenuCommand[], view: MenuCommand[]) {
  if (platform.name !== "macos") return;
  Menu.setApplicationMenu([
    { label: "Pairdown", submenu: [{ role: "about" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "showAll" }, { type: "separator" }, { role: "quit" }] },
    { label: "文件", submenu: file },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "视图", submenu: view },
    { label: "窗口", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "toggleFullScreen" }] },
  ]);
}

/** 系统交来的文件在哪：文库里的给 id，文库外的给读出的内容（读不了是 null）。 */
export const locateOpenedFile = locateFile;

/**
 * 系统交来要打开的文件（访达里「打开方式」、双击、拖到程序坞图标，和拖进窗口）：macOS 应用里才有，给的是绝对路径。
 * 启动前就来了的文件 nsh 会在挂上监听时补交。返回停止监听的函数。
 */
export function onOpenFiles(handler: (paths: string[]) => void): () => void {
  if (platform.name !== "macos") return () => undefined;
  return Application.on("openFiles", ({ paths }) => handler(paths));
}

/** 拖进窗口的文件（`file:` 地址）→ 绝对路径；只在 macOS 应用里处理，别处给空。 */
export function droppedPaths(uris: string[]): string[] {
  if (platform.name !== "macos") return [];
  return uris.filter((u) => u.startsWith("file://")).map((u) => decodeURIComponent(new URL(u).pathname));
}

/** 拖进窗口、从访达复制来的本地图片（绝对路径）的字节：只有 macOS 应用拿得到路径；读不了（不在文库和「下载」里）抛错。 */
export function readImageFile(path: string): Promise<Uint8Array> {
  if (platform.name !== "macos") return Promise.reject(new Error("这里读不了本地文件"));
  return readFileBytes(path);
}

/**
 * GitHub 登录走哪种流程：网页里是网页授权（跳 GitHub 再回来，code 经中转 Worker 换 token）；
 * 桌面应用里是 Device Flow（显示用户码，应用直接请求 github.com，不受浏览器跨域限制）。
 */
export const SIGN_IN_FLOW: "web" | "device" = IN_BROWSER ? "web" : "device";
