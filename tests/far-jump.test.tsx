import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
// 旧版（单篇）的正文键：存进去的那篇启动时原地成为文档库的第一篇
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";

/**
 * 长文档里跳到从没显示过的地方（nsh 0.7.0 起编辑器只挂视口附近的块，没挂上的块 scrollIntoView 不滚）：
 * 查找、大纲、目录、脚注都要把目标滚进窗口；滚过去以后，那里的提示块也有类型标签。
 */
const WEB = { platform: "web" as const, width: 1280, height: 860 };
const FILLER = Array.from({ length: 300 }, (_, i) => `第 ${i + 1} 段，这是一段用来撑长文档的普通文字。`).join("\n\n");
const FAR = "这里有目标词 zebra 一个。";
const DOC = ["# 长文", "", "[toc]", "", "开头一段", "", "脚注在这里。[^1]", "", "> [!NOTE]", "> 近处提示", "", FILLER, "", "## 远处标题", "", FAR, "", "> [!WARNING]", "> 远处提示", "", "[^1]: 脚注的内容在文末。", ""].join("\n");

const openDoc = async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: DOC } });
  await app.waitFor("text:开头一段");
  expect(app.shows(`text:${FAR}`)).toBe(false);
  return app;
};

test("find reaches a match far down that was never on screen, and the callout there gets its label", async () => {
  const app = await openDoc();
  expect(app.count("id:alert-label")).toBe(1);
  await app.press("text:开头一段");
  await app.keyboard.press("mod+f");
  await app.type("label:查找内容", "zebra");
  await app.keyboard.press("enter");
  await app.waitFor(`text:${FAR}`);
  expect(app.shows("text:开头一段")).toBe(false);
  await app.waitUntil(() => app.count("id:alert-label") === 2);
});

test("the outline, the table of contents and a footnote each jump to a part never on screen", async () => {
  const app = await openDoc();
  await app.press("text:开头一段");
  await app.keyboard.press("mod+shift+l");
  await app.waitFor("id:outline");
  await app.press("id:outline-1");
  await app.waitFor(`text:${FAR}`);

  const toc = await openDoc();
  await toc.press("text:开头一段");
  await toc.press("text:远处标题");
  await toc.waitFor(`text:${FAR}`);

  const note = await openDoc();
  await note.press("text:开头一段");
  await note.press("id:footnote-ref-1");
  await note.waitFor("text:[^1]: 脚注的内容在文末。");
  expect(note.shows("text:开头一段")).toBe(false);
});
