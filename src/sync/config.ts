/**
 * 同步的配置：GitHub OAuth App 的 client id 和网页版换 token 的中转 Worker 地址。没配齐（`syncConfigured`）时顶栏的同步入口和命令面板的「同步…」都不出现，
 * 设置页的「同步」页签照样在，写明没配置、怎么配。
 * client secret 不在这里、也不能出现在仓库和前端包里：它只放在 Worker 的 secret 里（worker/README.md）。
 * Worker 的域名要在 nsh.json 的 `capabilities.network.hosts` 里（网页的 connect-src 也由它生成）；换地址时两处一起改。
 */

/** GitHub OAuth App 的 client id（公开值，不是密钥）。建 App 的设置见 worker/README.md。 */
export const GITHUB_CLIENT_ID = "Ov23liULOP1R8U49R9od";
/** OAuth App 登记的回调地址所在的源：GitHub 只肯把网页登录送回这里，别的页面（本机开发页）发起也登不上。换域名时和 App 设置一起改。 */
export const OAUTH_CALLBACK_ORIGIN = "https://markdown.pairwise.site";
/** 网页登录的 redirect_uri：授权请求、记下的 state、交给 Worker 换 token 都用它，不取当前页面地址。必须和 OAuth App 登记的 Authorization callback URL 逐字符一致（含结尾的 /），不然 GitHub 报「The redirect_uri is not associated with this application」。 */
export const OAUTH_CALLBACK_URL = `${OAUTH_CALLBACK_ORIGIN}/`;
/** 中转 Worker 的地址（`https://…`，不带结尾的 /）：网页版拿 code 换 token 时调它的 `/token`。 */
export const AUTH_WORKER_URL = "https://pairdown-auth.1825326327.workers.dev";

export const OAUTH_SCOPE = "gist";
export const GITHUB_API = "https://api.github.com";
export const DEVICE_CODE_URL = "https://github.com/login/device/code";
export const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

export interface SyncConfig {
  clientId: string;
  workerUrl: string;
}

let current: SyncConfig = { clientId: GITHUB_CLIENT_ID, workerUrl: AUTH_WORKER_URL };

export const syncConfig = (): SyncConfig => current;

/** 登录要的配置齐不齐：macOS 只要 client id，网页还要 Worker 地址（`web`）。 */
export const syncConfigured = (web: boolean): boolean => current.clientId !== "" && (!web || current.workerUrl !== "");

/** 只给测试用：换一套配置（测试的入口在 import 应用之前调）。 */
export function setSyncConfigForTests(next: SyncConfig) {
  current = next;
}
