import { expect, open, test } from "nsh/test";
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";
import { base64, RED_NAME, RED_PNG } from "./fixtures/images";
import { LIBRARY, memoryFs } from "./fixtures/memory-fs";

const MAC = { platform: "macos" as const, width: 1280, height: 860 };
const WEB = { platform: "web" as const, width: 1280, height: 860 };
/** 仓库里现成的一张 PNG，当成剪贴板上的截图粘贴。 */
const ICON = "assets/icon/icon.png";
const ASSET = /assets\/[0-9a-f]{16}\.png/;

type Disk = ReturnType<typeof memoryFs>;
const openMac = (disk: Disk) => open("../App.tsx", { ...MAC, modules: disk.modules });
type App = Awaited<ReturnType<typeof openMac>>;

const assetFiles = (disk: Disk) => [...disk.files.keys()].filter((p) => p.startsWith(`${LIBRARY}/assets/`) && !p.split("/").pop()?.startsWith("."));
const text = (disk: Disk, name: string) => String(disk.files.get(`${LIBRARY}/${name}`) ?? "");

async function savedOnDisk(app: App, disk: Disk, name: string, pattern: RegExp) {
  await app.waitUntil(() => pattern.test(text(disk, name)), { timeout: 3000 });
  return text(disk, name);
}

test("a pasted screenshot is stored next to the document under its content hash, and the text points to it; the same image is stored once", async () => {
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\nfirst\n" });
  const app = await openMac(disk);
  await app.press("text:first");
  await app.keyboard.press("end");
  await app.paste("label:正文", { files: [ICON] });
  const md = await savedOnDisk(app, disk, "Alpha.md", /!\[\]\(assets\//);
  expect(md).toMatch(/^# Alpha\n\nfirst!\[\]\(assets\/[0-9a-f]{16}\.png\)\n$/);
  expect(assetFiles(disk).map((p) => p.slice(LIBRARY.length + 1))).toEqual([ASSET.exec(md)?.[0]]);
  await app.paste("label:正文", { files: [ICON] });
  await savedOnDisk(app, disk, "Alpha.md", /\.png\)!\[\]/);
  expect(assetFiles(disk).length).toBe(1);
});

test("the insert image command picks a file; a picked SVG is refused with a reason and the text is not changed", async () => {
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\nfirst\n" });
  const app = await openMac(disk);
  await app.press("text:first");
  await app.keyboard.press("end");
  await app.keyboard.press("enter");
  app.onPick(() => [{ name: "x.svg", data: new TextEncoder().encode("<svg><script>alert(1)</script></svg>") }]);
  await app.type("label:正文", "/crtp");
  await app.waitFor("id:slash-insert.image");
  await app.keyboard.press("enter");
  await app.waitFor("id:receipt");
  expect(app.texts().some((t) => t.includes("SVG 不收"))).toBe(true);
  expect(assetFiles(disk)).toEqual([]);
  app.onPick(() => [{ name: "red.png", data: RED_PNG }]);
  await app.press("text:first");
  await app.keyboard.press("mod+ctrl+i");
  await savedOnDisk(app, disk, "Alpha.md", new RegExp(RED_NAME));
  expect(assetFiles(disk).map((p) => p.split("/").pop())).toEqual([RED_NAME]);
});

test("a selected image is resized and aligned from its bar, written as <img>, and goes back to ![]() at natural size", async () => {
  const disk = memoryFs({ "Alpha.md": `# Alpha\n\n![](assets/${RED_NAME})\n\nafter\n`, [`assets/${RED_NAME}`]: RED_PNG });
  const app = await openMac(disk);
  await app.waitFor("id:image-placeholder").catch(() => app.waitFor("id:image"));
  await app.press(app.shows("id:image") ? "id:image" : "id:image-placeholder");
  await app.waitFor("id:image-bar");
  await app.press("label:宽度 50%");
  await app.press("label:居中");
  expect(await savedOnDisk(app, disk, "Alpha.md", /align/)).toBe(`# Alpha\n\n<img src="assets/${RED_NAME}" width="50%" align="center">\n\nafter\n`);
  expect(app.shows("label:宽度 50%（当前）")).toBe(true);
  expect(app.texts()).toContain("✓ 50%");
  await app.press("label:原始大小");
  await app.press("label:居中（当前）");
  expect(await savedOnDisk(app, disk, "Alpha.md", /!\[\]/)).toBe(`# Alpha\n\n![](assets/${RED_NAME})\n\nafter\n`);
});

test("a linked image is not loaded: it shows its address and opens in the browser; with browser storage there is no transfer button", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: "# T\n\n![](https://example.com/cat.png)\n" } });
  await app.waitFor("text:https://example.com/cat.png");
  expect(app.shows("label:在浏览器里打开这张图片")).toBe(true);
  expect(app.shows("id:image-transfer")).toBe(false);
  expect(app.texts().some((t) => t.includes("不自动加载"))).toBe(true);
});

