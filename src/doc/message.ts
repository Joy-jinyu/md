/** 错误 → 给人看的那句话：Error 取 message，别的转成字符串。 */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 错误严重级别 */
export type ErrorSeverity = "error" | "warn" | "debug";

/** 统一错误处理选项 */
export interface HandleErrorOptions {
  /** 错误上下文描述 */
  context: string;
  /** 严重级别，默认 "warn" */
  severity?: ErrorSeverity;
  /** 是否需要用户反馈（默认 false） */
  userFacing?: boolean;
  /** 用户反馈消息（userFacing 为 true 时必填） */
  userMessage?: string;
}

/**
 * 统一错误处理函数：按严重级别输出到控制台，可选向用户展示友好提示。
 * 返回给人看的错误消息（便于测试和进一步处理）。
 */
export function handleError(e: unknown, options: HandleErrorOptions): string {
  const message = messageOf(e);
  const severity = options.severity ?? "warn";
  const fullMessage = `${options.context}: ${message}`;

  // 按级别输出到控制台
  if (severity === "error") {
    console.error(fullMessage, e);
  } else if (severity === "warn") {
    console.warn(fullMessage, e);
  } else {
    console.debug(fullMessage, e);
  }

  // 返回给人看的消息
  return message;
}
