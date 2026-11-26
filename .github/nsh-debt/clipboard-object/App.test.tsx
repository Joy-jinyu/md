/** ND-07 探针：剪贴板权限只收布尔值。打开声明了「只写」的应用，nsh 仍警告「must be a boolean」= 问题还在，检查脚本看的是输出。 */
import { expect, open, test } from "nsh/test";

test("ND-07 an app declaring a write-only clipboard opens", async () => {
  const app = await open("./App.tsx");
  await app.waitFor("text:hello");
  expect(app.shows("text:hello")).toBe(true);
});
