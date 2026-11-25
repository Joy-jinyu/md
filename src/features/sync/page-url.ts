/** 页面地址：网页登录要用它算回调地址、读 GitHub 带回来的 code / state，登录完再把这些参数从地址里去掉。 */
import { UrlScheme } from "nsh";

export const pageUrl = (): string | null => UrlScheme.url();

export function setPageUrl(url: string) {
  UrlScheme.setUrl(url);
}
