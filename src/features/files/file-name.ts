/** 另存为时的文件名：取文档标题，去掉文件名里不能有的字符。 */
import { markdownTitle } from "../editor/outline";

/** 文件名（不含扩展名）最长多少个字符：再长在访达和下载列表里也看不全。 */
const MAX_NAME = 80;
/** 各系统文件名里不允许的字符，和控制字符。 */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

export function fileNameFor(markdown: string): string {
  // 开头的点和空格去干净（点开头的文件在访达里是隐藏的）；按字符而不是按 UTF-16 单元截，免得把一个表情截成半个
  const title = markdownTitle(markdown).replace(FORBIDDEN, " ").replace(/\s+/g, " ").replace(/^[.\s]+/, "");
  return `${Array.from(title).slice(0, MAX_NAME).join("").trim() || "未命名"}.md`;
}
