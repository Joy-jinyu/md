import { LAST_OPENED_KEY } from "../../src/store/library";
import { bodyKey, metaKey } from "../../src/store/local-store";

export interface SeedDoc {
  id: string;
  name: string;
  text: string;
  updatedAt?: number;
  version?: number;
}

/** 按存储里的样子摆好几篇文档（正文 + 说明），给 `open` 的 `storage`。 */
export function seedLibrary(docs: SeedDoc[]): Record<string, string> {
  return Object.fromEntries(
    docs.flatMap((d) => [
      [bodyKey(d.id), d.text],
      [metaKey(d.id), JSON.stringify({ name: d.name, title: "", updatedAt: d.updatedAt ?? 1, version: d.version ?? 1, size: d.text.length })],
    ]),
  );
}

/** 现在开着的那篇在存储里的正文。 */
export function openedBody(storage: Record<string, string>): string {
  const id = storage[LAST_OPENED_KEY];
  return id === undefined ? "" : (storage[bodyKey(id)] ?? "");
}

/** 存储里有说明的文档 id。 */
export function storedIds(storage: Record<string, string>): string[] {
  return Object.keys(storage)
    .filter((k) => k.startsWith(metaKey("")))
    .map((k) => k.slice(metaKey("").length));
}

/** 换掉应用的 Storage（`open` 的 `modules`）：应用读写的就是这里的 `data`，测试直接改它，当成另一个标签页改了存储。 */
export function sharedStorage(seed: Record<string, string>) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    modules: {
      nsh: {
        "Storage.getItem": (key: string) => data.get(key) ?? null,
        "Storage.setItem": (key: string, value: string) => {
          data.set(key, value);
        },
        "Storage.removeItem": (key: string) => {
          data.delete(key);
        },
        "Storage.keys": () => [...data.keys()],
        "Storage.clear": () => data.clear(),
      },
    },
  };
}
