import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { checkId } from "../src/platform/macos/file-store";
import { LAST_OPENED_KEY } from "../src/store/library";
import { bodyKey, metaKey } from "../src/store/local-store";
import { seedLibrary } from "./fixtures/library";
import { HOME, LIBRARY, memoryFs } from "./fixtures/memory-fs";

const MAC = { platform: "macos" as const, width: 1280, height: 860 };
const ALPHA = "# Alpha\n\nfirst doc\n";
const BETA = "# Beta\n\nsecond doc\n";

type Disk = ReturnType<typeof memoryFs>;

async function openMac(disk: Disk, storage: Record<string, string> = {}) {
  const app = await open("../App.tsx", { ...MAC, storage, modules: disk.modules });
  return app;
}
type App = Awaited<ReturnType<typeof openMac>>;

async function refocus(app: App) {
  await app.setLifecycle("background");
  await app.setLifecycle("active");
}

async function showDocuments(app: App) {
  await app.press("id:toggle-sidebar");
  await app.waitFor("id:documents");
}

const tempFiles = (disk: Disk) => Object.keys(disk.library()).filter((p) => p.split("/").pop()?.startsWith("."));

test("on first start the documents kept in the app's storage move into the library folder, without overwriting, and only once", async () => {
  const disk = memoryFs({ "Beta.md": BETA, "Gamma.md": "the folder's own gamma\n" });
  const storage = {
    ...seedLibrary([
      { id: "da", name: "Alpha", text: ALPHA },
      { id: "db", name: "Beta", text: BETA },
      { id: "dc", name: "Gamma", text: "gamma kept in storage\n" },
    ]),
    [LAST_OPENED_KEY]: "da",
  };
  const app = await openMac(disk, storage);
  await app.waitFor("id:toggle-sidebar");
  await app.wait(300);
  // 同名而内容不同的那篇不覆盖文件夹里的，名字加序号搬进去
  expect(disk.library()).toEqual({ "Alpha.md": ALPHA, "Beta.md": BETA, "Gamma.md": "the folder's own gamma\n", "Gamma 2.md": "gamma kept in storage\n" });
  const left = app.storage();
  expect([left[bodyKey("da")], left[bodyKey("db")], left[bodyKey("dc")], left[metaKey("dc")]]).toEqual([undefined, undefined, undefined, undefined]);
  expect(app.shows("id:left-behind")).toBe(false);
  const again = await openMac(disk, left);
  await again.waitFor("id:toggle-sidebar");
  await again.wait(300);
  expect(Object.keys(disk.library()).sort()).toEqual(["Alpha.md", "Beta.md", "Gamma 2.md", "Gamma.md"]);
});

test("edits are written to the document's file through a temporary file, leaving nothing else behind", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await openMac(disk);
  await app.press("text:first doc");
  await app.keyboard.press("end");
  await app.type("label:正文", " more");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(disk.library()).toEqual({ "Alpha.md": "# Alpha\n\nfirst doc more\n" });
  expect(tempFiles(disk)).toEqual([]);
});

test("coming back to the window after another app changed the file loads it, or asks when there are edits here", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  disk.put("Alpha.md", "# Alpha\n\nfrom another app\n");
  await refocus(app);
  await app.waitFor("text:from another app");
  await app.waitFor("text:文库里的文件被别的程序改了，已载入最新的内容。");
  await app.press("text:from another app");
  await app.keyboard.press("end");
  await app.type("label:正文", " mine");
  disk.put("Alpha.md", "# Alpha\n\nchanged again\n");
  await refocus(app);
  await app.waitFor("text:文库里的文件被别的程序改了，和这里没存的修改冲突。选一边保留，另一边会存进版本历史。");
  expect(disk.library()["Alpha.md"]).toBe("# Alpha\n\nchanged again\n");
  await app.press("id:take-theirs");
  await app.waitFor("text:changed again");
});

test("closing the window saves at once and keeps the app; the Dock icon brings the window back with the caret where it was", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await openMac(disk);
  await app.press("text:first doc");
  await app.keyboard.press("end");
  await app.type("label:正文", " more");
  await app.window("main").pressClose();
  // 不等停手后的自动保存（800ms）：关窗当时就存
  await app.waitUntil(() => disk.library()["Alpha.md"] === "# Alpha\n\nfirst doc more\n", { timeout: 300 });
  expect(app.quit()).toBe(false);
  expect(app.window("main").state()?.visible).toBe(false);
  await app.reopen();
  expect(app.window("main").state()?.visible).toBe(true);
  await app.type("label:正文", "!");
  await app.waitUntil(() => disk.library()["Alpha.md"] === "# Alpha\n\nfirst doc more!\n", { timeout: 3000 });
});

