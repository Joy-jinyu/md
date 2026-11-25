import { isOrigin } from "./auth.mts";
import { DEFAULT_PORT, LISTEN_HOST } from "./protocol.ts";

export type CliOptions = { library: string; port: number; origins: string[] };

export type CliResult = { kind: "run"; options: CliOptions } | { kind: "help" } | { kind: "error"; message: string };

export const USAGE = [
  "用法：node gateway/src/main.mts --library <文件夹> [--port <端口>] [--origin <来源>]...",
  "",
  "  --library <文件夹>  文库文件夹：里面的 .md 是文档，图片存在文档旁边的 assets/ 里。必须已存在",
  `  --port <端口>       在 ${LISTEN_HOST} 的这个端口上监听，默认 ${DEFAULT_PORT}`,
  "  --origin <来源>     额外放行的页面来源，例如 http://127.0.0.1:8811（本地开发页面）；可以写多次",
  "  -h, --help          打印这段说明后退出",
  "",
  `只监听 ${LISTEN_HOST}，没有参数能改成别的地址。`,
].join("\n");

/** 只接受认得的参数：打错的参数（--prot）不能被悄悄忽略。改监听地址的参数（--host 之类）一律不认。 */
export function parseCli(args: string[]): CliResult {
  if (args.includes("-h") || args.includes("--help")) return { kind: "help" };
  let library: string | undefined;
  let port = DEFAULT_PORT;
  const origins: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (a === "--library") {
      if (v === undefined || v.startsWith("--")) return { kind: "error", message: "--library 缺少文件夹" };
      library = v;
    } else if (a === "--port") {
      const n = Number(v);
      if (v === undefined || !Number.isInteger(n) || n <= 0 || n > 65535) return { kind: "error", message: `--port 不合法：${v ?? "缺少端口号"}` };
      port = n;
    } else if (a === "--origin") {
      if (v === undefined || !isOrigin(v)) return { kind: "error", message: `--origin 不合法：${v ?? "缺少来源"}（要写成 http(s)://主机 [:端口]）` };
      origins.push(v);
    } else if (a === "--host" || a === "--listen" || a === "--bind") {
      return { kind: "error", message: `网关只监听 ${LISTEN_HOST}，不能改监听地址` };
    } else {
      return { kind: "error", message: a.startsWith("-") ? `不认识的参数：${a}` : `多余的参数：${a}` };
    }
    i++;
  }
  if (library === undefined) return { kind: "error", message: "缺少 --library <文件夹>" };
  return { kind: "run", options: { library, port, origins } };
}
