/** 名字 → 合法的文件名（不含扩展名）：另存为、文件类后端新建和改名都用它。另有两个文件类后端共用的路径小工具。 */

/** 文件名（不含扩展名）最长多少个字符：再长在访达和下载列表里也看不全。 */
const MAX_NAME = 80;
/** 各系统文件名里不允许的字符，和控制字符。 */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 路径里文件所在的目录（带结尾的 `/`；在最上层是空串）。 */
export const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/** 路径里的文件名去掉 `ext` 匹配到的扩展名。 */
export const stemOf = (path: string, ext: RegExp) => path.slice(path.lastIndexOf("/") + 1).replace(ext, "");

/** 去掉不允许的字符、开头的点和空格（点开头的文件在访达里是隐藏的）；按字符截断，不把一个表情截成半个。什么都不剩时是空串。 */
export function cleanFileStem(name: string): string {
  const clean = name.replace(FORBIDDEN, " ").replace(/\s+/g, " ").replace(/^[.\s]+/, "");
  return Array.from(clean).slice(0, MAX_NAME).join("").trim();
}
