/**
 * 按部署配置写出 `src/app-config.gen.ts`（不提交）：`node scripts/app-config.mjs`，make 的 dev / check / test / build 前都先调。
 * 值从 scripts/deploy-config.mjs 取（环境变量为准，没设的读 `.env`；CI 来自仓库 secret）。
 * 没配时写空字符串：页面照常能用，只是不出同步入口、网关面板不给安装命令。
 */
import { writeFileSync } from "node:fs";
import { clientId, repo, site } from "./deploy-config.mjs";

const text = [
  "// 由 scripts/app-config.mjs 按部署配置生成，不提交，不要手改。",
  `export const SITE_ORIGIN: string = ${JSON.stringify(site())};`,
  `export const GITHUB_CLIENT_ID: string = ${JSON.stringify(clientId())};`,
  `export const REPO: string = ${JSON.stringify(repo())};`,
  "",
].join("\n");
writeFileSync(new URL("../src/app-config.gen.ts", import.meta.url), text);
