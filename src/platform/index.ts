/** 平台差异的唯一位置：features 只引这里导出的值。 */
import { keymap, platform } from "nsh";
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
 * 把一段文字存成用户拿得到的文件。
 * 浏览器里是下载：位置由浏览器定，用户可能在「存到哪」的框里点了取消，页面无从知道，所以 `confirmed` 是 false。
 * 桌面应用里存进「下载」文件夹，写完才返回，`confirmed` 是 true。
 */
export async function saveTextFile(name: string, text: string): Promise<SavedFile> {
  if (IN_BROWSER) {
    downloadText(name, text);
    return { message: `已交给浏览器下载：${name}`, confirmed: false };
  }
  return { message: `已存到 ${await saveToDownloads(name, text)}`, confirmed: true };
}
