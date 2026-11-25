import { Storage } from "nsh";
import { expect, test } from "nsh/test";
import { followStoreChanges } from "../src/features/library/external";
import { beginSwitch, chooseBackend, documentStore, gatewayRefusal, missedGatewayLibrary, pinBackend, storageKind, useGateway } from "../src/store/backend";
import { flush, markChanged, openDocument, saveState } from "../src/store/document";
import { addSnapshot, historyKey, setHistoryScope, snapshotsOf } from "../src/store/history";
import { openGateway } from "../src/store/gateway-store";
import { createDocument, LAST_OPENED_KEY, markOpened, renameDocument, startLibrary } from "../src/store/library";
import { recoverUnsaved, stashesElsewhere, writeStash } from "../src/store/unsaved";
import { fakeGateway } from "./fixtures/fake-gateway";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("等不到");
    await sleep(50);
  }
}

const stashKeys = async () => (await Storage.keys()).filter((k) => k.startsWith("md.unsaved."));

// 这几条按顺序跑：先是没用上网关的两种，再换到假网关上
test("when the gateway refuses this page, the browser storage is used and the reason is kept for the settings", async () => {
  await Storage.clear();
  const gw = fakeGateway({});
  gw.state.closeOnHello = 4003;
  await chooseBackend(null, true, gw.connect);
  expect(storageKind().kind).toBe("local");
  expect(gatewayRefusal()).toContain("--origin");
});

test("when the gateway used last time is not there, the browser storage is used, it is pointed out, and the last opened document is kept", async () => {
  await Storage.clear();
  await Storage.setItem("md.lastBackend", "gateway:Notes");
  await Storage.setItem(LAST_OPENED_KEY, "notes/a.md");
  const gw = fakeGateway({});
  gw.state.up = false;
  await chooseBackend(null, true, gw.connect);
  expect(missedGatewayLibrary()).toBe("Notes");
  markOpened((await createDocument("")).id);
  await sleep(20);
  expect(await Storage.getItem(LAST_OPENED_KEY)).toBe("notes/a.md");
  expect(await Storage.getItem("md.lastBackend")).toBe("gateway:Notes");
});

test("names count as taken when they become the same file name, whatever the letter case", async () => {
  const alpha = await createDocument("", "Alpha");
  const other = await createDocument("", "Other");
  await expect(renameDocument(other.id, "alpha")).rejects.toThrow("已经有一篇");
  expect((await renameDocument(other.id, "Al:pha")).name).toBe("Al:pha");
  expect((await renameDocument(alpha.id, "ALPHA")).name).toBe("ALPHA");
});

test("version history is kept apart per storage, and the browser's own keys stay as they were", async () => {
  expect(historyKey("da", "local")).toBe("md.history.da");
  setHistoryScope("gateway:A");
  await addSnapshot("a.md", "from library A\n");
  setHistoryScope("gateway:B");
  expect(await snapshotsOf("a.md")).toEqual([]);
  setHistoryScope("gateway:A");
  expect((await snapshotsOf("a.md")).map((s) => s.text)).toEqual(["from library A\n"]);
  setHistoryScope("local");
});

const gw = fakeGateway({ "a.md": "one\n" });
let reloads = 0;

test("text that could not be saved while the gateway was gone is kept in the stash and saved once it is back", async () => {
  await Storage.clear();
  await chooseBackend(null, true, gw.connect);
  expect(storageKind().kind).toBe("gateway");
  followStoreChanges(() => (reloads += 1));
  await openDocument("a.md");
  markOpened("a.md");
  gw.state.up = false;
  gw.drop();
  markChanged(() => "two\n");
  expect((await flush()).ok).toBe(false);
  await sleep(20);
  expect(await stashKeys()).toEqual(["md.unsaved.[gateway:Notes]a.md"]);
  gw.state.up = true;
  await until(() => saveState().kind === "saved");
  expect(gw.docs.get("a.md")).toBe("two\n");
  await sleep(20);
  expect(await stashKeys()).toEqual([]);
});

test("a save that reached the gateway just before the connection dropped is not taken for a conflict", async () => {
  gw.state.dropAfter = "write";
  markChanged(() => "three\n");
  expect((await flush()).ok).toBe(false);
  await until(() => saveState().kind === "saved");
  expect(gw.docs.get("a.md")).toBe("three\n");
  expect(reloads).toBe(0);
});

test("renaming is refused while the open document has text that cannot be saved", async () => {
  gw.state.up = false;
  gw.drop();
  markChanged(() => "four\n");
  await expect(renameDocument("a.md", "renamed")).rejects.toThrow("还有修改没存上");
  gw.state.up = true;
  await until(() => saveState().kind === "saved");
  expect([...gw.docs.keys()]).toEqual(["a.md"]);
});

test("when another tab renames the open document, edits here follow it to the new name", async () => {
  gw.renameElsewhere("a.md", "b.md");
  await sleep(50);
  markChanged(() => "five\n");
  expect((await flush()).ok).toBe(true);
  expect(Object.fromEntries(gw.docs)).toEqual({ "b.md": "five\n" });
  expect(saveState().kind).toBe("saved");
});

/** 连上这个假网关（连不上就让测试失败）。 */
async function connectTo(gw: ReturnType<typeof fakeGateway>) {
  const backend = await openGateway(600, gw.connect);
  if (!backend) throw new Error("假网关没连上");
  return backend;
}

test("unsaved text for the same path in two gateway libraries is kept apart, and each goes back to its own library", async () => {
  await Storage.clear();
  const gwA = fakeGateway({ "n.md": "a0\n" });
  gwA.state.library = "A";
  const gwB = fakeGateway({ "n.md": "b0\n" });
  gwB.state.library = "B";
  await useGateway(await connectTo(gwA));
  writeStash({ id: "n.md", base: (await documentStore.read("n.md"))?.version ?? "", text: "a1\n" });
  await useGateway(await connectTo(gwB));
  writeStash({ id: "n.md", base: (await documentStore.read("n.md"))?.version ?? "", text: "b1\n" });
  await sleep(20);
  await recoverUnsaved();
  expect(gwB.docs.get("n.md")).toBe("b1\n");
  expect(stashesElsewhere()).toEqual(["gateway:A"]);
  await useGateway(await connectTo(gwA));
  await recoverUnsaved();
  expect(gwA.docs.get("n.md")).toBe("a1\n");
  expect(stashesElsewhere()).toEqual([]);
});

test("each storage remembers its own last opened document", async () => {
  await Storage.clear();
  const gwA = fakeGateway({ "x.md": "x\n", "y.md": "y\n" });
  gwA.state.library = "A";
  const gwB = fakeGateway({ "x.md": "x\n", "y.md": "y\n" });
  gwB.state.library = "B";
  await useGateway(await connectTo(gwA));
  markOpened("y.md");
  await useGateway(await connectTo(gwB));
  markOpened("x.md");
  await sleep(20);
  await useGateway(await connectTo(gwA));
  expect(await startLibrary()).toBe("y.md");
});

test("while a sync holds the storage it is not switched, and a switch in progress holds off a sync", () => {
  const unpin = pinBackend();
  expect(unpin).not.toBe(null);
  expect(beginSwitch()).toBe(null);
  unpin?.();
  const done = beginSwitch();
  expect(done).not.toBe(null);
  expect(pinBackend()).toBe(null);
  done?.();
  const again = pinBackend();
  expect(again).not.toBe(null);
  again?.();
});
