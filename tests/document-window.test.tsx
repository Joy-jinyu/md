import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { memoryFs } from "./fixtures/memory-fs";

const ALPHA = "# Alpha\n\noriginal\n";
const BETA = "# Beta\n\nother document\n";
const WINDOW = "document:Beta.md";
const MAC = { platform: "macos" as const, width: 1280, height: 860 };

async function openSecondDocument() {
  const disk = memoryFs({ "Alpha.md": ALPHA, "Beta.md": BETA });
  const app = await open("../App.tsx", { ...MAC, modules: disk.modules });
  await app.waitFor("text:original");
  await app.press("id:toggle-sidebar");
  await app.rightClick("id:doc-Beta.md");
  await app.chooseMenuItem("在新窗口打开");
  await app.waitUntil(() => app.windowIds().includes(WINDOW));
  return { app, disk };
}

test("editing and closing a new window saves its own document while the main document stays open", async () => {
  const { app, disk } = await openSecondDocument();
  await app.rightClick("id:doc-Beta.md");
  await app.chooseMenuItem("在新窗口打开");
  expect(app.windowIds()).toEqual(["main", WINDOW]);

  await app.type("label:Markdown 源码", "\nsecond window");
  await app.window(WINDOW).pressClose();
  await app.waitUntil(() => !app.windowIds().includes(WINDOW));
  expect(disk.library()["Alpha.md"]).toBe(ALPHA);
  expect(disk.library()["Beta.md"]).toContain("second window");
  expect(app.windowIds()).toEqual(["main"]);
  expect(app.shows("text:original")).toBe(true);
});

test("a conflicting write leaves the new window open with its draft and does not replace newer disk content", async () => {
  const { app, disk } = await openSecondDocument();
  await app.type("label:Markdown 源码", "\nmy separate draft");
  const external = "# Beta\n\nexternal edit\n";
  disk.put("Beta.md", external);
  await app.window(WINDOW).pressClose();
  await app.waitFor("id:document-window-save-problem");
  expect(app.windowIds()).toEqual(["main", WINDOW]);
  expect(disk.library()["Beta.md"]).toBe(external);
  expect(app.value("label:Markdown 源码")).toContain("my separate draft");
  await app.quitRequest();
  expect(app.quit()).toBe(true);

  const reopened = await open("../App.tsx", { ...MAC, storage: app.storage(), modules: disk.modules });
  await reopened.waitFor("id:toggle-sidebar");
  await reopened.press("id:toggle-sidebar");
  await reopened.rightClick("id:doc-Beta.md");
  await reopened.chooseMenuItem("版本历史…");
  await reopened.waitFor("id:history-preview");
  expect(reopened.texts().some((text) => text.includes("my separate draft"))).toBe(true);
  expect(disk.library()["Beta.md"]).toBe(external);
});
