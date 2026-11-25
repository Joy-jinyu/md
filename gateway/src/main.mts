import { allowedOrigins } from "./auth.mts";
import { parseCli, USAGE } from "./cli.mts";
import { Library } from "./library.mts";
import { LISTEN_HOST } from "./protocol.ts";
import { startGateway } from "./server.mts";

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
const origins = allowedOrigins(options.origins);
const gateway = await startGateway({ library, port: options.port, origins }).catch((e: Error) => {
  console.error(`启动失败：${e.message}`);
  process.exit(1);
});
console.log(`Pairdown 网关：ws://${LISTEN_HOST}:${gateway.port}  文库：${library.root}`);
console.log(`放行的页面来源：${origins.join("、")}`);

const stop = () => void gateway.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
