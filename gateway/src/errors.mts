import type { ErrorCode } from "./protocol.ts";

/** 回给页面的错误：code 稳定，message 只给人看，不带文档内容。 */
export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly version?: string;
  constructor(code: ErrorCode, message: string, version?: string) {
    super(message);
    this.code = code;
    this.version = version;
  }
}

/** node 文件操作的错误码（ENOENT 之类），不是 node 错误时为 undefined。 */
export function errno(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string" ? e.code : undefined;
}

/** 写日志用：node 文件错误只留错误码和调用名（它的 message 里带绝对路径），别的错误用 message。 */
export function describeError(e: unknown): string {
  const code = errno(e);
  if (code !== undefined && "syscall" in (e as object)) return `${code}（${String((e as { syscall: unknown }).syscall)}）`;
  return e instanceof Error ? e.message : String(e);
}