test("a file another app changed while the window was closed is loaded when the Dock icon brings the window back", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  await app.window("main").pressClose();
  disk.put("Alpha.md", "# Alpha\n\nfrom another app\n");
  await app.reopen();
  await app.waitFor("text:from another app");
});

/** 这里打了字、还没存，文件又被别的程序改了：关窗、退出时存盘会冲突。 */
async function editThenChangeElsewhere(disk: Disk) {
  const app = await openMac(disk);
  await app.press("text:first doc");
  await app.keyboard.press("end");
  await app.type("label:正文", " mine");
  disk.put("Alpha.md", "# Alpha\n\nfrom another app\n");
  return app;
}

test("closing the window while the file changed elsewhere keeps the window open with the conflict bar, and nothing is overwritten", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await editThenChangeElsewhere(disk);
  await app.window("main").pressClose();
  await app.waitFor("id:conflict");
  expect(app.window("main").state()?.visible).toBe(true);
  expect(disk.library()["Alpha.md"]).toBe("# Alpha\n\nfrom another app\n");
  await app.press("id:keep-mine");
  await app.waitUntil(() => disk.library()["Alpha.md"] === "# Alpha\n\nfirst doc mine\n", { timeout: 3000 });
  await app.window("main").pressClose();
  await app.waitUntil(() => app.window("main").state()?.visible === false, { timeout: 3000 });
});

test("quitting while the file changed elsewhere does not quit and shows the conflict bar; quitting again keeps the edit for the next start", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await editThenChangeElsewhere(disk);
  await app.quitRequest();
  expect(app.quit()).toBe(false);
  expect(app.window("main").state()?.visible).toBe(true);
  expect(app.shows("id:conflict")).toBe(true);
  await app.quitRequest();
  expect(app.quit()).toBe(true);
  expect(disk.library()["Alpha.md"]).toBe("# Alpha\n\nfrom another app\n");
  const next = await openMac(disk, app.storage());
  await next.waitFor("text:from another app");
  await next.waitFor("text:上次关闭前有一段修改没存上，而这篇后来在别处改过：那段修改存进了这篇的版本历史（「⋯」→「版本历史」）。");
  await showDocuments(next);
  await next.press("id:doc-more-Alpha.md");
  await next.chooseMenuItem("版本历史…");
  await next.waitFor("id:history-preview >> text:# Alpha\n\nfirst doc mine\n");
});

test("while the window is closed, a command's shortcut brings it back", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA, "Beta.md": BETA });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  await app.window("main").pressClose();
  expect(app.window("main").state()?.visible).toBe(false);
  await app.keyboard.press("mod+shift+o");
  await app.waitFor("id:quick-open");
  expect(app.window("main").state()?.visible).toBe(true);
});

test("a file deleted by another app while open offers to keep the text as a new document under its old name", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  disk.files.delete(`${LIBRARY}/Alpha.md`);
  await refocus(app);
  await app.waitFor("text:文库里的这个文件被别的程序删除或挪走了。这里的内容还在：存成一篇新文档留下它，或者放弃。");
  await app.press("id:save-as-new");
  await app.waitUntil(() => Object.values(disk.library()).includes(ALPHA), { timeout: 3000 });
  expect(disk.library()).toEqual({ "Alpha.md": ALPHA });
  await app.waitFor("text:已把这里的内容存成新文档「Alpha」。");
});

test("the library names a document without a heading by its file name", async () => {
  const disk = memoryFs({ "smoke-a.md": "just words, no heading\n" });
  const app = await openMac(disk);
  await app.waitFor("text:just words, no heading");
  await app.press("id:toggle-sidebar");
  await app.waitFor("id:documents >> text:smoke-a.md");
  expect(app.shows("id:documents >> text:未命名")).toBe(false);
  await app.press("id:editor >> text:just words, no heading");
  await app.keyboard.press("mod+arrowup");
  await app.type("label:正文", "# Heading now\n");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(app.shows("id:editor >> text:Heading now")).toBe(true);
});

