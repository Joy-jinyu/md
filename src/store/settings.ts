/** 本机存的设置（改过的快捷键、「不用图床」）。和文档正文一样，只有 store 碰 Storage。 */
import { Storage } from "nsh";

/** 设置的存储键。 */
export const SETTINGS_KEY = "md.settings";

export type Locale = "en" | "zh-CN";

/** 改过的快捷键：命令 id → 键（ProseMirror 写法）；null 是这条命令不绑键。没改过的命令不在里面。 */
export type ShortcutOverrides = Record<string, string | null>;

function readOverrides(raw: unknown): ShortcutOverrides {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, string | null] => entry[1] === null || typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

/** 整个设置对象；没存过是空对象，存坏了抛错。 */
async function readSettings(): Promise<Record<string, unknown>> {
  const text = await Storage.getItem(SETTINGS_KEY);
  if (!text) return {};
  const raw: unknown = JSON.parse(text);
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** 只改设置里的一项，别的项原样留着；写不进去时返回原因。 */
let pendingWrite: Promise<unknown> = Promise.resolve();

function saveSetting(key: string, value: unknown): Promise<string | null> {
  const write = pendingWrite.then(() => writeSetting(key, value));
  pendingWrite = write;
  return write;
}

async function writeSetting(key: string, value: unknown): Promise<string | null> {
  try {
    const now = await readSettings().catch((e: unknown) => {
      console.warn("settings unreadable, starting over", e);
      return {};
    });
    await Storage.setItem(SETTINGS_KEY, JSON.stringify({ ...now, [key]: value }));
    return null;
  } catch (e) {
    console.error("settings not saved", e);
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * 读出改过的快捷键。存的内容坏了（不是 JSON、形状不对）就当没改过：设置坏了不能让应用打不开。
 * 这里只看形状；命令 id 认不认识、键能不能用由 `keybindings.ts` 再筛。
 */
export async function loadShortcutOverrides(): Promise<ShortcutOverrides> {
  try {
    return readOverrides((await readSettings()).shortcuts);
  } catch (e) {
    console.warn("settings unreadable, using defaults", e);
    return {};
  }
}

/** 写入改过的快捷键；写不进去时返回原因。 */
export const saveShortcutOverrides = (shortcuts: ShortcutOverrides) => saveSetting("shortcuts", shortcuts);

/** 用户选过「不用图床」：插图时没设置图床也不再问。读不出来当没选过。 */
export async function loadSkipImageHost(): Promise<boolean> {
  try {
    return (await readSettings()).skipImageHost === true;
  } catch (e) {
    console.warn("settings unreadable, asking about the image host", e);
    return false;
  }
}

/** 记下「不用图床」（false 是重新问）；写不进去时返回原因。 */
export const saveSkipImageHost = (skip: boolean) => saveSetting("skipImageHost", skip);

/** 用户选过「上传，以后不再问」：设置了图床时插图直接上传，不先确认。读不出来当没选过。 */
export async function loadAutoUpload(): Promise<boolean> {
  try {
    return (await readSettings()).autoUploadImages === true;
  } catch (e) {
    console.warn("settings unreadable, confirming uploads", e);
    return false;
  }
}

/** 记下「上传前不用问」（false 是每次先问）；写不进去时返回原因。 */
export const saveAutoUpload = (auto: boolean) => saveSetting("autoUploadImages", auto);

export async function loadLocale(): Promise<Locale> {
  try {
    return (await readSettings()).locale === "zh-CN" ? "zh-CN" : "en";
  } catch (e) {
    console.warn("settings unreadable, using English", e);
    return "en";
  }
}

export const saveLocale = (locale: Locale) => saveSetting("locale", locale);
