import { expect, open, test } from "nsh/test";
import { fileNameFor } from "../src/features/files/file-name";
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";
import { openedBody, storedIds } from "./fixtures/library";
import { memoryFs } from "./fixtures/memory-fs";

const WEB = { platform: "web" as const, width: 1280, height: 860 };
const FILE = "# From disk\r\n\r\n* keep\r\n* these bytes\r\n";
const bytes = (text: string) => new TextEncoder().encode(text);

const openApp = (doc: string, options: Record<string, unknown> = {}) => open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: doc }, ...options });
type App = Awaited<ReturnType<typeof openApp>>;

async function saved(app: App): Promise<string> {
  await app.setLifecycle("active");
  await app.setLifecycle("background");
  return app.storage()[DOC_KEY] ?? "";
}

test("opening a file stores it as a new document and opens it, byte for byte, without touching the current one", async () => {
  const app = await openApp("# Mine\n\nprecious\n");
  await app.waitFor("text:precious");
  app.onPick(() => [{ name: "notes.md", data: bytes(FILE) }]);
  await app.press("id:file-open");
  await app.waitFor("text:From disk");
  expect(app.shows("text:已打开「notes」，存成了文档库里的一篇新文档。")).toBe(true);
  await saved(app);
  expect(openedBody(app.storage())).toBe(FILE);
  expect(app.storage()[DOC_KEY]).toBe("# Mine\n\nprecious\n");
  await app.press("id:toggle-sidebar");
  await app.waitFor("id:documents");
  expect(app.shows("id:documents >> text:Mine")).toBe(true);
  expect(app.shows("id:documents >> text:From disk")).toBe(true);
});

test("cancelling the file picker changes nothing", async () => {
  const app = await openApp("# Mine\n\nprecious\n");
  await app.waitFor("text:precious");
  let asked = 0;
  app.onPick(() => {
    asked += 1;
    return null;
  });
  await app.press("id:file-open");
  await app.waitUntil(() => asked === 1, { timeout: 3000 });
  await app.wait(300);
  expect(await saved(app)).toBe("# Mine\n\nprecious\n");
  expect(storedIds(app.storage())).toEqual([]);
});

test("save as on the desktop writes the document to Downloads under its title, without overwriting", async () => {
  // 替身里的 homedir 给值不给函数：homedir() 在应用里是同步用的，函数形式的替身一律返回 Promise（见 memory-fs.ts）
  const disk = memoryFs({ "/Users/t/Downloads/Trip plan.md": "older" });
  const app = await openApp("# Trip plan\n\nday one\n", { platform: "macos", modules: disk.modules });
  await app.waitFor("text:day one");
  await app.press("id:file-save-as");
  await app.waitFor("id:receipt");
  expect(disk.files.get("/Users/t/Downloads/Trip plan.md")).toBe("older");
  expect(disk.files.get("/Users/t/Downloads/Trip plan 2.md")).toBe("# Trip plan\n\nday one\n");
  expect(app.shows("text:已存到 /Users/t/Downloads/Trip plan 2.md")).toBe(true);
});

test("a file name comes from the title, without characters a file name cannot hold", () => {
  expect(fileNameFor("# Trip: plan / v2?\n\ntext\n")).toBe("Trip plan v2.md");
  expect(fileNameFor("no heading here\n")).toBe("未命名.md");
  expect(fileNameFor("# ...hidden\n")).toBe("hidden.md");
  // 标题里的路径写法进不了文件名，也不会变成点开头的隐藏文件
  expect(fileNameFor("# ../../x\n")).toBe("x.md");
  expect(fileNameFor("# . .hidden\n")).toBe("hidden.md");
  // 截断不把一个表情截成半个
  expect(fileNameFor(`# ${"a".repeat(79)}😀tail\n`)).toBe(`${"a".repeat(79)}😀.md`);
});

test("a file that is not UTF-8 text is refused and the document stays as it was", async () => {
  const app = await openApp("# Mine\n\nprecious\n");
  await app.waitFor("text:precious");
  app.onPick(() => [{ name: "gbk.md", data: new Uint8Array([0x23, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x00, 0xff, 0x0a]) }]);
  await app.press("id:file-open");
  await app.waitFor("id:receipt");
  expect(app.shows("text:precious")).toBe(true);
  expect(await saved(app)).toBe("# Mine\n\nprecious\n");
  expect(storedIds(app.storage())).toEqual([]);
});
