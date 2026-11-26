/**
 * 同步的配置：GitHub OAuth App 的 client id 和站点的来源，来自部署配置（`.env` / CI secret，经 scripts/app-config.mjs 生成 `src/app-config.gen.ts`）。
 * 没配齐（`syncConfigured`）时顶栏的同步入口和命令面板的「同步…」都不出现，设置页的「同步」页签照样在，写明没配置、怎么配。
 * client secret 不在这里、也不能出现在仓库和前端包里：它只放在站点 Worker 的 secret 里（worker/README.md）。
 * 站点来源也给网关面板拼安装命令（`siteOrigin`）。
 */
import { GITHUB_CLIENT_ID, SITE_ORIGIN } from "../app-config.gen";

export const OAUTH_SCOPE = "gist";
export const GITHUB_API = "https://api.github.com";
export const DEVICE_CODE_URL = "https://github.com/login/device/code";
export const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

export interface SyncConfig {
  /** GitHub OAuth App 的 client id（公开值，不是密钥）。 */
  clientId: string;
  /** 站点的来源（`https://…`，不带结尾的 /）：OAuth App 登记的回调地址就是它加 `/`。没配是空字符串。 */
  siteOrigin: string;
  /** 网页登录换 token 的地址。线上是本站的 `/token`；单独一项是因为测试会话里请求要过 nsh.json 的 `network.hosts`，测试得借已放行的域名。 */
  tokenUrl: string;
}

let current: SyncConfig = { clientId: GITHUB_CLIENT_ID, siteOrigin: SITE_ORIGIN, tokenUrl: SITE_ORIGIN === "" ? "" : `${SITE_ORIGIN}/token` };

export const syncConfig = (): SyncConfig => current;

export const siteOrigin = (): string => current.siteOrigin;

/** 网页登录的 redirect_uri：授权请求、记下的 state、交给 Worker 换 token 都用它，不取当前页面地址。必须和 OAuth App 登记的 Authorization callback URL 逐字符一致（含结尾的 /），不然 GitHub 报「The redirect_uri is not associated with this application」。 */
export const oauthCallbackUrl = (): string => `${current.siteOrigin}/`;

/** 登录要的配置齐不齐：macOS 只要 client id，网页还要站点来源（`web`）。 */
export const syncConfigured = (web: boolean): boolean => current.clientId !== "" && (!web || current.siteOrigin !== "");

/** 只给测试用：换一套配置（测试的入口在 import 应用之前调）。 */
export function setSyncConfigForTests(next: SyncConfig) {
  current = next;
}
