import { expect, open, test } from "nsh/test";
import { historyKey } from "../src/store/history";
import { LAST_OPENED_KEY } from "../src/store/library";
import { bodyKey, metaKey } from "../src/store/local-store";
import { openedBody, seedLibrary, sharedStorage, storedIds } from "./fixtures/library";

const WEB = { platform: "web" as const, width: 1280, height: 860 };

const ALPHA = "# Alpha\n\nfirst doc\n";
const BETA = "# Beta\n\nsecond doc\n";
const GAMMA = "plain words only\n";

const LIBRARY = {
  ...seedLibrary([
    { id: "da", name: "Alpha", text: ALPHA, updatedAt: 3 },
    { id: "db", name: "Beta", text: BETA, updatedAt: 2 },
    { id: "dc", name: "Gamma", text: GAMMA, updatedAt: 1 },
  ]),
  [LAST_OPENED_KEY]: "da",
};

const openLibrary = (extra: Record<string, string> = {}, options: Record<string, unknown> = {}) => open("../App.tsx", { ...WEB, storage: { ...LIBRARY, ...extra }, ...options });
type App = Awaited<ReturnType<typeof openLibrary>>;

async function saved(app: App): Promise<Record<string, string>> {
  await app.setLifecycle("background");
  await app.setLifecycle("active");
  return app.storage();
}

async function showDocuments(app: App) {
  await app.press("id:toggle-sidebar");
  await app.waitFor("id:documents");
}

test("picking a document opens it with its own content and undo history, and edits go into that one only", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await showDocuments(app);
  // 先在 A 里改一笔，切到 B 以后撤销：撤的不是 A 的那一笔，B 不变，A 存下的也不变
  await app.press("text:first doc");
  await app.keyboard.press("end");
  await app.type("label:正文", " changed");
  await app.press("id:doc-db");
  await app.waitFor("text:second doc");
  expect(app.shows("text:first doc changed")).toBe(false);
  await app.press("text:second doc");
  await app.keyboard.press("mod+z");
  await app.wait(300);
  expect(app.shows("text:second doc")).toBe(true);
  expect(app.storage()[bodyKey("da")]).toBe("# Alpha\n\nfirst doc changed\n");
  await app.keyboard.press("end");
  await app.type("label:正文", " edited");
  const storage = await saved(app);
  expect(storage[bodyKey("db")]).toBe("# Beta\n\nsecond doc edited\n");
  expect(storage[bodyKey("da")]).toBe("# Alpha\n\nfirst doc changed\n");
  expect(storage[LAST_OPENED_KEY]).toBe("db");
  // 侧栏切文档后还开着
  expect(app.shows("id:documents")).toBe(true);
});

test("the last opened document is opened again next time", async () => {
  const app = await openLibrary({ [LAST_OPENED_KEY]: "dc" });
  await app.waitFor("text:plain words only");
});

test("a new document opens empty, gets saved, and shows in the list under its first heading", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.press("id:doc-new");
  await app.waitUntil(() => !app.shows("text:first doc"), { timeout: 3000 });
  await app.type("label:正文", "# Fresh");
  const storage = await saved(app);
  expect(openedBody(storage)).toBe("# Fresh\n");
  expect(storedIds(storage).length).toBe(4);
  await app.waitFor("id:documents >> text:Fresh");
  expect(storage[bodyKey("da")]).toBe(ALPHA);
});

test("the new-document shortcut works too", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await app.keyboard.press("mod+alt+n");
  await app.waitUntil(() => !app.shows("text:first doc"), { timeout: 3000 });
  expect(storedIds(app.storage()).length).toBe(4);
});

test("renaming changes the name shown for a document without a heading", async () => {
  const app = await openLibrary();
  await showDocuments(app);
  await app.press("id:doc-more-dc");
  await app.press("id:doc-rename");
  await app.waitFor("id:rename");
  await app.type("id:rename-input", " notes");
  await app.press("id:rename-confirm");
  await app.waitFor("id:documents >> text:Gamma notes");
  expect(JSON.parse(app.storage()[metaKey("dc")] ?? "{}").name).toBe("Gamma notes");
  expect(app.storage()[bodyKey("dc")]).toBe(GAMMA);
});

