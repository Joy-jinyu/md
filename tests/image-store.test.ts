import { Storage } from "nsh";
import { expect, test } from "nsh/test";
import { command, insertContent } from "nsh/base";
import { chooseBackend, copyLocalDocs, documentStore } from "../src/store/backend";
import type { DocumentStore } from "../src/store/document-store";
import type { Kv } from "../src/store/kv";
import { createLocalStore } from "../src/store/local-store";
import { openGateway } from "../src/store/gateway-store";
import { createDocument, markOpened } from "../src/store/library";
import { receipt } from "../src/features/library/receipt";
import { dumpMarkdown } from "../src/features/editor/convert";
import { storeDataImages, transferAllImages, transferImage } from "../src/features/editor/images";
import { markdownToHtml, markdownToHtmlWithImages } from "../src/features/files/export-html";
import { fakeGateway } from "./fixtures/fake-gateway";
import { base64, BLUE_NAME, BLUE_PNG, RED_NAME, RED_PNG, SVG } from "./fixtures/images";
import { openDoc } from "./fixtures/kit";

function memoryKv(): Kv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
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

const assetKeys = (kv: { data: Map<string, unknown> }) => [...kv.data.keys()].filter((k) => k.startsWith("md.asset.")).sort();

test("browser storage: an image is named by its content, kept once per document, read back, and deleted with its document", async () => {
  const kv = memoryKv();
  const store = createLocalStore(async () => kv);
  const doc = await store.create("a", "x\n");
  expect(await store.putAsset(doc.id, RED_PNG)).toBe(`assets/${RED_NAME}`);
  expect(await store.putAsset(doc.id, RED_PNG)).toBe(`assets/${RED_NAME}`);
  expect(await store.putAsset(doc.id, BLUE_PNG)).toBe(`assets/${BLUE_NAME}`);
  expect(assetKeys(kv).length).toBe(2);
  const got = await store.getAsset(doc.id, `./assets/${RED_NAME}`);
  expect([got?.mime, [...(got?.bytes ?? [])]]).toEqual(["image/png", [...RED_PNG]]);
  expect(await store.getAsset("other", `assets/${RED_NAME}`)).toBe(null);
  expect(await store.getAsset(doc.id, `../assets/${RED_NAME}`)).toBe(null);
  expect(await store.getAsset(doc.id, "https://example.com/a.png")).toBe(null);
  await store.remove(doc.id);
  expect(assetKeys(kv)).toEqual([]);
});

test("browser storage: SVG and other non-images are refused, so is an image over 10 MB, with a reason a person can act on", async () => {
  const store = createLocalStore(async () => memoryKv());
  await expect(store.putAsset("d", SVG)).rejects.toThrow("SVG 不收");
  await expect(store.putAsset("d", new TextEncoder().encode("<html>"))).rejects.toThrow("不是认得的图片格式");
  const big = new Uint8Array(10 * 1024 * 1024 + 1);
  big.set(RED_PNG);
  await expect(store.putAsset("d", big)).rejects.toThrow("先压缩一下");
});

test("browser storage without IndexedDB says images cannot be kept instead of failing silently", async () => {
  await Storage.clear();
  await expect(documentStore.putAsset("document", RED_PNG)).rejects.toThrow("存不了图片");
});

async function gateway(seed: Record<string, string> = { "notes/a.md": "x\n" }) {
  const gw = fakeGateway(seed);
  const backend = await openGateway(600, gw.connect);
  if (!backend) throw new Error("没连上假网关");
  return { gw, store: backend.store };
}

test("gateway: images go through putAsset / getAsset; a bad type never reaches the gateway; a missing one is null", async () => {
  const { gw, store } = await gateway();
  const src = await store.putAsset("notes/a.md", RED_PNG);
  expect(src).toBe("assets/img1.png");
  expect([...gw.assets.keys()]).toEqual(["notes/assets/img1.png"]);
  expect([...((await store.getAsset("notes/a.md", src))?.bytes ?? [])]).toEqual([...RED_PNG]);
  expect(await store.getAsset("notes/a.md", "assets/none.png")).toBe(null);
  expect(await store.getAsset("notes/a.md", "../../x/assets/a.png")).toBe(null);
  await expect(store.putAsset("notes/a.md", SVG)).rejects.toThrow("SVG 不收");
  expect(gw.assets.size).toBe(1);
});

