import { homedir } from "node:os";
import { join } from "node:path";
import { allowedOrigins } from "./auth.mts";
import { parseCli, USAGE } from "./cli.mts";
import { Library } from "./library.mts";
import { LISTEN_HOST } from "./protocol.ts";
import { startGateway } from "./server.mts";
import { autoUpdater, readInstall } from "./update.mts";

const parsed = parseCli(process.argv.slice(2));
if (parsed.kind === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (parsed.kind === "error") {
  console.error(`${parsed.message}\n\n${USAGE}`);
  process.exit(2);
}

const { options } = parsed;
const library = await Library.open(options.library).catch((e: Error) => {
  console.error(`打不开文库：${e.message}`);
  process.exit(1);
});
// 只有装成后台服务（install.sh）才带这个环境变量；从源码直接跑不自动更新，也不读安装时记下的站点
const managedRoot = process.env.PAIRDOWN_HOME;
const site = managedRoot ? (await readInstall(managedRoot)).site : undefined;
if (managedRoot && !site) console.error("配置里没有站点，线上页面连不上：pairdown config site <站点地址>");
const origins = allowedOrigins(site, options.origins);
if (origins.length === 0) console.error("没有放行任何页面来源：从源码跑时用 --origin <来源> 加上");
const onClients = managedRoot ? autoUpdater(managedRoot, (s) => console.log(s)) : undefined;
const configPath = join(managedRoot ?? join(homedir(), ".pairdown"), "config.json");
const gateway = await startGateway({ library, port: options.port, origins, onClients, configPath }).catch((e: Error) => {
  console.error(`启动失败：${e.message}`);
  process.exit(1);
});
console.log(`Pairdown 网关：ws://${LISTEN_HOST}:${gateway.port}  文库：${library.root}`);
console.log(`放行的页面来源：${origins.join("、")}`);

const stop = () => void gateway.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
