/**
 * 写剪贴板，写不进去时 reject（调用方照旧按成功 / 失败两条路处理）。
 * nsh 0.7.0 起 `Clipboard.writeText` 报结果：系统拒收是 resolve 成 `"failed"`（不 reject）；
 * `"requested"` 是平台不报结果（iOS、Android、Linux），按写进去了算。没开剪贴板能力这类错照旧 reject。
 */
import { Clipboard } from "nsh";

export async function writeClipboard(text: string): Promise<void> {
  if ((await Clipboard.writeText(text)) === "failed") throw new Error("系统没收下要复制的内容");
}
