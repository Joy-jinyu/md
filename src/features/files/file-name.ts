/** 另存为时的文件名：取文档标题，去掉文件名里不能有的字符。 */
import { cleanFileStem } from "../../doc/file-name";
import { markdownTitle } from "../editor/outline";

export function fileNameFor(markdown: string, extension = "md"): string {
  return `${cleanFileStem(markdownTitle(markdown)) || "未命名"}.${extension}`;
}
