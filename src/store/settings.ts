/** 本机存的设置（现在只有改过的快捷键）。和文档正文一样，只有 store 碰 Storage。 */
import { Storage } from "nsh";

/** 设置的存储键。 */
export const SETTINGS_KEY = "md.settings";

/** 改过的快捷键：命令 id → 键（ProseMirror 写法）；null 是这条命令不绑键。没改过的命令不在里面。 */
export type ShortcutOverrides = Record<string, string | null>;

function readOverrides(raw: unknown): ShortcutOverrides {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, string | null] => entry[1] === null || typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/**
 * 读出改过的快捷键。存的内容坏了（不是 JSON、形状不对）就当没改过：设置坏了不能让应用打不开。
 * 这里只看形状；命令 id 认不认识、键能不能用由 `keybindings.ts` 再筛。
 */
export async function loadShortcutOverrides(): Promise<ShortcutOverrides> {
  try {
    const text = await Storage.getItem(SETTINGS_KEY);
    if (!text) return {};
    return readOverrides((JSON.parse(text) as { shortcuts?: unknown }).shortcuts);
  } catch (e) {
    console.warn("settings unreadable, using defaults", e);
    return {};
  }
}

/** 写入改过的快捷键；写不进去时返回原因。 */
export async function saveShortcutOverrides(shortcuts: ShortcutOverrides): Promise<string | null> {
  try {
    await Storage.setItem(SETTINGS_KEY, JSON.stringify({ shortcuts }));
    return null;
  } catch (e) {
    console.error("settings not saved", e);
    return e instanceof Error ? e.message : String(e);
  }
}
