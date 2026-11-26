import { expect, open as openDefault, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
// 旧版（单篇）的正文键：存进去的那篇启动时原地成为文档库的第一篇，测试照旧在这里读写
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";
import { SETTINGS_KEY } from "../src/store/settings";
import { memoryFs } from "./fixtures/memory-fs";

const WEB = { platform: "web" as const, width: 1280, height: 860 };

const openApp = (doc: string, settings?: string) => open("../App.tsx", { ...WEB, storage: settings === undefined ? { [DOC_KEY]: doc } : { [DOC_KEY]: doc, [SETTINGS_KEY]: settings } });
type App = Awaited<ReturnType<typeof openApp>>;

/** 切到后台会立即保存；一条测试里要读两次，所以先切回前台。 */
async function saved(app: App): Promise<string> {
  await app.setLifecycle("active");
  await app.setLifecycle("background");
  return app.storage()[DOC_KEY] ?? "";
}

/** 在文首按一个键再打一个 x，看存下的 Markdown：这个键是粗体的话 x 是粗的。 */
async function typeAfter(app: App, keys: string): Promise<string> {
  await app.keyboard.press(keys);
  await app.type("label:正文", "x");
  return saved(app);
}

async function rebind(app: App, id: string, keys: string) {
  await app.press("id:open-settings");
  await app.waitFor("id:settings");
  await app.press(`id:shortcut-edit-${id}`);
  await app.waitFor("id:shortcut-capture");
  await app.keyboard.press(keys);
}

async function done(app: App) {
  await app.press("id:settings-done");
  await app.waitUntil(() => !app.shows("id:settings"), { timeout: 3000 });
  await app.waitFor("label:正文");
  await app.wait(300);
}

test("a rebound shortcut works, the old key stops working, and the choice is stored", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await rebind(app, "format.bold", "mod+alt+b");
  await done(app);
  expect(await typeAfter(app, "mod+b")).toBe("xhello\n");
  expect(await typeAfter(app, "mod+alt+b")).toBe("x**x**hello\n");
  expect(JSON.parse(app.storage()[SETTINGS_KEY] ?? "{}")).toEqual({ locale: "zh-CN", shortcuts: { "format.bold": "Mod-Alt-b" } });
});

test("text typed before changing a shortcut is still there after the editor reloads", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await app.type("label:正文", "new ");
  await rebind(app, "format.bold", "mod+alt+b");
  await done(app);
  // 重新载入后的编辑页里也得是新内容，不能只是存储里有
  await app.waitFor("text:new hello");
  expect(await saved(app)).toBe("new hello\n");
});

test("a key another command uses is not taken silently: the user swaps or cancels", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await rebind(app, "format.bold", "mod+i");
  await app.waitFor("id:shortcut-note");
  expect(app.shows("id:shortcut-swap")).toBe(true);
  await app.press("id:shortcut-swap");
  await done(app);
  expect(await typeAfter(app, "mod+i")).toBe("**x**hello\n");
});

test("a key kept for basic editing is refused with a reason", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await rebind(app, "format.bold", "mod+c");
  await app.waitFor("id:shortcut-note");
  expect(app.shows("id:shortcut-swap")).toBe(false);
  expect(app.shows("id:shortcut-capture")).toBe(true);
});

test("restoring a changed shortcut brings the default key back", async () => {
  const app = await openApp("hello\n", JSON.stringify({ shortcuts: { "format.bold": "Mod-Alt-b" } }));
  await app.waitFor("text:hello");
  await app.press("id:open-settings");
  await app.waitFor("id:settings");
  await app.press("id:shortcut-restore-format.bold");
  await done(app);
  expect(await typeAfter(app, "mod+b")).toBe("**x**hello\n");
  expect(JSON.parse(app.storage()[SETTINGS_KEY] ?? "{}")).toEqual({ locale: "zh-CN", shortcuts: {} });
});

test("a command without a default key can be given one", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await rebind(app, "block.task", "mod+alt+k");
  await done(app);
  await app.press("text:hello");
  await app.keyboard.press("mod+alt+k");
  expect(await saved(app)).toBe("- [ ] hello\n");
});

