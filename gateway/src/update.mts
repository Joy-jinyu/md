/** 装成后台服务的网关自己更新：有页面连上来时看一眼站点上的版本号，不一样就在后台下载，等没有页面连着了再退出，由 launchd 拉起新版。 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isOrigin } from "./auth.mts";
import { describeError } from "./errors.mts";

/** 两次检查至少隔这么久：开一个页面会连好几次，不用每次都问。 */
const CHECK_EVERY_MS = 10 * 60 * 1000;
const VERSION = /^[0-9a-f]{7,64}$/;

const text = (path: string) => readFile(path, "utf8").then((s) => s.trim(), () => "");

/** GitHub 的「用户/仓库」写法：拼进下载地址前先过它。 */
export const isRepo = (s: string): boolean => /^[A-Za-z0-9-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(s);

/** 安装时记下的：从哪个站点装的（`site`，也是网关放行的页面来源）、从哪个仓库更新（`repo`），以及要不要自动更新。写法不对的值当没有。 */
export async function readInstall(root: string): Promise<{ site?: string; repo?: string; autoUpdate: boolean }> {
  let config: { site?: unknown; repo?: unknown; autoUpdate?: unknown } = {};
  try {
    config = JSON.parse((await text(join(root, "config.json"))) || "{}") as typeof config;
  } catch (e) {
    // 配置坏了也要能起来（不然 launchd 反复拉起又崩）：当作没记站点，启动时会提示
    console.error(`config.json 读不了：${describeError(e)}`);
  }
  const site = typeof config.site === "string" && isOrigin(config.site) ? config.site : undefined;
  const repo = typeof config.repo === "string" && isRepo(config.repo) ? config.repo : undefined;
  return { site, repo, autoUpdate: config.autoUpdate !== false };
}

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
    const { site, repo, autoUpdate } = await readInstall(root);
    if (!autoUpdate) return;
    if (!site || !repo) return log("没法自动更新：配置里没有站点或源码仓库（pairdown config site <地址>、pairdown config repo <用户/仓库>）");
    const res = await fetch(`${site}/gateway.version`, { signal: AbortSignal.timeout(5000) });
    const latest = res.ok ? (await res.text()).trim() : "";
    if (!VERSION.test(latest) || latest === (await text(join(root, "version")))) return;
    log(`有新版 ${latest.slice(0, 7)}，后台下载`);
    await new Promise<void>((done, fail) =>
      execFile("sh", [join(root, "gateway", "install.sh"), "fetch"], { env: { ...process.env, PAIRDOWN_HOME: root, PAIRDOWN_SITE: site, PAIRDOWN_REPO: repo } }, (e) => (e ? fail(e) : done())),
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
