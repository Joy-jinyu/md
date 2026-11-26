/** ND-02 探针：单次 JS 调用超过 2000ms 会被 nsh 中断。这条用例被中断（输出里有预算的报错）= 问题还在，检查脚本看的是输出，不是通过与否。 */
import { test } from "nsh/test";

/** 比预算多跑 600ms：预算放宽到 2.6 秒以上，这条就跑得完。 */
const BUSY_MS = 2600;

test("ND-02 a JS call longer than the budget is interrupted", () => {
  const start = Date.now();
  while (Date.now() - start < BUSY_MS) {
    // 忙等：模拟整篇解析这类一口气做完的重活
  }
});