test("broken stored settings do not stop the app: defaults apply", async () => {
  const app = await openDefault("../App.tsx", { ...WEB, storage: { [DOC_KEY]: "hello\n", [SETTINGS_KEY]: "{not json" } });
  await app.waitFor("text:hello");
  await app.keyboard.press("mod+b");
  await app.type("label:Body", "x");
  expect(await saved(app)).toBe("**x**hello\n");
});

test("shortcuts do not run while the settings dialog is open", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await app.press("id:open-settings");
  await app.waitFor("id:settings");
  await app.keyboard.press("mod+f");
  await app.wait(300);
  expect(app.shows("id:find-bar")).toBe(false);
});

test("a stored key the app cannot bind is dropped instead of blanking the editor", async () => {
  const app = await openApp("hello\n", JSON.stringify({ shortcuts: { "view.find": "Mod-Foo" } }));
  await app.waitFor("text:hello");
  await app.keyboard.press("mod+f");
  await app.waitFor("id:find-bar");
});

test("restoring a default key that another command now uses asks first", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await rebind(app, "format.bold", "mod+i");
  await app.waitFor("id:shortcut-swap");
  await app.press("id:shortcut-swap");
  await app.press("id:shortcut-restore-format.italic");
  await app.waitFor("id:shortcut-note");
  expect(app.shows("id:shortcut-swap")).toBe(true);
});

test("an editing command is refused a key the editor cannot see", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await rebind(app, "format.bold", "f5");
  await app.waitFor("id:shortcut-note");
  expect(app.shows("id:shortcut-capture")).toBe(true);
});

test("a rebound view command works from the document and from the source view", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await rebind(app, "view.find", "mod+alt+j");
  await done(app);
  await app.keyboard.press("mod+alt+j");
  await app.waitFor("id:find-bar");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:find-bar"), { timeout: 3000 });
  await app.keyboard.press("mod+alt+/");
  await app.waitFor("label:Markdown 源码");
  await app.keyboard.press("mod+alt+j");
  await app.waitFor("id:find-bar");
});

test("the old key of a moved code-block shortcut no longer makes a code block", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await rebind(app, "block.code", "mod+alt+k");
  await done(app);
  await app.press("text:hello");
  await app.keyboard.press("mod+alt+c");
  expect(await saved(app)).toBe("hello\n");
});

test("clearing a shortcut leaves the command without a key", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await app.press("id:open-settings");
  await app.waitFor("id:settings");
  await app.press("id:shortcut-clear-format.bold");
  await done(app);
  expect(await typeAfter(app, "mod+b")).toBe("xhello\n");
  expect(JSON.parse(app.storage()[SETTINGS_KEY] ?? "{}")).toEqual({ locale: "zh-CN", shortcuts: { "format.bold": null } });
});

test("one Escape closes settings opened with Mod+, while the document has the focus, on macOS too", async () => {
  const disk = memoryFs({ "Alpha.md": "hello\n" });
  for (const app of [await openApp("hello\n"), await open("../App.tsx", { platform: "macos", width: 1280, height: 860, modules: disk.modules })]) {
    await app.waitFor("text:hello");
    await app.press("text:hello");
    await app.keyboard.press("mod+,");
    await app.waitFor("id:settings");
    await app.keyboard.press("escape");
    await app.waitUntil(() => !app.shows("id:settings"), { timeout: 3000 });
    expect(app.shows("text:hello")).toBe(true);
  }
});

test("Escape with settings open over the find bar does not close the find bar", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await app.keyboard.press("mod+f");
  await app.waitFor("id:find-bar");
  await app.press("id:open-settings");
  await app.waitFor("id:settings");
  await app.keyboard.press("escape");
  await app.wait(300);
  expect(app.shows("id:find-bar")).toBe(true);
});

