/** 没配同步的应用入口（测试 `open("./fixtures/sync-unconfigured-app.tsx")`）：先把配置清空，再启动应用。 */
import { setSyncConfigForTests } from "../../src/sync/config";

setSyncConfigForTests({ clientId: "", workerUrl: "" });

await import("../../App");
