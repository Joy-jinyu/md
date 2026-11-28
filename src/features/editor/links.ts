/** 打开链接的唯一入口：只放行 http:、https:、mailto: 和文档内锚点（.claude/rules/security.md）。 */
import { openUrl } from "nsh";
import { handleError } from "../../doc/message";

/** 一个链接地址该怎么处理：外部打开、跳到文档内的标题，或不打开。 */
export type LinkTarget = { kind: "external"; url: string } | { kind: "anchor"; id: string } | { kind: "blocked" };

const OPENABLE = new Set(["http", "https", "mailto"]);

/** 判断链接能不能打开（纯函数）。协议名不分大小写；没有协议的相对地址、javascript:、file:、data: 等一律不打开。 */
export function linkTarget(href: string): LinkTarget {
  const url = href.trim();
  if (url.startsWith("#")) return url.length > 1 ? { kind: "anchor", id: decodeAnchor(url.slice(1)) } : { kind: "blocked" };
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  return scheme && OPENABLE.has(scheme) ? { kind: "external", url } : { kind: "blocked" };
}

/** 按 `linkTarget` 的判断打开：外部地址交给系统，锚点交给 `onAnchor`，其余什么也不做。返回是否打开了。 */
export async function openLink(href: string, onAnchor: (id: string) => boolean): Promise<boolean> {
  const target = linkTarget(href);
  if (target.kind === "anchor") return onAnchor(target.id);
  if (target.kind === "blocked") return false;
  try {
    return (await openUrl(target.url)).opened;
  } catch (e) {
    handleError(e, { context: "openUrl refused", severity: "warn" });
    return false;
  }
}

/** 标题文字 → 锚点 id，和 GitHub 的写法一致：转小写、去掉标点、空白换成 `-`。 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function decodeAnchor(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}
