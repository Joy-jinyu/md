import { expect, test } from "nsh/test";
import { excerptOf, headOf } from "../src/doc/excerpt";

test("the card excerpt is the first two lines of text without Markdown marks", () => {
  expect(excerptOf("# Weekly **Report**\n\n这个目录存放 [每周](https://x.y) 的 `trending`\n\nthird line")).toBe("Weekly Report\n这个目录存放 每周 的 trending");
  expect(excerptOf("---\ntitle: x\n---\n\n- [ ] 任务\n> quoted ![img](a.png)<br>")).toBe("任务\nquoted");
  expect(excerptOf("```js\nlet a = 1\n```")).toBe("let a = 1");
  expect(excerptOf("| a | b |\n|---|---|\n| 1 | 2 |")).toBe("a b\n1 2");
  expect(excerptOf("---\nunterminated: front matter")).toBe("");
  expect(excerptOf("")).toBe("");
  expect(excerptOf("a < b and c > d, see <https://x.y/z> and <b>bold</b>")).toBe("a < b and c > d, see https://x.y/z and bold");
  expect(excerptOf("2 * 3 and a == b, snake_case, \\*literal\\*, ==mark== ~~gone~~ _em_")).toBe("2 * 3 and a == b, snake_case, *literal*, mark gone em");
  expect(excerptOf("```py\ndef __init__(**kwargs): a == b\n```")).toBe("def __init__(**kwargs): a == b");
  expect(excerptOf("Title\n=====\n\n***\nbody")).toBe("Title\nbody");
});

test("the head is at most 512 UTF-8 bytes, cut at a whole character, without the BOM", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;
  const head = headOf(`${String.fromCharCode(0xfeff)}a${"汉".repeat(400)}`);
  expect(head.startsWith("a汉")).toBe(true);
  expect(bytes(head)).toBe(511);
  expect(headOf(`${"x".repeat(511)}😀`)).toBe("x".repeat(511));
  expect(headOf("short")).toBe("short");
});