test("an image that is not there shows a placeholder with its address, not a blank", async () => {
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\n![](assets/0000000000000000.png)\n" });
  const app = await openMac(disk);
  await app.waitFor("text:找不到图片：assets/0000000000000000.png");
});

test("pasting from a web page keeps headings, lists, tables, links, bold and code, drops scripts and handlers, and stores data: images", async () => {
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\nfirst\n" });
  const app = await openMac(disk);
  await app.press("text:first");
  await app.keyboard.press("end");
  await app.keyboard.press("enter");
  const html =
    '<h2>Sub</h2><script>alert(1)</script><ul><li>one</li></ul><table><tr><th>h</th></tr><tr><td>c</td></tr></table>' +
    '<p><b>bold</b> <i>it</i> <a href="https://e.com">link</a> <code>x</code> <img src="x" onerror="alert(2)"></p>' +
    `<p><img src="data:image/png;base64,${base64(RED_PNG)}"></p>`;
  await app.paste("label:正文", { html, text: "Sub one h c bold it link x" });
  const md = await savedOnDisk(app, disk, "Alpha.md", new RegExp(RED_NAME));
  for (const part of ["## Sub", "- one", "| h |", "**bold**", "*it*", "[link](https://e.com)", "`x`", `![](assets/${RED_NAME})`]) expect(md).toContain(part);
  for (const bad of ["script", "alert", "onerror", "data:"]) expect(md.includes(bad)).toBe(false);
  expect(assetFiles(disk).map((p) => p.split("/").pop())).toEqual([RED_NAME]);
});

test("in the browser without IndexedDB a pasted image is refused with a message, and the text is unchanged", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: "# T\n\nbody\n" } });
  await app.press("text:body");
  await app.paste("label:正文", { files: [ICON] });
  await app.waitFor("id:receipt");
  expect(app.texts().some((t) => t.includes("存不了图片"))).toBe(true);
  await app.setLifecycle("background");
  expect(app.storage()[DOC_KEY]).toBe("# T\n\nbody\n");
});

test("an image file dropped on the window goes into the open document", async () => {
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\nfirst\n", "/Users/t/Downloads/red.png": RED_PNG });
  const app = await openMac(disk);
  await app.press("text:first");
  await app.keyboard.press("end");
  await app.dropFiles("label:正文", ["file:///Users/t/Downloads/red.png"]);
  expect(await savedOnDisk(app, disk, "Alpha.md", new RegExp(RED_NAME))).toBe(`# Alpha\n\nfirst![](assets/${RED_NAME})\n`);
});

async function selectImage(app: App) {
  if (app.shows("id:image-bar")) return;
  await app.waitFor("id:image-placeholder").catch(() => app.waitFor("id:image"));
  await app.press(app.shows("id:image") ? "id:image" : "id:image-placeholder");
  await app.waitFor("id:image-bar");
}