test("an error receipt stays with a close button until closed, and picking another document clears it", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA, "Beta.md": BETA, "gbk.md": new Uint8Array([0x6f, 0x6b, 0x20, 0xc4, 0xe3, 0x0a]) });
  const app = await openMac(disk, { [LAST_OPENED_KEY]: "Alpha.md" });
  await app.waitFor("text:first doc");
  await showDocuments(app);
  const docTop = app.layout("text:first doc")?.y;
  await app.press("id:doc-gbk.md");
  await app.waitFor("text:「gbk」不是 UTF-8 编码的文本，打不开。");
  // 回执浮在窗口底部，不占一行、不把正文往下推
  expect(app.layout("text:first doc")?.y).toBe(docTop);
  expect((app.layout("id:receipt")?.y ?? 0) > MAC.height / 2).toBe(true);
  await app.press("label:关掉这条提示");
  await app.waitUntil(() => !app.shows("id:receipt"), { timeout: 3000 });
  await app.press("id:doc-gbk.md");
  await app.waitFor("id:receipt");
  await app.press("id:doc-Beta.md");
  await app.waitFor("text:second doc");
  expect(app.shows("id:receipt")).toBe(false);
});

test("renaming the open document renames its file with a clean name, and later edits go to the new file", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await openMac(disk);
  await showDocuments(app);
  const row = "id:doc-Alpha.md";
  const before = app.layout(row);
  await app.rightClick(row);
  expect(app.menu()?.map((item) => item.label)).toEqual([
    "打开", "在新窗口打开", "新建文件", "新建文件夹…", "搜索", "文章（列表视图）", "文件树（树状视图）",
    "制作副本", "改文库名…", "版本历史…", "显示简介…", "删除…", "复制文件路径", "在访达中显示",
  ]);
  expect(app.layout(row)).toEqual(before);
  await app.chooseMenuItem("改文库名…");
  await app.waitFor("id:rename-input");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "Alpha v2:");
  await app.keyboard.press("enter");
  await app.waitFor("id:documents >> text:Alpha v2.md");
  expect(Object.keys(disk.library())).toEqual(["Alpha v2.md"]);
  await app.press("text:first doc");
  await app.keyboard.press("end");
  await app.type("label:正文", " renamed");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(disk.library()).toEqual({ "Alpha v2.md": "# Alpha\n\nfirst doc renamed\n" });
});

test("a file too large to save back is listed as such and does not open", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA, "huge.md": "x".repeat(8 * 1024 * 1024 + 1) });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.waitFor("id:documents >> text:文件太大，打不开");
  await app.press("id:doc-huge.md");
  await app.waitFor("text:「huge」文件太大，打不开。");
  expect(app.shows("text:first doc")).toBe(true);
});

test("a dropped file from the library opens in place; one from elsewhere is copied in, or explained when the app may not read it", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA, "sub/Beta.md": BETA, [`${HOME}/Downloads/Note.md`]: "# Note\n\nfrom downloads\n" });
  const app = await openMac(disk, { [LAST_OPENED_KEY]: "Alpha.md" });
  await app.waitFor("text:first doc");
  await app.dropFiles("label:正文", [`file://${LIBRARY}/sub/Beta.md`]);
  await app.waitFor("text:second doc");
  await app.dropFiles("label:正文", [`file://${HOME}/Downloads/Note.md`]);
  await app.waitFor("text:from downloads");
  expect(disk.library()["Note.md"]).toBe("# Note\n\nfrom downloads\n");
  expect(app.shows("text:「Note」不在文库（~/Documents/Pairdown）里，应用改不了原文件，已导入一份副本到文库。")).toBe(true);
  await app.dropFiles("label:正文", ["file:///Volumes/Stick/Elsewhere.md"]);
  await app.waitFor("text:「Elsewhere」不在文库（~/Documents/Pairdown）里，应用没有权限读它。把它挪进文库文件夹，或者用「打开文件」选它导入一份。");
  expect(Object.keys(disk.library()).sort()).toEqual(["Alpha.md", "Note.md", "sub/Beta.md"]);
});

test("document paths that could leave the library or touch hidden files are refused", () => {
  for (const bad of ["../x.md", "/etc/x.md", "a/../../x.md", ".hidden.md", "a/.git/x.md", "a\\b.md", "x.txt", "a//b.md", ""]) {
    expect(() => checkId(bad)).toThrow("Invalid document path");
  }
  expect(() => checkId("notes/Trip v2.md")).not.toThrow();
});

