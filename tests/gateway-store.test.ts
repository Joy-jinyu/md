import { Storage } from "nsh";
import { expect, test } from "nsh/test";
import { copyLocalDocs, documentStore } from "../src/store/backend";
import type { StoreChange } from "../src/store/document-store";
import { type Connect, openGateway, type Socket } from "../src/store/gateway-store";
import { fakeGateway } from "./fixtures/fake-gateway";
import { RED_PNG as PNG } from "./fixtures/images";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connected(seed: Record<string, string>, timeoutMs = 600, requestMs?: number) {
  const gw = fakeGateway(seed);
  const backend = await openGateway(timeoutMs, gw.connect, requestMs);
  if (!backend) throw new Error("没连上假网关");
  return { gw, backend, store: backend.store };
}

test("a document is read and saved through the gateway, and an edit made elsewhere is not overwritten", async () => {
  const { gw, store, backend } = await connected({ "notes/a.md": "# A\n" });
  expect(backend.library()).toBe("Notes");
  expect((await store.list()).map((d) => [d.id, d.name])).toEqual([["notes/a.md", "a"]]);
  const read = await store.read("notes/a.md");
  expect(read?.text).toBe("# A\n");
  const saved = await store.write("notes/a.md", "# A\n\nmore\n", read?.version ?? "");
  expect(saved.ok).toBe(true);
  expect(gw.docs.get("notes/a.md")).toBe("# A\n\nmore\n");
  gw.edit("notes/a.md", "changed elsewhere\n");
  const stale = await store.write("notes/a.md", "mine\n", saved.ok ? saved.meta.version : "");
  expect(stale.ok).toBe(false);
  expect(gw.docs.get("notes/a.md")).toBe("changed elsewhere\n");
  expect(await store.read("gone.md")).toBe(null);
});

test("new and renamed documents get clean file names and never replace an existing file", async () => {
  const { gw, store } = await connected({ "Plan.md": "keep\n" });
  const made = await store.create("a/b: c?", "x\n");
  expect(made.id).toBe("a b c.md");
  await expect(store.create("Plan", "other\n")).rejects.toThrow("Plan.md");
  expect(gw.docs.get("Plan.md")).toBe("keep\n");
  await expect(store.rename(made.id, "Plan")).rejects.toThrow("Plan.md");
  const renamed = await store.rename(made.id, "Trip");
  expect(renamed.id).toBe("Trip.md");
  expect([...gw.docs.keys()].sort()).toEqual(["Plan.md", "Trip.md"]);
});

test("the list carries the start of each file for the card excerpt, and an older gateway without it still lists", async () => {
  const { store } = await connected({ "ok.md": "# Fine\n\nbody\n", "old.md": "older\n", "bad.md": "" });
  expect((await store.list()).map((d) => [d.id, d.head ?? null])).toEqual([
    ["ok.md", "# Fine\n\nbody\n"],
    ["old.md", null],
    ["bad.md", null],
  ]);
});

test("files the gateway cannot hand over are listed with the reason", async () => {
  const { store } = await connected({ "bad.md": "", "ok.md": "fine\n" });
  expect((await store.list()).map((d) => [d.id, d.problem ?? null])).toEqual([
    ["bad.md", "not-utf8"],
    ["ok.md", null],
  ]);
});

test("changes the gateway pushes reach the watcher, but the echo of our own save does not", async () => {
  const { gw, store } = await connected({ "a.md": "one\n" });
  const heard: StoreChange[] = [];
  store.watch?.((c) => heard.push(c));
  const read = await store.read("a.md");
  await store.write("a.md", "two\n", read?.version ?? "");
  gw.echo("a.md");
  await sleep(20);
  expect(heard).toEqual([]);
  gw.edit("a.md", "three\n");
  await sleep(20);
  expect(heard).toEqual([{ ids: ["a.md"], all: false }]);
});

test("while the gateway is gone saving fails with a clear reason; once it is back the watcher is told to check everything", async () => {
  const { gw, store, backend } = await connected({ "a.md": "one\n" });
  const heard: StoreChange[] = [];
  store.watch?.((c) => heard.push(c));
  const read = await store.read("a.md");
  gw.state.up = false;
  gw.drop();
  expect(backend.link().state).toBe("reconnecting");
  await expect(store.write("a.md", "two\n", read?.version ?? "")).rejects.toThrow("Lost the connection to the local gateway");
  gw.state.up = true;
  await sleep(1300);
  expect(backend.link().state).toBe("connected");
  expect(heard).toEqual([{ ids: [], all: true }]);
  expect((await store.write("a.md", "two\n", read?.version ?? "")).ok).toBe(true);
});

test("without a gateway the probe gives up at once and the browser storage stays in use", async () => {
  const gw = fakeGateway({});
  gw.state.up = false;
  const started = Date.now();
  expect(await openGateway(600, gw.connect)).toBe(null);
  expect(Date.now() - started).toBeLessThan(300);
});