test("gateway: transferring every linked image replaces the ones that worked and reports each one that did not", async () => {
  await Storage.clear();
  const gw = fakeGateway({});
  gw.state.downloads = {
    "https://example.com/ok.png": { data: base64(BLUE_PNG) },
    "http://10.0.0.1/inner.png": { code: "forbidden-address" },
  };
  await chooseBackend(null, true, gw.connect);
  const doc = await createDocument("");
  markOpened(doc.id);
  const o = openDoc("![a](https://example.com/ok.png)\n\n![b](http://10.0.0.1/inner.png)\n\n![c](https://example.com/ok.png)\n");
  await transferAllImages(o.session);
  expect(dumpMarkdown(o.session.getJSON(), o.origin)).toBe("![a](assets/img1.png)\n\n![b](http://10.0.0.1/inner.png)\n\n![c](assets/img1.png)\n");
  expect(receipt()?.text).toContain("转存了 1 张，1 张没转成");
  expect(receipt()?.text).toContain("本机或内网");
  gw.state.downloads = {};
  await transferAllImages(o.session);
  expect(receipt()?.text).toContain("下载失败");
});

test("browser storage full: an image is refused with a reason and a way out, not the raw error", async () => {
  const kv = memoryKv();
  const store = createLocalStore(async () => kv);
  const doc = await store.create("a", "x\n");
  kv.update = async () => {
    throw Object.assign(new Error("QuotaExceededError: the quota has been exceeded"), { name: "QuotaExceededError" });
  };
  await expect(store.putAsset(doc.id, RED_PNG)).rejects.toThrow("浏览器存储满了");
});

test("browser storage: opening a document drops images neither its text nor its history mentions once they are 10 minutes old; fresh ones and unreadable history keep them", async () => {
  const kv = memoryKv();
  const realNow = Date.now;
  const seed = async () => {
    const store = createLocalStore(async () => kv);
    const doc = await store.create("a", `![](assets/${RED_NAME})\n`);
    await store.putAsset(doc.id, RED_PNG);
    await store.putAsset(doc.id, BLUE_PNG);
    return { store, id: doc.id };
  };
  const open = async (d: { store: DocumentStore; id: string }) => d.store.sweepAssets?.(d.id, (await d.store.read(d.id))?.text ?? "");
  const later = (minutes: number) => {
    const at = realNow() + minutes * 60 * 1000;
    Date.now = () => at;
  };
  try {
    const a = await seed();
    // 另一个标签页刚贴进来、还没保存的图：不到 10 分钟不清
    await open(a);
    expect(assetKeys(kv)).toEqual([`md.asset.${a.id}/${BLUE_NAME}`, `md.asset.${a.id}/${RED_NAME}`].sort());
    later(11);
    await open(a);
    expect(assetKeys(kv)).toEqual([`md.asset.${a.id}/${RED_NAME}`]);
    Date.now = realNow;
    const b = await seed();
    kv.data.set(`md.history.${b.id}`, JSON.stringify([{ at: 1, text: `![](assets/${BLUE_NAME})` }]));
    const c = await seed();
    kv.data.set(`md.history.${c.id}`, "{not json");
    later(11);
    await open(b);
    await open(c);
    expect(assetKeys(kv).filter((k) => k.includes(b.id)).length).toBe(2);
    expect(assetKeys(kv).filter((k) => k.includes(c.id)).length).toBe(2);
    // 早先存的、没记存入时间的图：不知道多久了，不清
    const d = await (createLocalStore(async () => kv)).create("d", "no images\n");
    kv.data.set(`md.asset.${d.id}/${BLUE_NAME}`, BLUE_PNG);
    later(60);
    await open({ store: createLocalStore(async () => kv), id: d.id });
    expect(assetKeys(kv).filter((k) => k.includes(d.id)).length).toBe(1);
  } finally {
    Date.now = realNow;
  }
});

