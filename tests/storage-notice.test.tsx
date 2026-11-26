import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { LAST_OPENED_KEY } from "../src/store/library";
import { seedLibrary } from "./fixtures/library";

const WEB = { platform: "web" as const, width: 1280, height: 860 };
const LOCAL = seedLibrary([{ id: "da", name: "Alpha", text: "# Alpha\n\nfirst doc\n" }]);

test("when the gateway used last time is not there, the page says the browser's documents are shown, and keeps the last opened document for later", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { ...LOCAL, "md.lastBackend": "gateway:Notes", [LAST_OPENED_KEY]: "notes/a.md" } });
  await app.waitFor("text:first doc");
  await app.waitFor("text:上次用的是本机网关的文库「Notes」，现在没连上，显示的是浏览器里的文档。");
  expect(app.storage()[LAST_OPENED_KEY]).toBe("notes/a.md");
  await app.press("id:gateway-settings");
  await app.waitFor("id:storage");
  await app.keyboard.press("escape");
  await app.press("id:gateway-forget");
  await app.waitUntil(() => !app.shows("id:gateway-missed"));
  expect(app.storage()["md.lastBackend"]).toBe("local");
});

test("unsaved text that belongs to another storage is mentioned, not dropped", async () => {
  const stash = JSON.stringify({ id: "notes/a.md", base: "v1", text: "typed\n", backend: "gateway:Other" });
  const app = await open("../App.tsx", { ...WEB, storage: { ...LOCAL, "md.unsaved.notes/a.md": stash } });
  await app.waitFor("text:first doc");
  await app.waitFor("text:有没存上的修改属于本机网关的文库「Other」，用回那边时会补回去。");
  expect(app.storage()["md.unsaved.notes/a.md"]).toBe(stash);
});
