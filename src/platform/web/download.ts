/** 浏览器里把一段文字存成文件：造一个临时链接点一下，浏览器按它自己的下载设置存。 */

/** 用到的那一小部分页面接口：项目的 TypeScript 配置里没有浏览器的类型库。 */
interface Anchor {
  href: string;
  download: string;
  click(): void;
  remove(): void;
}
interface Page {
  createElement(tag: "a"): Anchor;
  body: { appendChild(node: Anchor): void };
}

/** 链接点过之后多久收回它占的内存（毫秒）：浏览器要先把内容读走，立刻收回有的浏览器会存成空文件。 */
const REVOKE_AFTER = 10_000;

/** 触发下载；不在浏览器页面里（没有 document）时抛错。 */
export function downloadText(name: string, text: string) {
  const page = (globalThis as { document?: Page }).document;
  if (!page) throw new Error("这里不是浏览器页面，没法下载");
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = page.createElement("a");
  link.href = url;
  link.download = name;
  page.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER);
}