test("copying browser documents into the library brings their images; the text follows the library's names; a failed image is reported and keeps the browser copy", async () => {
  const kv = memoryKv();
  const source = createLocalStore(async () => kv);
  const doc = await source.create("pic", `# Pic\n\n![](assets/${RED_NAME})\n`);
  await source.putAsset(doc.id, RED_PNG);
  const { gw, store } = await gateway({});
  const report = await copyLocalDocs(store, false, source);
  expect([report.copied, report.imagesFailed]).toEqual([["Pic"], []]);
  expect([...gw.assets.keys()]).toEqual(["assets/img1.png"]);
  expect((await store.read("Pic.md"))?.text).toBe("# Pic\n\n![](assets/img1.png)\n");
  const broken: DocumentStore = { ...store, putAsset: () => Promise.reject(new Error("disk full")) };
  const other = await source.create("two", `# Two\n\n![](assets/${RED_NAME})\n`);
  await source.putAsset(other.id, RED_PNG);
  const moved = await copyLocalDocs(broken, true, source);
  expect(moved.failed).toEqual(["Pic", "Two"]);
  expect((await source.list()).length).toBe(2);
  const copied = await copyLocalDocs(broken, false, source);
  expect(copied.imagesFailed).toEqual(["Pic（1 张）", "Two（1 张）"]);
});

async function openGatewayDoc(downloads: ReturnType<typeof fakeGateway>["state"]["downloads"] = {}) {
  await Storage.clear();
  const gw = fakeGateway({});
  gw.state.downloads = downloads;
  await chooseBackend(null, true, gw.connect);
  const doc = await createDocument("");
  markOpened(doc.id);
  return { gw, doc };
}

test("a transfer that finds the address gone from the text says so instead of reporting success", async () => {
  await openGatewayDoc({ "https://example.com/ok.png": { data: base64(BLUE_PNG) } });
  const o = openDoc("text only\n");
  await transferImage(o.session, "https://example.com/ok.png");
  expect(receipt()?.text).toContain("正文里没找到原地址");
  expect(dumpMarkdown(o.session.getJSON(), o.origin)).toBe("text only\n");
});

test("pasted data: images are stored, the ones already in the text are left alone, and one undo takes back the paste with its stored image", async () => {
  await openGatewayDoc();
  const old = `data:image/png;base64,${base64(RED_PNG)}`;
  const o = openDoc(`![](${old})\n\nend\n`);
  storeDataImages(o.session, [700]);
  o.session.run(insertContent({ type: "image", attrs: { src: `data:image/png;base64,${base64(BLUE_PNG)}`, alt: "" } }));
  await new Promise((r) => setTimeout(r, 1000));
  const md = dumpMarkdown(o.session.getJSON(), o.origin);
  expect(md).toContain(`![](${old})`);
  expect(md).toContain("![](assets/img1.png)");
  o.session.run(command("undo"));
  expect(dumpMarkdown(o.session.getJSON(), o.origin)).toBe(`![](${old})\n\nend\n`);
});

test("exporting HTML inlines stored images, and leaves them as addresses with a note when that would be too big to write", async () => {
  const { doc } = await openGatewayDoc();
  const src = await documentStore.putAsset(doc.id, RED_PNG);
  const text = `# T\n\n![](${src})\n`;
  const inlined = await markdownToHtmlWithImages(text, doc.id);
  expect([inlined.html.includes("data:image/png;base64,"), inlined.note]).toEqual([true, ""]);
  const limit = new TextEncoder().encode(markdownToHtml(text)).length + 10;
  const capped = await markdownToHtmlWithImages(text, doc.id, limit);
  expect(capped.html.includes("data:image")).toBe(false);
  expect(capped.html).toContain(src);
  expect(capped.note).toContain("没有内联");
});
