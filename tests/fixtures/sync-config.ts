/** 同步测试用的配置：测试不用真的部署配置，换成假的 client id、站点和换 token 的地址。必须在应用之前 import。 */
import { setSyncConfigForTests } from "../../src/sync/config";

/** 假的站点来源（OAuth 回调地址是它加 /）。 */
export const TEST_SITE = "https://pairdown.example";
/** 假的换 token 地址。请求要过 nsh.json 的 `capabilities.network.hosts` 才能被测试接住，所以借一个已经放行的域名（不去连真的站点）。 */
export const TEST_TOKEN_URL = "https://api.github.com/test-auth-worker/token";

setSyncConfigForTests({ clientId: "test-client", siteOrigin: TEST_SITE, tokenUrl: TEST_TOKEN_URL });