test("deleting asks first; cancel keeps the document, confirming removes it with its history", async () => {
  const app = await openLibrary({ [historyKey("db")]: JSON.stringify([{ at: 5, text: "old beta" }]) });
  await showDocuments(app);
  await app.press("id:doc-more-db");
  await app.press("id:doc-delete");
  await app.waitFor("text:删除「Beta」？");
  await app.press("id:delete-cancel");
  await app.waitUntil(() => !app.shows("id:delete-confirm"), { timeout: 3000 });
  expect(app.storage()[bodyKey("db")]).toBe(BETA);
  // 那一行的操作还展开着
  await app.press("id:doc-delete");
  await app.press("id:delete-now");
  await app.waitFor("text:已删除「Beta」。");
  const storage = app.storage();
  expect(storage[bodyKey("db")]).toBeUndefined();
  expect(storage[metaKey("db")]).toBeUndefined();
  expect(storage[historyKey("db")]).toBeUndefined();
  expect(app.shows("id:documents >> text:Beta")).toBe(false);
  expect(app.shows("text:first doc")).toBe(true);
});

test("deleting the open document opens the most recently changed one left", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.press("id:doc-more-da");
  await app.press("id:doc-delete");
  await app.press("id:delete-now");
  await app.waitFor("text:second doc");
  expect(app.storage()[bodyKey("da")]).toBeUndefined();
});

test("searching all documents lists matching lines, and a result opens that document at the match", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.type("id:doc-search", "SECOND");
  await app.waitFor("id:hit-0");
  expect(app.shows("text:1 篇文档里找到")).toBe(true);
  expect(app.shows("id:hit-0 >> text:second doc")).toBe(true);
  await app.press("id:hit-0");
  await app.waitFor("id:editor >> text:second doc");
  await app.waitFor("id:find-bar");
  await app.waitFor("text:1 / 1");
});

test("a search with no match says so", async () => {
  const app = await openLibrary();
  await showDocuments(app);
  await app.type("id:doc-search", "zebra");
  await app.waitFor("text:没有找到「zebra」");
});

test("quick open finds a document by a few letters of its name and opens it", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await app.keyboard.press("mod+shift+o");
  await app.waitFor("id:quick-open");
  await app.type("id:quick-open", "gma");
  await app.waitUntil(() => !app.shows("id:quick-open >> text:Beta"), { timeout: 3000 });
  await app.keyboard.press("enter");
  await app.waitFor("text:plain words only");
});

test("the command palette lists recent documents and opens one", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("id:palette", "Beta");
  await app.waitFor("text:最近文档");
  await app.keyboard.press("enter");
  await app.waitFor("text:second doc");
});

test("restoring a version from the history replaces the text and keeps the replaced text as a version", async () => {
  const app = await openLibrary({ [historyKey("da")]: JSON.stringify([{ at: 5, text: "# Alpha\n\nolder words\n" }]) });
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.press("id:doc-more-da");
  await app.press("id:doc-history");
  await app.waitFor("id:history");
  await app.waitFor("id:history-preview >> text:# Alpha\n\nolder words\n");
  await app.press("id:history-restore");
  await app.waitFor("id:editor >> text:older words");
  const storage = await saved(app);
  expect(storage[bodyKey("da")]).toBe("# Alpha\n\nolder words\n");
  expect((JSON.parse(storage[historyKey("da")] ?? "[]") as { text: string }[]).map((s) => s.text)).toContain(ALPHA);
});

test("a document without history says how versions are kept", async () => {
  const app = await openLibrary();
  await app.waitFor("text:first doc");
  await app.keyboard.press("mod+shift+p");
  await app.type("id:palette", "版本历史");
  await app.keyboard.press("enter");
  await app.waitFor("id:history-empty");
});

test("on a narrow window the sidebar covers the text and closes after picking a document", async () => {
  const app = await openLibrary({}, { width: 375, height: 760 });
  await app.waitFor("text:first doc");
  await showDocuments(app);
  expect(app.shows("id:sidebar-scrim")).toBe(true);
  await app.press("id:doc-db");
  await app.waitFor("text:second doc");
  await app.waitUntil(() => !app.shows("id:documents"), { timeout: 3000 });
});

/** 应用读写 `shared.data`：测试改它就像另一个标签页改了存储。 */
async function openShared(extra: Record<string, string> = {}) {
  const shared = sharedStorage({ ...LIBRARY, ...extra });
  const app = await open("../App.tsx", { ...WEB, modules: shared.modules });
  await app.waitFor("text:first doc");
  return { app, data: shared.data };
}

