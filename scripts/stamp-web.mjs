/**
 * 把部署配置写进网页产物里的两个文件：`node scripts/stamp-web.mjs <产物目录>`，make build-web 末尾调。
 * - `gateway.sh`（仓库里的 gateway/install.sh）：`__PAIRDOWN_SITE__` 换成站点、`__PAIRDOWN_REPO__` 换成网关源码仓库；
 * - `lp/index.html`（落地页）：`__PAIRDOWN_REPO__` 换成源码仓库。
 * 没配的值留着占位并提示：这样打出的 gateway.sh 装不了（install.sh 会说明原因），落地页的源码链接也是坏的。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repo, site } from "./deploy-config.mjs";

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error("用法：node scripts/stamp-web.mjs <产物目录>");

const values = { __PAIRDOWN_SITE__: site(), __PAIRDOWN_REPO__: repo() };
for (const file of ["gateway.sh", "lp/index.html"]) {
  const path = join(outDir, file);
  const text = Object.entries(values).reduce((t, [mark, value]) => (value === "" ? t : t.replaceAll(mark, value)), readFileSync(path, "utf8"));
  writeFileSync(path, text);
  const left = Object.keys(values).filter((mark) => text.includes(mark));
  if (left.length > 0) console.warn(`${path} 里还留着 ${left.join("、")}：没配 PAIRDOWN_SITE / PAIRDOWN_REPO（见 .env.example）`);
}
