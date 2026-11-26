/** ND-08 探针：TextView.parse 在 html: true 时把 <img> 的 align 丢了。这条用例通过 = 问题还在。 */
import { TextView } from "nsh/base";
import { expect, test } from "nsh/test";

test("ND-08 TextView.parse still drops an <img>'s align", () => {
  const doc = JSON.stringify(TextView.parse('<img src="a.png" align="center">\n', { html: true }));
  // 对照：图片本身读进来了
  expect(doc.includes("a.png")).toBe(true);
  expect(doc.includes("center")).toBe(false);
});