/** 另一个标签页把 `id` 存成了 `text`（版本加一）。 */
function savedElsewhere(data: Map<string, string>, id: string, text: string) {
  const meta = JSON.parse(data.get(metaKey(id)) ?? "{}") as { version: number };
  data.set(bodyKey(id), text);
  data.set(metaKey(id), JSON.stringify({ ...meta, version: meta.version + 1 }));
}

async function typeAtEnd(app: App, text: string) {
  await app.press("text:first doc");
  await app.keyboard.press("end");
  await app.type("label:正文", text);
}

async function refocus(app: App) {
  await app.setLifecycle("background");
  await app.setLifecycle("active");
}

const historyOf = (data: Map<string, string>, id: string) => (JSON.parse(data.get(historyKey(id)) ?? "[]") as { text: string }[]).map((s) => s.text);

test("when the storage is full, picking another document keeps this one open and says why", async () => {
  /** 存储上限（实测：键和值的字符数合计 5 MiB），留 3 个字的空 */
  const used = Object.entries(LIBRARY).reduce((n, [k, v]) => n + k.length + v.length, 0);
  const app = await openLibrary({ filler: "x".repeat(5 * 1024 * 1024 - used - "filler".length - 3) });
  await app.waitFor("text:first doc");
  await typeAtEnd(app, " more words");
  await showDocuments(app);
  await app.press("id:doc-db");
  await app.waitFor("text:本机存储已满，这篇最近的修改没存上，先不切换。删掉不用的文档腾出空间后再试。");
  expect(app.shows("text:first doc more words")).toBe(true);
  expect(app.shows("text:second doc")).toBe(false);
  expect(app.storage()[bodyKey("da")]).toBe(ALPHA);
});

test("coming back after another tab saved this document loads its text when nothing changed here", async () => {
  const { app, data } = await openShared();
  savedElsewhere(data, "da", "# Alpha\n\nfrom the other tab\n");
  await refocus(app);
  await app.waitFor("text:from the other tab");
  await app.waitFor("text:这篇在另一个标签页里改过，已载入最新的内容。");
});

test("a conflict shows a bar; keeping mine saves mine and puts theirs in the history", async () => {
  const { app, data } = await openShared();
  await typeAtEnd(app, " mine");
  savedElsewhere(data, "da", "# Alpha\n\ntheirs\n");
  await refocus(app);
  await app.waitFor("id:conflict");
  await app.press("id:keep-mine");
  await app.waitUntil(() => !app.shows("id:conflict"), { timeout: 3000 });
  await app.waitUntil(() => data.get(bodyKey("da")) === "# Alpha\n\nfirst doc mine\n", { timeout: 3000 });
  expect(historyOf(data, "da")).toContain("# Alpha\n\ntheirs\n");
});

test("a conflict where I take theirs loads their text and keeps mine in the history", async () => {
  const { app, data } = await openShared();
  await typeAtEnd(app, " mine");
  savedElsewhere(data, "da", "# Alpha\n\ntheirs\n");
  await refocus(app);
  await app.waitFor("id:conflict");
  await app.press("id:take-theirs");
  await app.waitFor("id:editor >> text:theirs");
  expect(app.shows("id:conflict")).toBe(false);
  expect(historyOf(data, "da")).toContain("# Alpha\n\nfirst doc mine\n");
});

test("a document deleted in another tab while edited here can be kept as a new document", async () => {
  const { app, data } = await openShared();
  await typeAtEnd(app, " precious");
  data.delete(bodyKey("da"));
  data.delete(metaKey("da"));
  await refocus(app);
  await app.waitFor("text:这篇已经在另一个标签页里删除了。这里的内容还在：存成一篇新文档留下它，或者放弃。");
  await app.press("id:save-as-new");
  await app.waitUntil(() => !app.shows("id:conflict"), { timeout: 3000 });
  await app.waitFor("text:first doc precious");
  const id = data.get(LAST_OPENED_KEY) ?? "";
  expect(id).not.toBe("da");
  expect(data.get(bodyKey(id))).toBe("# Alpha\n\nfirst doc precious\n");
  expect(data.has(bodyKey("da"))).toBe(false);
  // 沿用原来的名字（回到窗口时列表已经重读过、里面没有它了）
  expect((JSON.parse(data.get(metaKey(id)) ?? "{}") as { name?: string }).name).toBe("Alpha");
});

