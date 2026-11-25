/**
 * 每条命令现在用哪个键：命令表里的是默认键，设置里改过的盖在上面。
 * 键一律是 ProseMirror 的写法（`Mod-Shift-p`）。这里不碰存储，改过的键由启动时和设置页交进来。
 */
import { APPLE_KEYS } from "../../platform";
import type { ShortcutOverrides } from "../../store/settings";
import { type AppCommand, COMMANDS, isViewCommand } from "./commands";

let overrides: ShortcutOverrides = {};

/** 现在生效的改动（已经筛过）。 */
export const currentOverrides = (): ShortcutOverrides => overrides;

/** 换一份改动。建编辑器会话、绑应用级的键都读它，所以换完要重建编辑页才生效。 */
export function setOverrides(raw: ShortcutOverrides) {
  overrides = sanitize(raw);
}

interface Parsed {
  mods: string[];
  base: string;
}

const MODS = ["Ctrl", "Mod", "Alt", "Shift"];
const modName = (part: string) => MODS.find((m) => m.toLowerCase() === part.toLowerCase());

/** 拆成修饰键和主键。`Mod--` 的主键是 `-`。修饰键不分大小写；别处（非苹果键位）Ctrl 就是 Mod。 */
function parse(key: string): Parsed {
  const minus = key.endsWith("--") || key === "-";
  const parts = (minus ? key.slice(0, -1) : key).split("-").filter((p) => p !== "");
  const mods = parts.flatMap((p) => modName(p) ?? []).map((m) => (m === "Ctrl" && !APPLE_KEYS ? "Mod" : m));
  const rest = parts.filter((p) => !modName(p));
  return { mods, base: minus ? "-" : (rest[0] ?? "") };
}

/** 同一个组合键的统一写法：修饰键按固定顺序，单个字母小写。比较两个键是不是同一个要先过它。 */
export function canonical(key: string): string {
  const { mods, base } = parse(key);
  const name = base.length === 1 ? base.toLowerCase() : base;
  return [...MODS.filter((m) => mods.includes(m)), name].join("-");
}

/** 这条命令现在的键；没有键是 undefined。`from` 默认是生效的那份改动，设置页传它正在编辑的草稿。 */
export function keyOf(c: AppCommand, from: ShortcutOverrides = overrides): string | undefined {
  return c.id in from ? (from[c.id] ?? undefined) : c.key;
}

/** 现在用着这个键的另一条命令。 */
export function conflictOf(key: string, exceptId: string, from: ShortcutOverrides): AppCommand | undefined {
  const want = canonical(key);
  return COMMANDS.find((c) => {
    const k = keyOf(c, from);
    return c.id !== exceptId && k !== undefined && canonical(k) === want;
  });
}

/** keymap 写法里和 ProseMirror 写法拼法不同的主键名。 */
const NAMED_KEYS: Record<string, string> = { enter: "Enter", backspace: "Backspace", delete: "Delete" };

/** keymap 的写法（`mod+shift+b`）→ 这里用的写法（`Mod-Shift-b`）。`keys.ts` 的 `toKeymapName` 是反方向。 */
export function fromKeymapName(keystroke: string): string {
  const parts = keystroke.split("+");
  const base = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((m) => m[0].toUpperCase() + m.slice(1));
  const name = NAMED_KEYS[base] ?? (/^f\d+$/.test(base) ? base.toUpperCase() : base);
  return canonical([...mods, name].join("-"));
}

const RECORD_BASES = [
  ..."abcdefghijklmnopqrstuvwxyz0123456789",
  ..."`-=[]\\;',./",
  "enter",
  "backspace",
  "delete",
];
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, i) => `f${i + 1}`);

/**
 * 录新快捷键时要接住的全部组合键（keymap 的写法）。
 * 这样一个个列出来，是因为 nsh 0.6.0 的 web host 上对话框里的 `onKeyDown` 收不到按键（2026-11-24 实测，输入框和外层视图都试过），
 * 只能用应用级的 keymap 把可能的组合都绑上。不带 ⌘ / Ctrl / Alt 的普通字符不在里面：那是在打字。
 */
