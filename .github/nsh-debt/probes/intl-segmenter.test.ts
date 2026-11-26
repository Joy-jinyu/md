/** ND-09 探针：引擎里没有 Intl.Segmenter（按词选中只能自己切词）。这条用例通过 = 问题还在。 */
import { expect, test } from "nsh/test";

test("ND-09 Intl.Segmenter is still missing", () => {
  expect(typeof (Intl as unknown as Record<string, unknown>).Segmenter).toBe("undefined");
});