test("a document deleted in another tab can be given up, which opens another one", async () => {
  const { app, data } = await openShared();
  data.delete(bodyKey("da"));
  data.delete(metaKey("da"));
  await refocus(app);
  await app.waitFor("id:abandon-deleted");
  await app.press("id:abandon-deleted");
  await app.waitFor("text:second doc");
  expect(data.has(bodyKey("da"))).toBe(false);
});

test("picking a document deleted in another tab says it is gone and stays on this one", async () => {
  const { app, data } = await openShared();
  await showDocuments(app);
  data.delete(bodyKey("db"));
  data.delete(metaKey("db"));
  await app.press("id:doc-db");
  await app.waitFor("text:这篇文档已经不在了（可能在别的标签页里删掉了）。");
  expect(app.shows("text:first doc")).toBe(true);
  expect(app.shows("id:doc-db")).toBe(false);
});

test("deleting the only document leaves a new empty one open", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { ...seedLibrary([{ id: "da", name: "Alpha", text: ALPHA }]), [LAST_OPENED_KEY]: "da" } });
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.press("id:doc-more-da");
  await app.press("id:doc-delete");
  await app.press("id:delete-now");
  await app.waitUntil(() => !app.shows("text:first doc"), { timeout: 3000 });
  const storage = app.storage();
  expect(storedIds(storage).length).toBe(1);
  expect(openedBody(storage)).toBe("");
});

test("a search hit that only exists in the Markdown source opens the source view at the match", async () => {
  const app = await openLibrary({ ...seedLibrary([{ id: "db", name: "Beta", text: "# Beta\n\nsome **bold needle** here\n", updatedAt: 2 }]) });
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.type("id:doc-search", "**bold");
  await app.waitFor("id:hit-0");
  await app.press("id:hit-0");
  await app.waitFor("id:source-editor");
  await app.waitFor("text:1 / 1");
});

test("renaming to a name another document has says so in the dialog and keeps the old name", async () => {
  const app = await openLibrary();
  await showDocuments(app);
  await app.press("id:doc-more-dc");
  await app.press("id:doc-rename");
  await app.waitFor("id:rename");
  for (let i = 0; i < "Gamma".length; i++) await app.keyboard.press("backspace");
  await app.type("id:rename-input", "Alpha");
  await app.press("id:rename-confirm");
  await app.waitFor("text:没能改名：已经有一篇叫「Alpha」的文档了，换一个名字");
  expect(JSON.parse(app.storage()[metaKey("dc")] ?? "{}").name).toBe("Gamma");
});

test("on a narrow window Escape closes the sidebar that covers the text", async () => {
  const app = await openLibrary({}, { width: 375, height: 760 });
  await app.waitFor("text:first doc");
  // 焦点先在正文里：侧栏盖上来以后 Esc 也要能收起它
  await app.press("text:first doc");
  await showDocuments(app);
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:documents"), { timeout: 3000 });
});

test("text typed just before the page closed is saved on the next start", async () => {
  const stash = JSON.stringify({ id: "da", base: 1, text: "# Alpha\n\nfirst doc typed late\n" });
  const app = await openLibrary({ "md.unsaved.da": stash });
  await app.waitFor("text:first doc typed late");
  await app.waitFor("text:上次关闭前还没存上的修改已经补存好了。");
  const storage = app.storage();
  expect(storage[bodyKey("da")]).toBe("# Alpha\n\nfirst doc typed late\n");
  expect(storage["md.unsaved.da"]).toBeUndefined();
});

test("text typed just before closing, on a version that changed since, goes into the history", async () => {
  const stash = JSON.stringify({ id: "da", base: 0, text: "# Alpha\n\nold edit\n" });
  const app = await openLibrary({ "md.unsaved.da": stash });
  await app.waitFor("text:first doc");
  await app.waitFor("text:上次关闭前有一段修改没存上，而这篇后来在别处改过：那段修改存进了这篇的版本历史（「⋯」→「版本历史」）。");
  const storage = app.storage();
  expect(storage[bodyKey("da")]).toBe(ALPHA);
  expect((JSON.parse(storage[historyKey("da")] ?? "[]") as { text: string }[]).map((s) => s.text)).toContain("# Alpha\n\nold edit\n");
});
