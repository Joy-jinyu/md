/** 装成后台服务的网关自己更新：有页面连上来时看一眼站点上的版本号，不一样就在后台下载，等没有页面连着了再退出，由 launchd 拉起新版。 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describeError } from "./errors.mts";
import { OFFICIAL_ORIGIN } from "./protocol.ts";

/** 两次检查至少隔这么久：开一个页面会连好几次，不用每次都问。 */
const CHECK_EVERY_MS = 10 * 60 * 1000;
const VERSION = /^[0-9a-f]{7,64}$/;

const text = (path: string) => readFile(path, "utf8").then((s) => s.trim(), () => "");

/** 返回「现在连着几个页面」的回调，交给 startGateway 的 onClients。`root` 是安装目录（~/.pairdown）。 */
export function autoUpdater(root: string, log: (s: string) => void): (clients: number) => void {
  let clients = 0;
  let checkedAt = 0;
  let ready = false;
  const restartIfIdle = () => {
    if (!ready || clients > 0) return;
    log("新版已下载，重启换上");
    process.exit(0);
  };
  const check = async () => {
    const config = JSON.parse((await text(join(root, "config.json"))) || "{}") as { autoUpdate?: boolean };
    if (config.autoUpdate === false) return;
    const res = await fetch(`${process.env.PAIRDOWN_SITE ?? OFFICIAL_ORIGIN}/gateway.version`, { signal: AbortSignal.timeout(5000) });
    const latest = res.ok ? (await res.text()).trim() : "";
    if (!VERSION.test(latest) || latest === (await text(join(root, "version")))) return;
    log(`有新版 ${latest.slice(0, 7)}，后台下载`);
    await new Promise<void>((done, fail) =>
      execFile("sh", [join(root, "gateway", "install.sh"), "fetch"], { env: { ...process.env, PAIRDOWN_HOME: root } }, (e) => (e ? fail(e) : done())),
    );
    ready = true;
    restartIfIdle();
  };
  return (count) => {
    clients = count;
    restartIfIdle();
    if (count === 0 || ready || Date.now() - checkedAt < CHECK_EVERY_MS) return;
    checkedAt = Date.now();
    check().catch((e) => log(`检查更新没成功：${describeError(e)}`));
  };
}
