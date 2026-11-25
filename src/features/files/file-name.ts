/** 另存为时的文件名：优先取正文标题，无标题时用文库名；去掉文件名里不能有的字符。 */
import { cleanFileStem } from "../../doc/file-name";
import { markdownTitle } from "../editor/outline";

export function fileNameFor(markdown: string, extension = "md", fallbackName = ""): string {
  return `${cleanFileStem(markdownTitle(markdown)) || cleanFileStem(fallbackName) || "未命名"}.${extension}`;
}