test("a file that is not UTF-8 is listed as such; a file with a BOM and Windows line ends keeps both when saved", async () => {
  const bom = [0xef, 0xbb, 0xbf];
  const crlf = new Uint8Array([...bom, ...new TextEncoder().encode("# Crlf\r\n\r\nline one\r\n\r\nline two\r\n")]);
  const disk = memoryFs({ "Alpha.md": ALPHA, "gbk.md": new Uint8Array([0x6f, 0x6b, 0x20, 0xc4, 0xe3, 0xba, 0xc3, 0x0a]), "crlf.md": crlf });
  const app = await openMac(disk, { [LAST_OPENED_KEY]: "crlf.md" });
  await app.waitFor("text:line one");
  await showDocuments(app);
  await app.waitFor("id:documents >> text:不是 UTF-8 编码的文本，打不开");
  await app.press("text:line one");
  await app.keyboard.press("end");
  await app.type("label:正文", "!");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(disk.bytes("crlf.md").slice(0, 3)).toEqual(bom);
  expect(disk.library()["crlf.md"]).toBe("\ufeff# Crlf\r\n\r\nline one!\r\n\r\nline two\r\n");
});

test(".markdown files are documents too and keep their extension when renamed; only changing the letter case of a name is allowed unless another file has that exact name", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA, "notes.markdown": "# Notes\n\nlong extension\n", "beta.md": BETA, "Beta.md": "# Other Beta\n" });
  const app = await openMac(disk);
  await showDocuments(app);
  await app.press("id:doc-more-notes.markdown");
  await app.chooseMenuItem("改文库名…");
  await app.waitFor("id:rename-input");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "notes 2");
  await app.keyboard.press("enter");
  await app.waitFor("id:documents >> text:notes 2.markdown");
  expect(disk.library()["notes 2.markdown"]).toBe("# Notes\n\nlong extension\n");
  await app.press("id:doc-more-Alpha.md");
  await app.chooseMenuItem("改文库名…");
  await app.waitFor("id:rename-input");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "beta");
  await app.keyboard.press("enter");
  await app.waitFor("text:没能改名：已经有一篇叫「beta」的文档了，换一个名字");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "ALPHA");
  await app.keyboard.press("enter");
  await app.waitFor("id:documents >> text:ALPHA.md");
  expect(disk.library()["ALPHA.md"]).toBe(ALPHA);
});

test("temporary files left by an interrupted save are cleared on start", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA, "sub/.pairdown-0a1b2c3d-1111-2222-3333-444455556666.tmp": "half\n" });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  await app.wait(200);
  expect(tempFiles(disk)).toEqual([]);
});


test("the macOS library menu creates empty folders and files, copies paths, and switches between tree and articles", async () => {
  const disk = memoryFs({ "Notes/A.md": "# A\n\nbody\n", "Notes/A 副本.md": "existing copy\n" });
  const app = await openMac(disk);
  await showDocuments(app);
  await app.rightClick("id:doc-Notes/A.md");
  await app.chooseMenuItem("复制文件路径");
  expect(app.clipboard()).toBe("/Users/t/Documents/Pairdown/Notes/A.md");
  await app.rightClick("id:doc-Notes/A.md");
  await app.chooseMenuItem("显示简介…");
  await app.waitFor("id:file-info");
  expect(app.texts()).toContain("/Users/t/Documents/Pairdown/Notes/A.md");
  await app.press("id:close-file-info");
  await app.rightClick("id:doc-Notes/A.md");
  await app.chooseMenuItem("制作副本");
  await app.waitFor("id:doc-Notes/A 副本 2.md");
  expect(disk.library()["Notes/A 副本.md"]).toBe("existing copy\n");
  expect(disk.library()["Notes/A 副本 2.md"]).toBe("# A\n\nbody\n");

  await app.rightClick("id:doc-Notes/A.md");
  await app.chooseMenuItem("新建文件夹…");
  await app.type("id:folder-name", "Empty");
  await app.press("id:create-folder-confirm");
  await app.waitFor("id:folder-Notes/Empty");
  await app.rightClick("id:folder-Notes/Empty");
  expect(app.menu()?.find((item) => item.label === "文件树（树状视图）")?.checked).toBe(true);
  await app.chooseMenuItem("新建文件");
  await app.waitUntil(() => disk.library()["Notes/Empty/未命名.md"] === "");
  await app.rightClick("id:folder-Notes/Empty");
  await app.chooseMenuItem("文章（列表视图）");
  await app.waitFor("id:doc-Notes/Empty/未命名.md");
  expect(app.shows("id:folder-Notes/Empty")).toBe(false);
});

