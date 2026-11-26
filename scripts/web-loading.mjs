import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error("用法：node scripts/web-loading.mjs <产物目录>");

const assetDir = new URL("../assets/web-loading/", import.meta.url);
const destination = join(outDir, "loading");
cpSync(assetDir, destination, { recursive: true });

const { cssVars } = JSON.parse(readFileSync(new URL("../theme.json", import.meta.url), "utf8"));
function colors(theme) {
  return `--pd-loader-bg: ${theme.background}; --pd-loader-fg: ${theme.foreground}; --pd-loader-ink: ${theme.primary};`;
}
const themeCss = `:root { ${colors(cssVars.light)} }
@media (prefers-color-scheme: dark) { :root { ${colors(cssVars.dark)} } }
`;
writeFileSync(join(destination, "loader.css"), themeCss + readFileSync(new URL("loader.css", assetDir), "utf8"));

// 编辑页的界面语言：nsh 的 Storage 在网页上是 localStorage，键名「nsh:<应用 id>:<键>」（2026-11-26 在打包产物里实测）；
// 设置键见 src/store/settings.ts 的 SETTINGS_KEY
const { id: appId } = JSON.parse(readFileSync(new URL("../nsh.json", import.meta.url), "utf8"));
const settingsKey = `nsh:${appId}:md.settings`;

const styles = '<link rel="stylesheet" href="/loading/loader.css">';
const script = '<script src="/loading/loader.js"></script>';

for (const [file, page] of [["index.html", "editor"], ["lp/index.html", "journal"]]) {
  const outputPath = join(outDir, file);
  const html = readFileSync(outputPath, "utf8");
  if (!html.includes("</head>") || !html.includes("<body>")) {
    throw new Error(`无法在 ${file} 的 head 和 body 中加入加载界面`);
  }
  const overlay = `
<div id="pairdown-loader" class="pd-loader" data-page="${page}"${page === "editor" ? ` data-settings="${settingsKey}"` : ""}>
  <div class="pd-loader__figure" role="status">
    <span class="pd-loader__label" data-zh="正在载入 Pairdown">Loading Pairdown</span>
    <span class="pd-loader__ink" aria-hidden="true"></span>
    <img class="pd-loader__quill" src="/loading/feather.webp" alt="" width="660" height="552">
  </div>
  <div class="pd-loader__failure" role="alert">
    <p data-zh="Pairdown 没能加载完。">Pairdown could not finish loading.</p>
    <a href="" data-zh="重新加载页面">Reload the page</a>
  </div>
</div>
`;
  const withLoader = html.replace("</head>", `${styles}\n${script}\n</head>`).replace("<body>", `<body>\n${overlay}`);
  writeFileSync(outputPath, withLoader);
  // nsh package 给 index.html 预生成了 .gz / .br，不跟着重写就会有服务器发出没有加载层的旧页面
  if (existsSync(`${outputPath}.gz`)) writeFileSync(`${outputPath}.gz`, gzipSync(withLoader, { level: 9 }));
  if (existsSync(`${outputPath}.br`)) writeFileSync(`${outputPath}.br`, brotliCompressSync(withLoader));
}
