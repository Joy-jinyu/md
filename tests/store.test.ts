import { Storage } from "nsh";
import { expect, test } from "nsh/test";
import { documentStore } from "../src/store/backend";
import { checkExternal, closeDocument, flush, keepMine, latestDocument, markChanged, openDocument, saveState, stashUnsaved, takeTheirs } from "../src/store/document";
import { addSnapshot, historyKey, MAX_SNAPSHOTS, noteSaved, SNAPSHOT_INTERVAL, snapshotsOf } from "../src/store/history";
import { type Kv, LEGACY_DOC_KEY } from "../src/store/kv";
import { bodyKey, CHANGED_KEY, changedDocs, createLocalStore, FIRST_DOC_ID, metaKey } from "../src/store/local-store";
import { recoverUnsaved } from "../src/store/unsaved";

/** 存储上限（实测：键和值的字符数合计 5 MiB）。 */
const QUOTA = 5 * 1024 * 1024;

const textOf = async (id: string) => (await documentStore.read(id))?.text;

test("several documents are kept apart and listed with their titles", async () => {
  await Storage.clear();
  const a = await documentStore.create("a", "# Alpha\n\none\n");
  const b = await documentStore.create("b", "two\n");
  const listed = (await documentStore.list()).map((d) => `${d.name}:${d.title}`).sort();
  expect(listed).toEqual(["a:Alpha", "b:"]);
  expect(await textOf(a.id)).toBe("# Alpha\n\none\n");
  expect(await textOf(b.id)).toBe("two\n");
});

test("saving, creating, renaming and deleting each tell other tabs which document changed; other keys tell them nothing", async () => {
  await Storage.clear();
  const told = async () => changedDocs(CHANGED_KEY, await Storage.getItem(CHANGED_KEY));
  const a = await documentStore.create("a", "one\n");
  expect(await told()).toEqual({ ids: [a.id], all: false });
  const b = await documentStore.create("b", "two\n");
  expect(await told()).toEqual({ ids: [b.id], all: false });
  await documentStore.write(a.id, "one more\n", a.version);
  expect(await told()).toEqual({ ids: [a.id], all: false });
  await documentStore.rename(b.id, "bee");
  expect(await told()).toEqual({ ids: [b.id], all: false });
  await documentStore.remove(a.id);
  expect(await told()).toEqual({ ids: [a.id], all: false });
  expect(changedDocs(metaKey(b.id), "{}")).toBe(null);
  expect(changedDocs(bodyKey(b.id), "two\n")).toBe(null);
  expect(changedDocs(null, null)).toEqual({ ids: [], all: true });
});

test("the old single document becomes the first one in place, however many times the app starts", async () => {
  await Storage.clear();
  await Storage.setItem(LEGACY_DOC_KEY, "# Old\n\nkept\n");
  for (let i = 0; i < 3; i++) expect((await documentStore.list()).map((d) => d.title)).toEqual(["Old"]);
  const first = await documentStore.read(FIRST_DOC_ID);
  expect(first?.text).toBe("# Old\n\nkept\n");
  expect((await documentStore.write(FIRST_DOC_ID, "# Old\n\nkept\nmore\n", first?.version ?? -1)).ok).toBe(true);
  expect((await documentStore.list()).map((d) => d.title)).toEqual(["Old"]);
  expect(await Storage.getItem(LEGACY_DOC_KEY)).toBe("# Old\n\nkept\nmore\n");
});

test("a write based on an old version does not overwrite", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "one\n");
  expect((await documentStore.write(doc.id, "two\n", doc.version)).ok).toBe(true);
  expect(await documentStore.write(doc.id, "stale\n", doc.version)).toEqual({ ok: false, version: Number(doc.version) + 1 });
  expect(await textOf(doc.id)).toBe("two\n");
});

test("an edit made after another tab saved is a conflict; keeping mine saves mine and puts theirs in the history", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  await documentStore.write(doc.id, "theirs\n", doc.version);
  markChanged(() => "mine\n");
  expect((await flush()).ok).toBe(false);
  expect(await textOf(doc.id)).toBe("theirs\n");
  expect((await keepMine()).ok).toBe(true);
  expect(await textOf(doc.id)).toBe("mine\n");
  expect((await snapshotsOf(doc.id)).map((s) => s.text)).toContain("theirs\n");
});

test("taking theirs keeps my unsaved text in the history", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  await documentStore.write(doc.id, "theirs\n", doc.version);
  markChanged(() => "mine\n");
  await flush();
  await takeTheirs();
  expect(await openDocument(doc.id)).toBe("theirs\n");
  expect((await snapshotsOf(doc.id)).map((s) => s.text)).toContain("mine\n");
});

