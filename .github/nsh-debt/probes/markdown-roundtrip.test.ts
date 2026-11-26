/** ND-01 探针：nsh 内置的 Markdown 读入（format: "markdown"）+ 写出（getMarkdown）会丢内容。这条用例通过 = 问题还在。 */
import { createRichEditor } from "nsh/base";
import { expect, test } from "nsh/test";

/** 项目实际要保住的写法（2026-11-24 实测内置读写会丢）：front matter、脚注、行内 HTML、代码块语言后的附加信息。 */
const KEPT = ["---\ntitle: x\n---", "Text[^1]", "[^1]: note", "<u>u</u>", "```js {1,3}"];

test("ND-01 the built-in Markdown reader and writer still lose content", () => {
  const source = "---\ntitle: x\n---\n\n# H\n\nText[^1] <u>u</u>\n\n```js {1,3}\nlet a\n```\n\n[^1]: note\n";
  const out = createRichEditor({ content: source, format: "markdown" }).getMarkdown();
  // 对照：至少读进了正文，不是整个读失败
  expect(out.includes("# H")).toBe(true);
  expect(KEPT.every((part) => out.includes(part))).toBe(false);
});
