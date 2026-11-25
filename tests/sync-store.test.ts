import { Storage } from "nsh";
import { expect, test } from "nsh/test";
import { chooseBackend, copyBrowserDocsToLibrary, documentStore } from "../src/store/backend";
import { latestDocument, markChanged, openDocument, replaceDocument, STALE } from "../src/store/document";
import { addSnapshot, setHistoryScope, snapshotsOf } from "../src/store/history";
import { createLocalStore } from "../src/store/local-store";
import { moveSyncRecord, putSyncRecord, syncRecordKey, syncRecordOf, syncRecords } from "../src/store/sync-store";
import { fakeGateway } from "./fixtures/fake-gateway";

/** 同步记录在存储层的规矩：按后端分开、跟着改名和搬家走；同步拉取换开着那篇时的最后一道比对。 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const linkTo = (gistId: string) => ({ link: { gistId, fileName: `${gistId}.md`, base: "x", version: "v1", login: "joy", syncedAt: 1 } });
const gistOf = async (id: string) => (await syncRecordOf(id))?.link?.gistId;

test("a sync pull that finds the open document typed in since it was checked replaces nothing and keeps the typing", async () => {
  await Storage.clear();
  const doc = await documentStore.create("n", "checked\n");
  await openDocument(doc.id);
  markChanged(() => "checked\ntyped meanwhile\n");
  expect(await replaceDocument("from GitHub\n", { id: doc.id, text: "checked\n" })).toBe(STALE);
  expect(latestDocument()).toBe("checked\ntyped meanwhile\n");
  expect((await documentStore.read(doc.id))?.text).toBe("checked\n");
  // 另开了一篇：也不换
  const other = await documentStore.create("m", "other\n");
  await openDocument(other.id);
  expect(await replaceDocument("from GitHub\n", { id: doc.id, text: "other\n" })).toBe(STALE);
  expect((await documentStore.read(other.id))?.text).toBe("other\n");
  // 没变过才换
  expect((await replaceDocument("from GitHub\n", { id: other.id, text: "other\n" })).ok).toBe(true);
  expect((await documentStore.read(other.id))?.text).toBe("from GitHub\n");
});

test("moving a record replaces whatever stale record sat on the new name (it belonged to a document no longer there)", async () => {
  await Storage.clear();
  await putSyncRecord("a.md", linkTo("g1"));
  await putSyncRecord("b.md", linkTo("g-stale"));
  await moveSyncRecord("a.md", "b.md");
  expect([await gistOf("a.md"), await gistOf("b.md")]).toEqual([undefined, "g1"]);
  await moveSyncRecord("nothing-here", "b.md");
  expect(await gistOf("b.md")).toBe("g1");
});

test("in a gateway library, records are its own; they follow the browser's documents copied in (the browser copy stops syncing, its history is copied) and files renamed elsewhere", async () => {
  await Storage.clear();
  const local = createLocalStore();
  const browserDoc = await local.create("Plan", "# Plan\n\nlocal\n");
  await putSyncRecord(browserDoc.id, linkTo("g-plan"));
  await addSnapshot(browserDoc.id, "# Plan\n\nolder\n");
  const gw = fakeGateway({ "a.md": "# A\n" });
  await putSyncRecord("a.md", linkTo("g-browser-a"));
  await chooseBackend(null, true, gw.connect);
  // 浏览器本地的那条 a.md 不算这个文库的
  expect([...(await syncRecords()).keys()]).toEqual([]);
  await putSyncRecord("a.md", linkTo("g-a"));
  expect(await Storage.keys()).toContain(syncRecordKey("a.md", "gateway:Notes"));
  const report = await copyBrowserDocsToLibrary();
  expect(report.copied).toEqual(["Plan"]);
  expect(await gistOf("Plan.md")).toBe("g-plan");
  expect((await snapshotsOf("Plan.md")).map((s) => s.text)).toEqual(["# Plan\n\nolder\n"]);
  // 浏览器里那篇还在：历史还在，记成「不同步」，以后不会悄悄另建一个 Gist
  expect(JSON.parse((await Storage.getItem(syncRecordKey(browserDoc.id, "local"))) ?? "null")).toEqual({ excluded: true });
  setHistoryScope("local");
  expect((await snapshotsOf(browserDoc.id)).map((s) => s.text)).toEqual(["# Plan\n\nolder\n"]);
  setHistoryScope("gateway:Notes");
  // 再复制一次：内容一样算已经在了，文库那篇的连接不动
  expect((await copyBrowserDocsToLibrary()).same).toEqual(["Plan"]);
  expect(await gistOf("Plan.md")).toBe("g-plan");
  await documentStore.list();
  await documentStore.read("a.md");
  await addSnapshot("a.md", "# A older\n");
  await addSnapshot("renamed.md", "left by a deleted renamed.md\n");
  gw.renameElsewhere("a.md", "renamed.md");
  await sleep(50);
  expect([await gistOf("a.md"), await gistOf("renamed.md")]).toEqual([undefined, "g-a"]);
  // 版本历史也跟过去，盖掉新名字上删掉的那篇留下的
  expect((await snapshotsOf("renamed.md")).map((s) => s.text)).toEqual(["# A older\n"]);
  expect(await snapshotsOf("a.md")).toEqual([]);
  expect([...(await syncRecords()).keys()].sort()).toEqual(["Plan.md", "renamed.md"]);
  expect(await Storage.getItem(syncRecordKey("a.md", "local"))).not.toBe(null);
});