test("copying the browser's documents never overwrites: a taken name gets a number, identical text is not copied twice", async () => {
  await Storage.clear();
  await documentStore.create("x", "# Alpha\n\none\n");
  await documentStore.create("y", "# Beta\n\ntwo\n");
  await documentStore.create("z", "# Beta\n\nanother beta\n");
  await documentStore.create("w", "# Gamma\n\nsame\n");
  const { gw, store } = await connected({ "Beta.md": "the library's own\n", "Gamma.md": "# Gamma\n\nsame\n" });
  const report = await copyLocalDocs(store, false);
  expect([[...report.copied].sort(), report.same, report.failed]).toEqual([["Alpha", "Beta 2", "Beta 3"], ["Gamma"], []]);
  expect(gw.docs.get("Beta.md")).toBe("the library's own\n");
  expect([gw.docs.get("Beta 2.md"), gw.docs.get("Beta 3.md")].sort()).toEqual(["# Beta\n\nanother beta\n", "# Beta\n\ntwo\n"]);
  expect((await documentStore.list()).length).toBe(4);
  const again = await copyLocalDocs(store, false);
  expect([again.copied, again.same.length, again.failed]).toEqual([[], 4, []]);
  expect(gw.docs.size).toBe(5);
});

test("a program on the port that takes the connection but never answers does not hold up the start, and its late connection is closed", async () => {
  let late: (s: Socket) => void = () => undefined;
  let closed = false;
  const hang: Connect = () => new Promise((resolve) => (late = resolve));
  const started = Date.now();
  expect(await openGateway(200, hang)).toBe(null);
  expect(Date.now() - started).toBeLessThan(600);
  late({ send: () => undefined, close: () => (closed = true) });
  await sleep(20);
  expect(closed).toBe(true);
});

test("a probe that fails does not keep connecting in the background", async () => {
  const gw = fakeGateway({});
  gw.state.mute = ["hello"];
  expect(await openGateway(100, gw.connect)).toBe(null);
  await sleep(2500);
  expect(gw.state.connects).toBe(1);
});

test("while the gateway keeps failing the handshake, reconnecting stays on one timer and backs off", async () => {
  const { gw, backend } = await connected({ "a.md": "x\n" }, 50);
  gw.state.mute = ["hello"];
  gw.drop();
  await sleep(6000);
  // 1 秒后试一次（200ms 握手超时），再隔 2 秒试一次；下一次要到 7 秒以后
  expect(gw.state.connects - 1).toBe(2);
  expect(backend.link().state).toBe("reconnecting");
  backend.close();
});

test("a rename the gateway did is not reported as failed when the list after it, or the reply itself, gets lost", async () => {
  const { gw, store } = await connected({ "a.md": "x\n" }, 600, 300);
  gw.state.mute = ["list"];
  expect((await store.rename("a.md", "b")).id).toBe("b.md");
  gw.state.mute = [];
  await sleep(1300);
  gw.state.dropAfter = "rename";
  expect((await store.rename("b.md", "c")).id).toBe("c.md");
  expect([...gw.docs.keys()]).toEqual(["c.md"]);
});

test("replies of the wrong shape end the request instead of leaving it hanging, and a request with no reply counts as a lost connection", async () => {
  const { gw, store, backend } = await connected({ "a.md": "x\n" }, 600, 300);
  gw.state.raw = { list: `{"type":"reply","id":$id,"ok":false}`, read: `{"type":"reply","id":$id,"ok":true,"result":null}` };
  await expect(store.list()).rejects.toThrow("Could not understand the gateway’s reply");
  await expect(store.read("a.md")).rejects.toThrow("Could not understand the gateway’s reply");
  gw.state.mute = ["write"];
  const started = Date.now();
  await expect(store.write("a.md", "y\n", "v1")).rejects.toThrow("Lost the connection to the local gateway");
  expect(Date.now() - started).toBeLessThan(1000);
  expect(backend.link()).toEqual({ state: "reconnecting", reason: "The gateway stopped responding." });
  backend.close();
});

test("a program that answers the handshake with something else is refused with a reason, and so is a page the gateway does not accept", async () => {
  const rogue = fakeGateway({});
  rogue.state.hello = {};
  await expect(openGateway(600, rogue.connect)).rejects.toThrow("did not respond like the Pairdown gateway");
  const strict = fakeGateway({});
  strict.state.closeOnHello = 4003;
  await expect(openGateway(600, strict.connect)).rejects.toThrow("--origin");
  await sleep(1300);
  expect([rogue.state.connects, strict.state.connects]).toEqual([1, 1]);
});

test("errors the gateway reports are explained in plain words, saving included", async () => {
  const { gw, store } = await connected({ "a.md": "x\n" });
  gw.state.raw = {
    write: `{"type":"reply","id":$id,"ok":false,"error":{"code":"too-large","message":"too-large"}}`,
    putAsset: `{"type":"reply","id":$id,"ok":false,"error":{"code":"busy","message":"busy"}}`,
  };
  await expect(store.write("a.md", "y\n", "v1")).rejects.toThrow("exceeds the gateway’s 5 MB limit");
  await expect(store.putAsset("a.md", PNG)).rejects.toThrow("The gateway is busy");
});

test("another tab renaming a document comes through as a rename, not as a deletion", async () => {
  const { gw, store } = await connected({ "a.md": "x\n" });
  const heard: StoreChange[] = [];
  store.watch?.((c) => heard.push(c));
  await store.read("a.md");
  gw.renameElsewhere("a.md", "b.md");
  await sleep(20);
  expect(heard.map((c) => c.renamed)).toEqual([[{ from: "a.md", to: "b.md" }]]);
});