export function recordableKeystrokes(apple = APPLE_KEYS): string[] {
  const strong = apple ? ["mod", "ctrl", "alt", "ctrl+mod", "mod+alt", "ctrl+alt", "ctrl+mod+alt"] : ["mod", "alt", "mod+alt"];
  const prefixes = strong.flatMap((m) => [m, `${m}+shift`]);
  const combos = prefixes.flatMap((p) => [...RECORD_BASES, ...FUNCTION_KEYS].map((base) => `${p}+${base}`));
  return [...combos, ...FUNCTION_KEYS, ...FUNCTION_KEYS.map((f) => `shift+${f}`)];
}

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;
/** 能当主键的名字：录键时接的那些。存储里出现别的名字（手改坏了、旧版本留下的）一律不认，不然绑键时会抛错、整页出不来。 */
const KNOWN_BASES = new Set([...RECORD_BASES.map((b) => NAMED_KEYS[b] ?? b), ...FUNCTION_KEYS.map((f) => f.toUpperCase())]);
/** 留给系统和基本编辑的组合键。Mod-q / h / m、Ctrl-Mod-f、Mod-Alt-h、F11、Alt-F4 是 nsh 的 keymap 明说或实测绑不上的。 */
const RESERVED = new Set(
  ["Mod-q", "Mod-h", "Mod-m", "Mod-w", "Mod-t", "Mod-n", "Ctrl-Mod-f", "Mod-Alt-h", "F11", "Alt-F4", "Mod-c", "Mod-v", "Mod-x", "Mod-z", "Mod-Shift-z", "Mod-y", "Mod-a", "Mod-Shift-v"].map(canonical),
);
/** 源码编辑器自己要用的键：绑给查找、命令面板、源码视图这些在源码里也要用的命令，进了源码视图就不灵了。实测到的几个，不全。 */
const SOURCE_EDITOR_KEYS = new Set(["Mod-/", "Mod-]", "Mod-[", "Mod-Shift-k", "F3"].map(canonical));

/**
 * 这个键不能绑时的原因；能绑是 null。只管用户新设的键，命令表里的默认键不过这里。
 * `forEditor`：这条是在正文里起作用的命令（不是「视图」组）。它们的键由编辑器内核的键表去认，
 * 只带 Alt 或单按功能键的组合内核认不出来（2026-11-24 实测 F5、Alt-b 绑给粗体不起作用），所以要带 ⌘ 或 Ctrl。
 */
export function rejectReason(key: string, forEditor: boolean): string | null {
  const { mods, base } = parse(canonical(key));
  if (!KNOWN_BASES.has(base)) return "这个键不能用作快捷键";
  if (RESERVED.has(canonical(key))) return "这个键留给系统或基本编辑（退出、复制、撤销这些）";
  const command = mods.includes("Mod") || mods.includes("Ctrl");
  if (forEditor) return command ? null : "编辑命令的键要带 ⌘ 或 Ctrl";
  if (!command && !mods.includes("Alt") && !FUNCTION_KEY.test(base)) return "要带 ⌘ / Ctrl / Alt，或者用 F1–F12";
  if (SOURCE_EDITOR_KEYS.has(canonical(key))) return "源码编辑器会自己用掉这个键，在源码视图里按了没用";
  return null;
}

/** 浏览器多半会先处理的键（换标签页、地址栏、刷新、书签、搜索栏、开发者工具的选取元素…）。按常识列的，没有逐个在真实浏览器里测。 */
const BROWSER_KEYS = new Set(["Mod-l", "Mod-r", "Mod-d", "Mod-e", "Mod-p", "Mod-s", "Mod-o", "Mod-j", "Mod-,", "Mod-Shift-c", ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `Mod-${n}`)].map(canonical));

export const browserMayTake = (key: string) => BROWSER_KEYS.has(canonical(key));

/** 两条命令现在落在同一个键上时，返回其中该退回默认的那条（有改动的那条；都有就退表里靠后的）。 */
function clashing(out: ShortcutOverrides): AppCommand | undefined {
  for (const c of COMMANDS) {
    const key = keyOf(c, out);
    const other = key === undefined ? undefined : conflictOf(key, c.id, out);
    if (other) return other.id in out ? other : c.id in out ? c : undefined;
  }
  return undefined;
}

/** 存着的改动里只留认识的命令、能用的键；和默认一样的不留。撞键的退回默认，直到没有两条命令用同一个键。 */
export function sanitize(raw: ShortcutOverrides): ShortcutOverrides {
  const out: ShortcutOverrides = {};
  for (const c of COMMANDS) {
    if (!(c.id in raw)) continue;
    const value = raw[c.id];
    if (value === null) {
      if (c.key !== undefined) out[c.id] = null;
      continue;
    }
    const key = canonical(value);
    if (c.key !== undefined && canonical(c.key) === key) continue;
    if (rejectReason(key, !isViewCommand(c)) === null) out[c.id] = key;
  }
  // 全部收齐再查撞键：两条命令互换键时，单看其中一条会以为它撞上了对方的默认键
  for (let loser = clashing(out); loser; loser = clashing(out)) delete out[loser.id];
  return out;
}

/**
 * 要挡掉的旧键：命令的键被改走、这个旧键又没分给别的命令。
 * 这些默认键有的编辑器内核自己也绑着（粗体 Mod-b、代码块 Mod-Alt-c…），不挡的话改走以后旧键还照样起作用。
 * 表格那几条不挡：它们的键（Mod-Enter 等）在表格外要落到别的绑定上（退出代码块）。
 */
export function shadowedDefaults(from: ShortcutOverrides = overrides): string[] {
  return COMMANDS.filter((c) => c.rich && c.group !== "表格" && c.key !== undefined && c.id in from)
    .map((c) => c.key as string)
    .filter((key) => !COMMANDS.some((c) => {
      const k = keyOf(c, from);
      return k !== undefined && canonical(k) === canonical(key);
    }));
}
