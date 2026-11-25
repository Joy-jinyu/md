/** 错误 → 给人看的那句话：Error 取 message，别的转成字符串。 */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
