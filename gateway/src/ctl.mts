/** `pairdown` 命令：管装好的本机网关（macOS，launchd 后台服务）——看状态、看和改配置、启停、更新、卸载。由 install.sh 装的包装脚本调。 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isOrigin } from "./auth.mts";
import { GatewayError } from "./errors.mts";
import { parseImageHost, type ImageHost } from "./image-host.mts";
import { DEFAULT_PORT, LISTEN_HOST } from "./protocol.ts";

type Config = { library: string; port: number; origins: string[]; autoUpdate: boolean; imageHost?: ImageHost };

const ROOT = process.env.PAIRDOWN_HOME ?? join(homedir(), ".pairdown");
const LABEL = process.env.PAIRDOWN_LABEL ?? "site.pairwise.md.gateway";
const CONFIG = join(ROOT, "config.json");
const LOG = join(ROOT, "gateway.log");
const PLIST = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const DOMAIN = `gui/${userInfo().uid}`;
const DEFAULTS: Config = { library: join(homedir(), "Documents", "Pairdown"), port: DEFAULT_PORT, origins: [], autoUpdate: true };

const HELP = [
  "用法：pairdown <命令>",
  "",
  "  status                      网关在不在跑、文库在哪（不写命令也是它）",
  "  config                      看配置",
  "  config library <文件夹>     换文库文件夹（没有就建），改完自动重启",
  "  config origins <来源,来源>  额外放行的页面来源（比如 http://127.0.0.1:8811）；写 none 清空",
  "  config port <端口>          换端口（线上页面只连 7341，一般不用改）",
  "  config autoUpdate on|off    有新版时要不要自动更新",
  "  config imageHost <上传地址>   设置图床（收 multipart 上传的接口）；写 none 不再用图床",
  "  config imageHostField <名字>  放图片的表单字段名（默认 file）",
  "  config imageHostHeader <头>   上传时带的请求头，如 \"Authorization: Bearer xxx\"；写 none 清空",
  "  config imageHostUrlPath <位置> 返回的 JSON 里图片地址在哪，如 data.url；写 auto 自动找",
  "  start | stop | restart      启动、停止、重启后台网关",
  "  logs                        看最近的日志",
  "  update                      现在就更新到最新版",
  "  uninstall                   停掉并删除网关（文库里的文档不动）",
].join("\n");

class Refusal extends Error {}

const readConfig = (): Config => ({ ...DEFAULTS, ...(existsSync(CONFIG) ? (JSON.parse(readFileSync(CONFIG, "utf8")) as Partial<Config>) : {}) });
// 只有自己能读：图床的请求头里可能是密钥
const writeConfig = (c: Config) => writeFileSync(CONFIG, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
const launchctl = (...args: string[]) => spawnSync("launchctl", args, { encoding: "utf8" });
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function plist(c: Config): string {
  const args = [process.execPath, join(ROOT, "gateway", "src", "main.mts"), "--library", c.library, "--port", String(c.port), ...c.origins.flatMap((o) => ["--origin", o])];
  const env = { PAIRDOWN_HOME: ROOT, PATH: `${dirname(process.execPath)}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin` };
  const strings = (list: string[]) => list.map((s) => `<string>${xml(s)}</string>`).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>Label</key><string>${xml(LABEL)}</string>`,
    `<key>ProgramArguments</key><array>${strings(args)}</array>`,
    `<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k, v]) => `<key>${k}</key><string>${xml(v)}</string>`).join("")}</dict>`,
    "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>",
    `<key>StandardOutPath</key><string>${xml(LOG)}</string><key>StandardErrorPath</key><string>${xml(LOG)}</string>`,
    "</dict></plist>",
    "",
  ].join("\n");
}

const running = () => /state = running/.test(launchctl("print", `${DOMAIN}/${LABEL}`).stdout ?? "");

/** 装上以后进程要一小会儿才起来，等到它在跑（最多 3 秒）再往下报状态。 */
function waitRunning() {
  for (let i = 0; i < 10 && !running(); i++) spawnSync("sleep", ["0.3"]);
}

function stop() {
  launchctl("bootout", `${DOMAIN}/${LABEL}`);
}

function start() {
  if (process.platform !== "darwin") throw new Refusal("后台运行现在只支持 macOS");
  const c = readConfig();
  mkdirSync(c.library, { recursive: true });
  mkdirSync(dirname(PLIST), { recursive: true });
  writeFileSync(PLIST, plist(c));
  stop();
  // 刚停掉的服务要过一会儿才真的卸下，这时装会报 Input/output error：等一等再试
  for (let i = 0; i < 20; i++) {
    if (launchctl("bootstrap", DOMAIN, PLIST).status === 0) return waitRunning();
    spawnSync("sleep", ["0.3"]);
  }
  throw new Refusal(`没能启动后台网关，看日志：${LOG}`);
}

function status() {
  const c = readConfig();
  console.log(running() ? `Pairdown 网关：在后台运行（ws://${LISTEN_HOST}:${c.port}，登录后自动启动）` : `Pairdown 网关：没在运行（pairdown start 启动；起不来看 pairdown logs）`);
  showConfig(c);
  console.log(`日志：${LOG}\n更多命令：pairdown help`);
}