test("coming back after another tab saved reloads when nothing changed here, and asks when something did", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  expect(await checkExternal()).toBe("same");
  await documentStore.write(doc.id, "theirs\n", doc.version);
  expect(await checkExternal()).toBe("reload");
  await openDocument(doc.id);
  await documentStore.write(doc.id, "theirs again\n", Number(doc.version) + 1);
  markChanged(() => "mine\n");
  expect(await checkExternal()).toBe("conflict");
  expect(await textOf(doc.id)).toBe("theirs again\n");
});

test("once a document is closed, late changes from its old editor are not written anywhere", async () => {
  await Storage.clear();
  const a = await documentStore.create("a", "a\n");
  const b = await documentStore.create("b", "b\n");
  await openDocument(a.id);
  markChanged(() => "a edited\n");
  expect((await closeDocument()).ok).toBe(true);
  markChanged(() => "late edit from the old editor\n");
  await flush();
  await openDocument(b.id);
  markChanged(() => "b edited\n");
  await flush();
  expect(await textOf(a.id)).toBe("a edited\n");
  expect(await textOf(b.id)).toBe("b edited\n");
});

test("when the storage is full, the oldest snapshots make room and the text is saved", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await addSnapshot(doc.id, "o".repeat(1_000_000), 1);
  await addSnapshot(doc.id, "n".repeat(1_000_000), 2);
  let used = 0;
  for (const key of await Storage.keys()) used += key.length + ((await Storage.getItem(key)) ?? "").length;
  // 只剩约 50 万字的空间，要写的正文有 80 万字：不删快照写不下
  await Storage.setItem("filler", "x".repeat(QUOTA - used - "filler".length - 500_000));
  await openDocument(doc.id);
  const big = `# Big\n\n${"b".repeat(800_000)}\n`;
  markChanged(() => big);
  expect((await flush()).ok).toBe(true);
  expect(await textOf(doc.id)).toBe(big);
  // 最旧的那份让位了，较新的还在
  const left = (await snapshotsOf(doc.id)).map((s) => s.text[0]);
  expect(left).not.toContain("o");
  expect(left).toContain("n");
});

test("snapshots keep the version a save replaced: on the first save, then every 5 minutes or after a big change, at most a fixed number", async () => {
  await Storage.clear();
  const id = "d-history";
  const t0 = 1_000_000;
  await noteSaved(id, "v0", "v1", t0);
  await noteSaved(id, "v1", "v2", t0 + 1000);
  expect((await snapshotsOf(id)).map((s) => s.text)).toEqual(["v0"]);
  await noteSaved(id, "v2", "v3", t0 + SNAPSHOT_INTERVAL);
  await noteSaved(id, "v3", "x".repeat(3000), t0 + SNAPSHOT_INTERVAL + 1000);
  expect((await snapshotsOf(id)).map((s) => s.text)).toEqual(["v3", "v2", "v0"]);
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) await noteSaved(id, `w${i}`, `w${i + 1}`, t0 + (i + 2) * SNAPSHOT_INTERVAL);
  const kept = await snapshotsOf(id);
  expect(kept.length).toBe(MAX_SNAPSHOTS);
  expect(kept[0].text).toBe(`w${MAX_SNAPSHOTS + 4}`);
});

/** 只在内存里的键值库，当成 IndexedDB（能存二进制）。 */
function memoryKv(seed: Record<string, unknown> = {}): Kv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(seed));
  return {
    data,
    binary: true,
    get: async (key) => data.get(key) ?? null,
    keys: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
    async update(reads, decide) {
      const change = decide(reads.map((k) => data.get(k) ?? null));
      for (const [k, v] of Object.entries(change.puts ?? {})) data.set(k, v);
      for (const k of change.deletes ?? []) data.delete(k);
      return change.result;
    },
  };
}

async function fillStorage(leave: number) {
  let used = 0;
  for (const key of await Storage.keys()) used += key.length + ((await Storage.getItem(key)) ?? "").length;
  await Storage.setItem("filler", "x".repeat(QUOTA - used - "filler".length - leave));
}

test("a document deleted elsewhere while edited here asks what to do instead of retrying forever, and keeps the text", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  await documentStore.remove(doc.id);
  expect(await checkExternal()).toBe("conflict");
  expect(saveState()).toEqual({ kind: "conflict", deleted: true });
  markChanged(() => "mine precious\n");
  const flushed = await flush();
  expect(flushed.ok ? null : flushed.error.deleted).toBe(true);
  const kept = await keepMine();
  expect(kept.ok ? null : kept.error.deleted).toBe(true);
  expect((await takeTheirs()).ok).toBe(false);
  expect(latestDocument()).toBe("mine precious\n");
  expect(await documentStore.list()).toEqual([]);
});

test("a save that finds the document deleted elsewhere turns into the deleted choice", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  markChanged(() => "typed\n");
  await documentStore.remove(doc.id);
  await flush();
  expect(saveState()).toEqual({ kind: "conflict", deleted: true });
});