test("the macOS library menu reveals documents and folders in Finder, focuses search, and deletes after confirming", async () => {
  const disk = memoryFs({ "Notes/A.md": "# A\n\nbody\n", "B.md": "# B\n\nbeta words\n" });
  const runs: string[][] = [];
  let finderFails = false;
  const process = {
    run: async (command: string, args: string[]) => {
      runs.push([command, ...args]);
      return finderFails
        ? { code: 1, signal: null, stdout: "", stderr: "The file does not exist." }
        : { code: 0, signal: null, stdout: "", stderr: "" };
    },
  };
  const app = await open("../App.tsx", { ...MAC, storage: {}, modules: { ...disk.modules, process } as never });
  await showDocuments(app);

  await app.rightClick("id:doc-Notes/A.md");
  await app.chooseMenuItem("在访达中显示");
  await app.waitUntil(() => runs.length === 1);
  expect(runs[0]).toEqual(["/usr/bin/open", "-R", "/Users/t/Documents/Pairdown/Notes/A.md"]);

  await app.rightClick("id:doc-Notes/A.md");
  await app.chooseMenuItem("文件树（树状视图）");
  await app.rightClick("id:folder-Notes");
  await app.chooseMenuItem("在访达中显示");
  await app.waitUntil(() => runs.length === 2);
  expect(runs[1]).toEqual(["/usr/bin/open", "-R", "/Users/t/Documents/Pairdown/Notes"]);

  await app.press("id:library-actions");
  await app.chooseMenuItem("在访达中显示");
  await app.waitUntil(() => runs.length === 3);
  expect(runs[2]).toEqual(["/usr/bin/open", "-R", "/Users/t/Documents/Pairdown"]);

  finderFails = true;
  await app.rightClick("id:folder-Notes");
  await app.chooseMenuItem("在访达中显示");
  await app.waitFor("text:The file does not exist.");

  await app.rightClick("id:folder-Notes");
  await app.chooseMenuItem("搜索");
  await app.keyboard.press("w");
  await app.waitUntil(() => app.texts().some((text) => text.includes("1 篇文档里找到")));
  await app.keyboard.press("backspace");

  await app.rightClick("id:doc-B.md");
  await app.chooseMenuItem("删除…");
  await app.press("id:delete-now");
  await app.waitUntil(() => !("B.md" in disk.library()));
  expect(Object.keys(disk.library())).toEqual(["Notes/A.md"]);
});

test("article cards show the folder, the file name with its extension and a two-line excerpt; the tree shows the library and file names with extensions", async () => {
  const disk = memoryFs({ "Notes/Report.md": "---\ntag: x\n---\n# Weekly **Report**\n\nfirst line\nsecond line\n", "Top.markdown": "plain top\n" });
  const app = await openMac(disk);
  await showDocuments(app);
  const report = "id:doc-Notes/Report.md";
  await app.waitFor(report);
  expect(app.shows(`${report} >> text:Notes`)).toBe(true);
  expect(app.shows(`${report} >> text:Report.md`)).toBe(true);
  expect(app.shows(`${report} >> text:Weekly Report\nfirst line`)).toBe(true);
  expect(app.shows("id:doc-Top.markdown >> text:Pairdown")).toBe(true);
  expect(app.shows("id:doc-Top.markdown >> text:Top.markdown")).toBe(true);
  expect(app.shows("id:doc-Top.markdown >> text:plain top")).toBe(true);

  await app.rightClick("id:doc-Top.markdown");
  await app.chooseMenuItem("改文库名…");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "Renamed");
  await app.keyboard.press("enter");
  await app.waitFor("id:doc-Renamed.markdown >> text:plain top");

  await app.rightClick("id:doc-Renamed.markdown");
  await app.chooseMenuItem("文件树（树状视图）");
  await app.waitFor("id:library-root >> text:Pairdown");
  expect(app.shows(report)).toBe(false);
  await app.press("id:folder-Notes");
  await app.waitFor(`${report} >> text:Report.md`);
  expect(app.shows(`${report} >> text:first line`)).toBe(false);
  expect(app.shows("id:doc-Renamed.markdown >> text:Renamed.markdown")).toBe(true);
});

