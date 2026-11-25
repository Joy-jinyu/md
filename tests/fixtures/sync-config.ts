/** 同步测试用的配置：测试不用真的配置，换成假的 client id 和 Worker 地址。必须在应用之前 import。 */
import { setSyncConfigForTests } from "../../src/sync/config";

/** 假的 Worker 地址。请求要过 nsh.json 的 `capabilities.network.hosts` 才能被测试接住，所以借一个已经放行的域名（不去连真的 Worker）。 */
export const TEST_WORKER = "https://api.github.com/test-auth-worker";

setSyncConfigForTests({ clientId: "test-client", workerUrl: TEST_WORKER });