function showConfig(c: Config) {
  console.log(`文库文件夹（library）：${c.library}`);
  console.log(`端口（port）：${c.port}`);
  console.log(`额外放行的页面（origins）：${c.origins.length > 0 ? c.origins.join(",") : "无"}`);
  console.log(`自动更新（autoUpdate）：${c.autoUpdate ? "on" : "off"}`);
  const h = c.imageHost;
  console.log(`图床（imageHost）：${h ? h.url : "没有设置"}`);
  if (!h) return;
  console.log(`  文件字段名（imageHostField）：${h.field}`);
  console.log(`  请求头（imageHostHeader，只显示名字）：${Object.keys(h.headers).join(",") || "无"}`);
  console.log(`  图片地址的位置（imageHostUrlPath）：${h.urlPath || "auto"}`);
}

/** 改图床的一项。请求头只留一条：再设一次就是换掉。 */
function hostChanged(c: Config, key: string, value: string): Config {
  if (key === "imageHost" && value === "none") {
    const { imageHost: _gone, ...rest } = c;
    return rest;
  }
  if (key !== "imageHost" && !c.imageHost) throw new Refusal("先设置上传地址：pairdown config imageHost <上传地址>");
  const at = value.indexOf(":");
  if (key === "imageHostHeader" && value !== "none" && at <= 0) throw new Refusal('请求头要写成 "名字: 值"');
  const patch =
    key === "imageHost" ? { url: value }
    : key === "imageHostField" ? { field: value }
    : key === "imageHostUrlPath" ? { urlPath: value === "auto" ? "" : value }
    : { headers: value === "none" ? {} : { [value.slice(0, at).trim()]: value.slice(at + 1).trim() } };
  try {
    return { ...c, imageHost: parseImageHost({ ...c.imageHost, ...patch }, null) };
  } catch (e) {
    throw e instanceof GatewayError ? new Refusal(e.message) : e;
  }
}

function changed(c: Config, key: string, value: string): Config {
  if (key.startsWith("imageHost")) return hostChanged(c, key, value);
  if (key === "library") return { ...c, library: resolve(value.replace(/^~(?=\/|$)/, homedir())) };
  if (key === "port") {
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Refusal(`端口不合法：${value}`);
    return { ...c, port };
  }
  if (key === "origins") {
    const origins = value === "none" ? [] : value.split(",");
    const bad = origins.filter((o) => !isOrigin(o));
    if (bad.length > 0) throw new Refusal(`来源不合法：${bad.join(",")}（要写成 http(s)://主机[:端口]）`);
    return { ...c, origins };
  }
  if (key === "autoUpdate" && (value === "on" || value === "off")) return { ...c, autoUpdate: value === "on" };
  throw new Refusal(`不认识的配置：${key} ${value}\n\n${HELP}`);
}

function config(key?: string, value?: string) {
  if (key === undefined) return showConfig(readConfig());
  if (value === undefined) throw new Refusal(`缺少要改成的值\n\n${HELP}`);
  writeConfig(changed(readConfig(), key, value));
  // autoUpdate、图床，网关每次用时现读，不用重启
  if (key !== "autoUpdate" && !key.startsWith("imageHost")) start();
  showConfig(readConfig());
}

/** install.sh 第一次装完调：参数和网关的一样（--library、--origin），写成配置后启动。 */
function setup(args: string[]) {
  let c = readConfig();
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === "--library") c = changed(c, "library", args[i + 1] ?? "");
    else if (args[i] === "--origin") c = changed(c, "origins", [...c.origins, args[i + 1] ?? ""].join(","));
    else if (args[i] === "--port") c = changed(c, "port", args[i + 1] ?? "");
    else throw new Refusal(`不认识的参数：${args[i]}`);
  }
  writeConfig(c);
  start();
  console.log("装好了。");
  status();
}

function update() {
  execFileSync("sh", [join(ROOT, "gateway", "install.sh"), "fetch"], { stdio: "inherit", env: { ...process.env, PAIRDOWN_HOME: ROOT } });
  start();
  console.log("已更新并重启。");
}

function uninstall() {
  stop();
  rmSync(PLIST, { force: true });
  const link = join(ROOT, "link");
  if (existsSync(link)) rmSync(readFileSync(link, "utf8").trim(), { force: true });
  const { library } = readConfig();
  rmSync(ROOT, { recursive: true, force: true });
  console.log(`已卸载。文库里的文档没动：${library}`);
}

const [command = "status", ...rest] = process.argv.slice(2);
const commands: Record<string, () => void> = {
  status,
  config: () => config(rest[0], rest[1]),
  setup: () => setup(rest),
  start: () => (start(), status()),
  stop: () => (stop(), console.log("已停止。pairdown start 再启动")),
  restart: () => (start(), status()),
  logs: () => void spawnSync("tail", ["-n", "50", LOG], { stdio: "inherit" }),
  update,
  uninstall,
  help: () => console.log(HELP),
};
try {
  if (!Object.hasOwn(commands, command)) throw new Refusal(`不认识的命令：${command}\n\n${HELP}`);
  commands[command]();
} catch (e) {
  if (!(e instanceof Refusal)) throw e;
  console.error(e.message);
  process.exit(2);
}
