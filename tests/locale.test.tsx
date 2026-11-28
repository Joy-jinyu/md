import { expect, open, test } from "nsh/test";
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";
import { metaKey } from "../src/store/local-store";
import { SETTINGS_KEY } from "../src/store/settings";
import { storedIds } from "./fixtures/library";
import { memoryFs } from "./fixtures/memory-fs";

const WEB = { platform: "web" as const, width: 1280, height: 860 };

test("the editor defaults to English and changes its interface without reloading the document", async () => {
  const app = await open("../App.tsx", WEB);
  await app.waitUntil(() => app.texts().some((text) => text.includes("Start writing here…")));
  await app.press("id:open-settings");
  await app.waitFor("text:Keyboard shortcuts");
  await app.press("id:settings-tab-language");
  await app.press("id:language-zh-CN");
  await app.waitFor("text:选择编辑器界面的显示语言。");
  await app.waitUntil(() => (app.storage()[SETTINGS_KEY] ?? "").includes("zh-CN"));
  await app.press("id:settings-done");
  await app.waitUntil(() => app.texts().some((text) => text.includes("从这里开始写…")));
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("text:标题 1");
});

test("switching the language keeps the typed text and its undo history", async () => {
  const app = await open("../App.tsx", WEB);
  await app.waitUntil(() => app.texts().some((text) => text.includes("Start writing here…")));
  await app.type("label:Body", "kept across languages");
  await app.waitFor("text:kept across languages");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-language");
  await app.press("id:language-zh-CN");
  await app.waitUntil(() => (app.storage()[SETTINGS_KEY] ?? "").includes("zh-CN"));
  await app.press("id:settings-done");
  await app.waitFor("label:正文");
  expect(app.shows("text:kept across languages")).toBe(true);
  await app.press("text:kept across languages");
  await app.keyboard.press("mod+z");
  await app.waitUntil(() => !app.shows("text:kept across languages"));
});

test("a new document is named in the interface language, and earlier names stay as they were", async () => {
  const app = await open("../App.tsx", WEB);
  await app.waitUntil(() => app.texts().some((text) => text.includes("Start writing here…")));
  await app.press("id:open-settings");
  await app.press("id:settings-tab-language");
  await app.press("id:language-zh-CN");
  await app.waitUntil(() => (app.storage()[SETTINGS_KEY] ?? "").includes("zh-CN"));
  await app.press("id:settings-done");
  await app.waitFor("label:正文");
  await app.keyboard.press("mod+alt+n");
  await app.waitUntil(() => storedIds(app.storage()).length === 2, { timeout: 3000 });
  const names = storedIds(app.storage()).map((id) => JSON.parse(app.storage()[metaKey(id)] ?? "{}").name);
  expect(names.sort()).toEqual(["Untitled", "未命名"]);
});

test("a receipt still on screen switches language with the interface", async () => {
  const disk = memoryFs({});
  const app = await open("../App.tsx", { platform: "macos", width: 1280, height: 860, modules: disk.modules, storage: { [DOC_KEY]: "# Trip plan\n\nday one\n" } });
  await app.waitFor("text:day one");
  await app.keyboard.press("mod+shift+s");
  await app.waitFor("text:Saved to /Users/t/Downloads/Trip plan.md");
  await app.keyboard.press("mod+,");
  await app.press("id:settings-tab-language");
  await app.press("id:language-zh-CN");
  await app.press("id:settings-done");
  await app.waitFor("text:已存到 /Users/t/Downloads/Trip plan.md");
  expect(app.shows("text:Saved to /Users/t/Downloads/Trip plan.md")).toBe(false);
});

test("a saved Chinese preference is applied on the next startup and can be switched back", async () => {
  const saved = { locale: "zh-CN", skipImageHost: true };
  const app = await open("../App.tsx", { ...WEB, storage: { [SETTINGS_KEY]: JSON.stringify(saved) } });
  await app.waitUntil(() => app.texts().some((text) => text.includes("从这里开始写…")));
  await app.press("id:open-settings");
  await app.press("id:settings-tab-language");
  await app.press("id:language-en");
  await app.waitFor("text:Choose the display language for the editor.");
  await app.waitUntil(() => (app.storage()[SETTINGS_KEY] ?? "").includes('"en"'));
  expect(JSON.parse(app.storage()[SETTINGS_KEY])).toEqual({ ...saved, locale: "en" });
});
