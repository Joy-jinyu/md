/**
 * 部署配置的唯一读取和校验处（变量说明见 `.env.example`）：shell 里设了的为准（设成空也算设了），没设的从仓库根的 `.env` 补。
 * app-config.mjs、stamp-web.mjs、Makefile 的发布都从这里取值。
 * 命令行：`node scripts/deploy-config.mjs host`（站点的主机名）、`client-id`，没配时报错退出。
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const ENV_FILE = new URL("../.env", import.meta.url);
const file = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, "utf8")) : {};
const raw = (name) => process.env[name] ?? file[name] ?? "";

/** 站点会原样写进 gateway.sh 的 shell 双引号里，所以只收小写主机名和端口这几种字符（挡住 `$(…)`、反引号、引号）。 */
const SITE = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/;
/** 和 gateway/src/update.mts 的 `isRepo` 同一条规则：用户名只有字母、数字、连字符；仓库名不以点开头（挡住 `..`）。 */
const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const CLIENT_ID = /^[A-Za-z0-9.]+$/;

/** 站点来源，`https://主机`（本机调试可以是 http 的回环地址），不带路径和结尾的 /。没配是空字符串。 */
export function site() {
  const v = raw("PAIRDOWN_SITE");
  if (v === "") return "";
  const url = SITE.test(v) ? new URL(v) : null;
  const local = url?.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (!url || url.origin !== v || (url.protocol !== "https:" && !local)) throw new Error(`PAIRDOWN_SITE 要写成 https://主机（小写，不带路径和结尾的 /）：${v}`);
  return v;
}

export function clientId() {
  const v = raw("PAIRDOWN_GITHUB_CLIENT_ID");
  if (v !== "" && !CLIENT_ID.test(v)) throw new Error(`PAIRDOWN_GITHUB_CLIENT_ID 只能有字母、数字和点：${v}`);
  return v;
}

export function repo() {
  const v = raw("PAIRDOWN_REPO");
  if (v !== "" && !REPO.test(v)) throw new Error(`PAIRDOWN_REPO 要写成 用户/仓库：${v}`);
  return v;
}

/** 作者（可选，两项一起配）：落地页页脚链回作者主页，结构化数据的 author 也用它。URL 只收 https 来源，不带路径。 */
export function author() {
  const name = raw("PAIRDOWN_AUTHOR_NAME");
  const url = raw("PAIRDOWN_AUTHOR_URL");
  if (name === "" && url === "") return null;
  if (name === "" || url === "") throw new Error("PAIRDOWN_AUTHOR_NAME 和 PAIRDOWN_AUTHOR_URL 要一起配");
  if (!/^[^<>&"]{1,60}$/.test(name)) throw new Error(`PAIRDOWN_AUTHOR_NAME 不能有 < > & " 且不超过 60 字：${name}`);
  if (!SITE.test(url) || !url.startsWith("https://") || new URL(url).origin !== url) throw new Error(`PAIRDOWN_AUTHOR_URL 要写成 https://主机（小写，不带路径和结尾的 /）：${url}`);
  return { name, url };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [what] = process.argv.slice(2);
  const value = what === "host" ? site() && new URL(site()).host : what === "client-id" ? clientId() : null;
  if (value === null) throw new Error("用法：node scripts/deploy-config.mjs host|client-id");
  if (value === "") {
    console.error(`没配 ${what === "host" ? "PAIRDOWN_SITE" : "PAIRDOWN_GITHUB_CLIENT_ID"}（.env 或环境变量，见 .env.example）`);
    process.exit(1);
  }
  console.log(value);
}