async function fromPalette(app: App, query: string) {
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("label:命令", query);
  await app.keyboard.press("enter");
  await app.waitUntil(() => !app.shows("id:palette"), { timeout: 3000 });
}

test("the image bar's actions work from the keyboard through the command palette, and Esc closes the alt text field without changing it", async () => {
  const disk = memoryFs({ "Alpha.md": `# Alpha\n\n![](assets/${RED_NAME})\n\nafter\n`, [`assets/${RED_NAME}`]: RED_PNG });
  const app = await openMac(disk);
  await selectImage(app);
  await fromPalette(app, "图片宽度：50%");
  expect(await savedOnDisk(app, disk, "Alpha.md", /width/)).toBe(`# Alpha\n\n<img src="assets/${RED_NAME}" width="50%">\n\nafter\n`);
  await selectImage(app);
  await fromPalette(app, "编辑图片的替代文字");
  await app.waitFor("label:替代文字");
  await app.type("label:替代文字", "red box");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("label:替代文字"), { timeout: 3000 });
  await selectImage(app);
  await fromPalette(app, "编辑图片的替代文字");
  await app.type("label:替代文字", "red box\n");
  expect(await savedOnDisk(app, disk, "Alpha.md", /alt=/)).toBe(`# Alpha\n\n<img src="assets/${RED_NAME}" alt="red box" width="50%">\n\nafter\n`);
  await selectImage(app);
  await fromPalette(app, "删除图片");
  expect(await savedOnDisk(app, disk, "Alpha.md", /^(?![\s\S]*img)/)).toBe("# Alpha\n\nafter\n");
});

test("an image inside a link has no width or alignment buttons, and the palette does not offer them", async () => {
  const disk = memoryFs({ "Alpha.md": `# Alpha\n\n[![](assets/${RED_NAME})](https://e.com)\n`, [`assets/${RED_NAME}`]: RED_PNG });
  const app = await openMac(disk);
  await selectImage(app);
  expect(app.shows("id:image-width-50%")).toBe(false);
  expect(app.texts().some((t) => t.includes("链接里的图片不能调大小"))).toBe(true);
  await app.keyboard.press("mod+shift+p");
  await app.waitFor("id:palette");
  await app.type("label:命令", "图片宽度");
  expect(app.texts().some((t) => t.includes("图片宽度：50%"))).toBe(false);
});

test("pasted images with javascript:, file: or SVG data: addresses are dropped; web and relative ones stay", async () => {
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\nfirst\n" });
  const app = await openMac(disk);
  await app.press("text:first");
  await app.keyboard.press("end");
  await app.keyboard.press("enter");
  const svg = btoa("<svg xmlns='http://www.w3.org/2000/svg'/>");
  const html = `<p>keep <img src="https://e.com/a.png"> <img src="assets/x.png"> drop <img src="javascript:alert(1)"> <img src="file:///etc/x.png"> <img src="data:image/svg+xml;base64,${svg}"> end</p>`;
  await app.paste("label:正文", { html, text: "keep drop end" });
  const md = await savedOnDisk(app, disk, "Alpha.md", /end/);
  expect(md).toContain("![](https://e.com/a.png)");
  expect(md).toContain("![](assets/x.png)");
  for (const bad of ["javascript:", "file:", "svg"]) expect(md.includes(bad)).toBe(false);
});

test("a dropped image file over 8 MB is refused with a reason that names the size limit", async () => {
  const big = new Uint8Array(8 * 1024 * 1024 + 1);
  big.set(RED_PNG);
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\nfirst\n", "/Users/t/Downloads/big.png": big });
  const app = await openMac(disk);
  await app.press("text:first");
  await app.dropFiles("label:正文", ["file:///Users/t/Downloads/big.png"]);
  await app.waitFor("id:receipt");
  expect(app.texts().some((t) => t.includes("超过 8 MB"))).toBe(true);
  expect(assetFiles(disk)).toEqual([]);
});