test("renaming on macOS happens in place: the row's name becomes an input holding the file name; Esc cancels, clicking elsewhere saves", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA, "Beta.md": BETA });
  const app = await openMac(disk);
  await showDocuments(app);
  await app.rightClick("id:doc-Alpha.md");
  await app.chooseMenuItem("改文库名…");
  await app.waitFor("id:doc-Alpha.md >> id:rename-input");
  expect(app.shows("id:rename")).toBe(false);
  expect(app.value("id:rename-input")).toBe("Alpha.md");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "Gamma");
  await app.keyboard.press("escape");
  await app.waitUntil(() => !app.shows("id:rename-input"));
  expect(Object.keys(disk.library()).sort()).toEqual(["Alpha.md", "Beta.md"]);

  await app.rightClick("id:doc-Alpha.md");
  await app.chooseMenuItem("改文库名…");
  await app.waitFor("id:rename-input");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "Gamma.md");
  await app.press("id:doc-Beta.md");
  await app.waitUntil(() => Object.keys(disk.library()).includes("Gamma.md"));
  expect(disk.library()["Gamma.md"]).toBe(ALPHA);
});

test("a rename that cannot be saved keeps the input and does not switch documents; closing the sidebar while renaming saves the name", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA, "Beta.md": BETA });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.rightClick("id:doc-Alpha.md");
  await app.chooseMenuItem("改文库名…");
  await app.waitFor("id:rename-input");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "beta");
  await app.press("id:doc-Beta.md");
  await app.waitFor("text:没能改名：已经有一篇叫「beta」的文档了，换一个名字");
  expect(app.shows("id:rename-input")).toBe(true);
  expect(app.shows("id:editor >> text:first doc")).toBe(true);

  await app.clear("id:rename-input");
  await app.type("id:rename-input", "Gamma");
  await app.press("id:toggle-sidebar");
  await app.waitUntil(() => Object.keys(disk.library()).includes("Gamma.md"));
  await app.press("id:toggle-sidebar");
  await app.waitFor("id:doc-Gamma.md");
  expect(app.shows("id:rename-input")).toBe(false);
});

test("the sidebar's search, ⋯ and + show only while the pointer is over the sidebar", async () => {
  const disk = memoryFs({ "Alpha.md": ALPHA });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  await showDocuments(app);
  await app.hover("id:macos-title-toolbar");
  expect(app.viewStyle("id:library-row-actions")?.opacity).toBe(0);
  expect(app.viewStyle("id:sidebar-search-slot")?.opacity).toBe(0);
  await app.hover("id:doc-sort");
  expect(app.viewStyle("id:library-row-actions")?.opacity).toBe(1);
  expect(app.viewStyle("id:sidebar-search-slot")?.opacity).toBe(1);
  await app.hover("id:sidebar-title");
  expect(app.viewStyle("id:library-row-actions")?.opacity).toBe(1);
  await app.hover("id:macos-title-toolbar");
  expect(app.viewStyle("id:library-row-actions")?.opacity).toBe(0);
  // 指针在侧栏里时用快捷键收起，再打开时不该还亮着
  await app.hover("id:doc-sort");
  await app.keyboard.press("mod+shift+l");
  await app.wait(100);
  await app.keyboard.press("mod+shift+l");
  await app.wait(100);
  expect(app.shows("id:sidebar")).toBe(false);
  await app.keyboard.press("ctrl+mod+2");
  await app.waitFor("id:documents");
  expect(app.viewStyle("id:library-row-actions")?.opacity).toBe(0);
});

test("the table bar shows right above the table the caret is in, without moving the text", async () => {
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\nfirst doc\n\n| h1 | h2 |\n| --- | --- |\n| cell1 | cell2 |\n" });
  const app = await openMac(disk);
  await app.waitFor("text:first doc");
  const before = app.layout("text:first doc")?.y;
  const cell = app.layout("text:h1");
  await app.press("text:cell1");
  await app.waitFor("id:table-bar");
  const bar = app.layout("id:table-bar");
  expect(bar && cell && bar.y + bar.height <= cell.y && cell.y - (bar.y + bar.height) < 30).toBe(true);
  expect(bar && app.layout("text:first doc") && bar.y > (app.layout("text:first doc")?.y ?? 0)).toBe(true);
  expect(app.layout("text:first doc")?.y).toBe(before);
  expect(app.layout("text:h1")?.y).toBe(cell?.y);
});
