import { expect, open, test } from "nsh/test";
import { fileNameFor } from "../src/features/files/file-name";
import { DOC_KEY } from "../src/store/document";

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

test("opening a file into an empty document loads it without asking, byte for byte", async () => {
  const app = await openApp("");
  app.onPick(() => [{ name: "notes.md", data: bytes(FILE) }]);
  await app.press("id:file-open");
  await app.waitFor("text:From disk");
  expect(app.shows("id:replace-confirm")).toBe(false);
  expect(await saved(app)).toBe(FILE);
});

test("opening a file over a document with content asks first, and cancel keeps the document", async () => {
  const app = await openApp("# Mine\n\nprecious\n");
  await app.waitFor("text:precious");
  app.onPick(() => [{ name: "notes.md", data: bytes(FILE) }]);
  await app.press("id:file-open");
  await app.waitFor("id:replace-confirm");
  await app.press("id:replace-cancel");
  await app.waitUntil(() => !app.shows("id:replace-confirm"), { timeout: 3000 });
  expect(app.shows("text:precious")).toBe(true);
  expect(await saved(app)).toBe("# Mine\n\nprecious\n");
});

test("confirming the replacement swaps the document for the file", async () => {
  const app = await openApp("# Mine\n\nprecious\n");
  await app.waitFor("text:precious");
  app.onPick(() => [{ name: "notes.md", data: bytes(FILE) }]);
  await app.press("id:file-open");
  await app.waitFor("id:replace-confirm");
  await app.press("id:replace-now");
  await app.waitFor("text:From disk");
  expect(await saved(app)).toBe(FILE);
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
  expect(app.shows("id:replace-confirm")).toBe(false);
  expect(await saved(app)).toBe("# Mine\n\nprecious\n");
});

test("save as on the desktop writes the document to Downloads under its title, without overwriting", async () => {
  const written: Record<string, string> = {};
  const taken = new Set(["/Users/t/Downloads/Trip plan.md"]);
  const app = await openApp("# Trip plan\n\nday one\n", {
    platform: "macos",
    modules: {
      // 给值不给函数：homedir() 在应用里是同步用的，函数形式的替身一律返回 Promise
      os: { homedir: "/Users/t" },
      "fs/promises": {
        exists: (path: string) => taken.has(path),
        writeFile: (path: string, data: string) => {
          written[path] = data;
        },
      },
    },
  });
  await app.waitFor("text:day one");
  await app.press("id:file-save-as");
  await app.waitFor("id:file-message");
  expect(written).toEqual({ "/Users/t/Downloads/Trip plan 2.md": "# Trip plan\n\nday one\n" });
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
  await app.waitFor("id:file-message");
  expect(app.shows("id:replace-confirm")).toBe(false);
  expect(app.shows("text:precious")).toBe(true);
  expect(await saved(app)).toBe("# Mine\n\nprecious\n");
});

test("on the desktop, save-first writes the current document and then opens the file", async () => {
  const written: Record<string, string> = {};
  const app = await openApp("# Mine\n\nprecious\n", {
    platform: "macos",
    modules: {
      os: { homedir: "/Users/t" },
      "fs/promises": {
        exists: () => false,
        writeFile: (path: string, data: string) => {
          written[path] = data;
        },
      },
    },
  });
  await app.waitFor("text:precious");
  app.onPick(() => [{ name: "notes.md", data: bytes(FILE) }]);
  await app.press("id:file-open");
  await app.waitFor("id:replace-confirm");
  await app.press("id:replace-save-first");
  await app.waitFor("text:From disk");
  expect(written).toEqual({ "/Users/t/Downloads/Mine.md": "# Mine\n\nprecious\n" });
  expect(await saved(app)).toBe(FILE);
});