test("settings is a page of categories: the current one is named for screen readers, and Back returns the keyboard to the document", async () => {
  const app = await openApp("hello\n");
  await app.waitFor("text:hello");
  await app.press("text:hello");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:settings");
  expect(app.shows("label:快捷键（当前）")).toBe(true);
  await app.press("id:settings-tab-storage");
  await app.waitFor("id:storage-kind");
  expect(app.shows("label:存储（当前）")).toBe(true);
  expect(app.shows("label:快捷键（当前）")).toBe(false);
  await app.press("id:settings-done");
  await app.waitUntil(() => !app.shows("id:settings"), { timeout: 3000 });
  await app.wait(100);
  await app.keyboard.press("z");
  const text = await saved(app);
  expect(text.replace("z", "")).toBe("hello\n");
});

test("on a narrow window the categories slide over the content as a drawer, like the sidebar", async () => {
  const app = await open("../App.tsx", { platform: "web", width: 375, height: 760, storage: { [DOC_KEY]: "hello\n" } });
  await app.waitFor("text:hello");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:shortcut-search");
  expect(app.shows("id:settings-tab-sync")).toBe(false);
  await app.press("id:settings-nav-toggle");
  await app.press("id:settings-tab-sync");
  await app.waitFor("id:sync-settings");
  expect(app.shows("id:settings-tab-storage")).toBe(false);
  // 抽屉开着时 Esc 只收起抽屉，设置页还开着
  await app.press("id:settings-nav-toggle");
  await app.waitFor("id:settings-tab-storage");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:settings-tab-storage"), { timeout: 3000 });
  expect(app.shows("id:sync-settings")).toBe(true);
  await app.press("id:settings-nav-toggle");
  // 点抽屉外面的遮罩：遮罩没有自己的 testID，从抽屉里一项往右越过抽屉边缘点下去
  await app.press("id:settings-tab-storage", { position: { x: 300, y: 18 } });
  await app.waitUntil(() => !app.shows("id:settings-tab-storage"), { timeout: 3000 });
  // 录完一个键以后也一样：Esc 只收抽屉
  await app.press("id:settings-nav-toggle");
  await app.press("id:settings-tab-shortcuts");
  await app.press("id:shortcut-edit-block.task");
  await app.waitFor("id:shortcut-capture");
  await app.press("id:settings-nav-toggle");
  await app.keyboard.press("mod+alt+7");
  await app.waitUntil(() => !app.shows("id:shortcut-capture"), { timeout: 3000 });
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:settings-tab-storage"), { timeout: 3000 });
  await app.press("id:settings-done");
  await app.waitUntil(() => !app.shows("id:settings"), { timeout: 3000 });
  expect(app.shows("text:hello")).toBe(true);
});

test("the macOS app has no gateway category, and its image host category says only the web version can use one", async () => {
  const disk = memoryFs({ "Alpha.md": "hello\n" });
  const app = await open("../App.tsx", { platform: "macos", width: 1280, height: 860, modules: disk.modules });
  await app.waitFor("text:hello");
  await app.press("id:open-settings");
  await app.waitFor("id:settings");
  expect(app.shows("id:settings-tab-gateway")).toBe(false);
  await app.press("id:settings-tab-image-host");
  await app.waitFor("text:只有网页版能连本机网关。");
});

test("connected to the gateway, its category shows the connection and the image host category shows the image host", async () => {
  const app = await open("./fixtures/gateway-app.tsx", { ...WEB, host: { params: { docs: { "a.md": "# A\n\nbody\n" } } } });
  await app.waitFor("text:body");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-gateway");
  await app.waitFor("id:gateway-status");
  expect(app.shows("text:已连接")).toBe(true);
  expect(app.shows("id:gateway-howto")).toBe(false);
  await app.press("id:settings-tab-image-host");
  await app.waitFor("id:image-host");
  expect(app.shows("id:image-host-needs-gateway")).toBe(false);
});

test("the shortcut buttons line up in one column whether or not a command has a key", async () => {
  const app = await openApp("# Doc\n");
  await app.press("id:open-settings");
  await app.waitFor("id:settings");
  const x = (sel: string) => app.layout(sel)?.x;
  expect(x("id:shortcut-edit-block.task")).toBe(x("id:shortcut-edit-block.bullet"));
  expect(app.shows("id:shortcut-clear-block.task")).toBe(false);
  expect(x("id:shortcut-clear-block.bullet")).toBe(x("id:shortcut-clear-block.quote"));
});
