import { open as openApp, type OpenOptions } from "nsh/test";
import { SETTINGS_KEY } from "../../src/store/settings";

/** 已有界面用例按中文文案验证，单独覆盖默认英文及语种切换。 */
export function open(entry: string, options?: OpenOptions | null) {
  return openApp(entry, { ...options, storage: chineseStorage(options?.storage) });
}

export function chineseStorage(seed?: Record<string, string> | null) {
  const storage = { ...seed };
  const settings = JSON.parse(storage[SETTINGS_KEY] ?? "{}") as Record<string, unknown>;
  storage[SETTINGS_KEY] = JSON.stringify({ ...settings, locale: "zh-CN" });
  return storage;
}