test("keeping mine writes mine even when it is what was loaded before the other tab saved", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  await documentStore.write(doc.id, "theirs\n", doc.version);
  markChanged(() => "start\n");
  expect(await checkExternal()).toBe("conflict");
  expect((await keepMine()).ok).toBe(true);
  expect(await textOf(doc.id)).toBe("start\n");
  expect(saveState().kind).toBe("saved");
});

test("when the history is full, neither choice drops the side it gives up", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  await documentStore.write(doc.id, "theirs\n", doc.version);
  const mine = "m".repeat(5000);
  markChanged(() => mine);
  await fillStorage(10);
  expect((await flush()).ok).toBe(false);
  const took = await takeTheirs();
  expect(took.ok ? null : took.error.quota).toBe(true);
  expect(latestDocument()).toBe(mine);
  const kept = await keepMine();
  expect(kept.ok).toBe(false);
  expect(await textOf(doc.id)).toBe("theirs\n");
  expect(saveState().kind).toBe("conflict");
});

test("renaming a document deleted elsewhere fails instead of bringing back an empty one", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await documentStore.remove(doc.id);
  let failed = false;
  await documentStore.rename(doc.id, "ghost").catch(() => (failed = true));
  expect(failed).toBe(true);
  expect(await documentStore.list()).toEqual([]);
});

test("a write that runs out of room leaves both the text and its version as they were", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await fillStorage(12);
  let failed = false;
  await documentStore.write(doc.id, `start\n${"y".repeat(40)}`, doc.version).catch(() => (failed = true));
  expect(failed).toBe(true);
  expect(await documentStore.read(doc.id)).toEqual({ text: "start\n", version: doc.version });
});

test("documents left in Storage while IndexedDB was unavailable all move over, with their history", async () => {
  await Storage.clear();
  await Storage.setItem(LEGACY_DOC_KEY, "# Legacy\n");
  await Storage.setItem(metaKey("dx1"), JSON.stringify({ name: "One", title: "", updatedAt: 5, version: 2, size: 4 }));
  await Storage.setItem(bodyKey("dx1"), "one\n");
  await Storage.setItem(historyKey("dx1"), JSON.stringify([{ at: 1, text: "older one\n" }]));
  await Storage.setItem(metaKey("dx2"), JSON.stringify({ name: "Two", title: "", updatedAt: 6, version: 1, size: 4 }));
  await Storage.setItem(bodyKey("dx2"), "two\n");
  await Storage.setItem("md.settings", "{}");
  const kv = memoryKv();
  const store = createLocalStore(async () => kv);
  expect((await store.list()).map((d) => d.id).sort()).toEqual(["document", "dx1", "dx2"]);
  expect((await store.read("dx1"))?.text).toBe("one\n");
  expect(kv.data.get(historyKey("dx1"))).toBe(JSON.stringify([{ at: 1, text: "older one\n" }]));
  expect((await Storage.keys()).sort()).toEqual(["md.settings"]);
});

test("unsaved text stashed when the page goes away is put back on the next start", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  markChanged(() => "typed just before closing\n");
  // 页面这时关了：自动保存来不及跑，下次启动由 recoverUnsaved 接手
  stashUnsaved();
  const note = await recoverUnsaved();
  expect(note?.tone).toBe("info");
  expect(await textOf(doc.id)).toBe("typed just before closing\n");
  expect((await Storage.keys()).some((k) => k.startsWith("md.unsaved."))).toBe(false);
});

test("stashed text whose document changed elsewhere meanwhile goes into its history, not over the newer text", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  markChanged(() => "typed here\n");
  // 页面这时关了：自动保存来不及跑，下次启动由 recoverUnsaved 接手
  stashUnsaved();
  await documentStore.write(doc.id, "saved in another tab\n", doc.version);
  const note = await recoverUnsaved();
  expect(note?.tone).toBe("warn");
  expect(await textOf(doc.id)).toBe("saved in another tab\n");
  expect((await snapshotsOf(doc.id)).map((s) => s.text)).toContain("typed here\n");
});

test("stashed text whose document was deleted comes back as a new document", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  markChanged(() => "# Orphan\n\nkeep me\n");
  // 页面这时关了：自动保存来不及跑，下次启动由 recoverUnsaved 接手
  stashUnsaved();
  await documentStore.remove(doc.id);
  await recoverUnsaved();
  const listed = await documentStore.list();
  expect(listed.map((d) => d.title)).toEqual(["Orphan"]);
  expect(await textOf(listed[0].id)).toBe("# Orphan\n\nkeep me\n");
});

test("once the text is saved normally, nothing is left to put back", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "start\n");
  await openDocument(doc.id);
  markChanged(() => "typed\n");
  stashUnsaved();
  expect((await flush()).ok).toBe(true);
  expect(await recoverUnsaved()).toBe(null);
  expect((await Storage.keys()).some((k) => k.startsWith("md.unsaved."))).toBe(false);
});
