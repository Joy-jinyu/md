import { expect, test } from "nsh/test";
import { chineseStorage, open } from "./fixtures/chinese-open";
import { LAST_OPENED_KEY } from "../src/store/library";
import { bodyKey, metaKey } from "../src/store/local-store";
import { RED_PNG } from "./fixtures/images";
import { seedLibrary, sharedStorage } from "./fixtures/library";
import { memoryFs } from "./fixtures/memory-fs";

const WEB = { platform: "web" as const, width: 1280, height: 860 };
const MAC = { platform: "macos" as const, width: 1280, height: 860 };
const ALPHA = "# Alpha\n\nfirst doc\n";
const BETA = "# Beta\n\nsecond doc\n";
const LIBRARY = {
  ...seedLibrary([
    { id: "da", name: "Alpha", text: ALPHA, updatedAt: 2 },
    { id: "db", name: "Beta", text: BETA, updatedAt: 1 },
  ]),
  [LAST_OPENED_KEY]: "da",
};

/** 同步配好的入口：「同步…」要有配置才出现，不能靠打包时的部署配置。 */
const openLibrary = () => open("./fixtures/sync-app.tsx", { ...WEB, storage: LIBRARY });
type App = Awaited<ReturnType<typeof openLibrary>>;

async function refocus(app: App) {
  await app.setLifecycle("background");
  await app.setLifecycle("active");
}

async function viaPalette(app: App, command: string) {
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("id:palette", command);
  await app.keyboard.press("enter");
}

async function fromDocMenu(app: App, action: string) {
  await app.press("id:toggle-sidebar");
  await app.waitFor("id:documents");
  await app.press("id:doc-more-da");
  await app.press(`id:${action}`);
}

/** 对话框名、怎么打开、打开后它的 testID。 */
const DIALOGS: [string, (app: App) => Promise<void>, string][] = [
  ["settings", (app) => app.keyboard.press("mod+,"), "id:settings"],
  ["history", (app) => viaPalette(app, "版本历史"), "id:history"],
  ["sync", (app) => viaPalette(app, "同步…"), "id:sync"],
  ["quick open", (app) => app.keyboard.press("mod+shift+o"), "id:quick-open"],
  ["command palette", (app) => app.keyboard.press("mod+shift+p"), "id:palette"],
  ["rename", (app) => fromDocMenu(app, "doc-rename"), "id:rename"],
  ["delete", (app) => fromDocMenu(app, "doc-delete"), "id:delete-confirm"],
];

for (const [name, show, selector] of DIALOGS) {
  test(`keys pressed while the ${name} dialog is open never reach the document`, async () => {
    const app = await openLibrary();
    await app.waitFor("text:first doc");
    await app.type("label:正文", "x");
    await refocus(app);
    const before = app.storage()[bodyKey("da")];
    await show(app);
    await app.waitFor(selector);
    for (const key of ["q", "w", "backspace"]) await app.keyboard.press(key);
    await app.back();
    await app.waitUntil(() => !app.shows(selector), { timeout: 3000 });
    await refocus(app);
    expect(before).not.toBe(ALPHA);
    expect(app.storage()[bodyKey("da")]).toBe(before);
  });
}

test("the settings dialog takes the keyboard as it opens: what is typed goes into its search field", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await app.type("label:正文", "x");
  await app.keyboard.press("mod+,");
  await app.waitFor("id:settings");
  await app.keyboard.press("q");
  expect(app.value("id:shortcut-search")).toBe("q");
});

/** 应用读写 `data`：测试改它就像另一个标签页改了存储。 */
async function openShared() {
  const shared = sharedStorage(chineseStorage(LIBRARY));
  const app = await open("../App.tsx", { ...WEB, modules: shared.modules });
  await app.waitFor("text:first doc");
  return { app, data: shared.data };
}

test("quick open and the command palette close when the document is reloaded underneath them", async () => {
  const { app, data } = await openShared();
  for (const [keys, selector] of [["mod+shift+o", "id:quick-open"], ["mod+shift+p", "id:palette"]]) {
    await app.keyboard.press(keys);
    await app.waitFor(selector);
    const meta = JSON.parse(data.get(metaKey("da")) ?? "{}") as { version: number };
    data.set(bodyKey("da"), `# Alpha\n\nreloaded ${keys}\n`);
    data.set(metaKey("da"), JSON.stringify({ ...meta, version: meta.version + 1 }));
    await refocus(app);
    await app.waitFor(`text:reloaded ${keys}`);
    await app.waitUntil(() => !app.shows(selector), { timeout: 3000 });
  }
});

test("a document deleted elsewhere closes quick open, and the top bar says it was deleted rather than in conflict", async () => {
  const { app, data } = await openShared();
  await app.type("label:正文", " precious");
  await app.keyboard.press("mod+shift+o");
  await app.waitFor("id:quick-open");
  data.delete(bodyKey("da"));
  data.delete(metaKey("da"));
  await refocus(app);
  await app.waitFor("id:abandon-deleted");
  await app.waitUntil(() => !app.shows("id:quick-open"), { timeout: 3000 });
  expect(app.shows("text:这篇已经在另一个标签页里删除了，没有保存")).toBe(true);
  expect(app.shows("text:和别处的修改冲突，没有保存")).toBe(false);
});

test("in a library folder, quick open finds a document by the heading it was saved with, not only its file name", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await open("../App.tsx", { ...MAC, modules: disk.modules });
  await app.waitFor("text:first doc");
  await app.keyboard.press("mod+alt+n");
  await app.waitUntil(() => !app.shows("text:first doc"), { timeout: 3000 });
  await app.type("label:正文", "smoke-new heading");
  await refocus(app);
  await app.waitUntil(() => Object.values(disk.library()).includes("smoke-new heading\n"), { timeout: 3000 });
  await app.keyboard.press("mod+shift+o");
  await app.waitFor("id:quick-open");
  await app.type("id:quick-open", "smoke");
  expect(app.shows("id:quick-open >> text:没有匹配的文档")).toBe(true);
  await app.back();
  await app.waitUntil(() => !app.shows("id:quick-open"), { timeout: 3000 });
  await app.press("text:smoke-new heading");
  await app.keyboard.press("home");
  await app.type("label:正文", "# ");
  await refocus(app);
  await app.waitUntil(() => Object.values(disk.library()).includes("# smoke-new heading\n"), { timeout: 3000 });
  await app.keyboard.press("mod+shift+o");
  await app.waitFor("id:quick-open");
  await app.type("id:quick-open", "smoke");
  await app.waitFor("id:quick-open >> text:未命名");
  expect(app.texts().some((t) => t.startsWith("smoke-new heading · "))).toBe(true);
});

test("save as from a library folder says the document's images were not saved with it", async () => {
  const disk = memoryFs({ "Pic.md": "# Pic\n\n![red](assets/red.png)\n", "assets/red.png": RED_PNG });
  const app = await open("../App.tsx", { ...MAC, modules: disk.modules });
  await app.waitFor("id:toggle-sidebar");
  await app.keyboard.press("mod+shift+s");
  await app.waitFor("id:receipt");
  expect(app.texts().some((t) => t.endsWith("这篇有 1 张图片没有一起存过去，图片在文库的 assets/ 里"))).toBe(true);
});
