/** 一篇原文的 BOM 和换行风格 */
export interface Endings {
  bom: boolean;
  /** 全篇每个换行都是 CRLF 才算；混用时不动原文 */
  crlf: boolean;
}

const BOM = String.fromCharCode(0xfeff);

/** 拆出 BOM 和换行风格，全篇 CRLF 的正文统一成 LF */
export function splitEndings(src: string): Endings & { text: string } {
  const bom = src.startsWith(BOM);
  const body = bom ? src.slice(1) : src;
  const crlf = body.includes("\r\n") && !/(?:^|[^\r])\n/.test(body);
  return { bom, crlf, text: crlf ? body.replace(/\r\n/g, "\n") : body };
}

/** splitEndings 的反向：按原来的 BOM 和换行风格写回 */
export function joinEndings(text: string, endings: Endings): string {
  return (endings.bom ? BOM : "") + (endings.crlf ? text.replace(/\n/g, "\r\n") : text);
}
