/**
 * 给网页产物补搜索引擎要的东西：`node scripts/seo.mjs <产物目录>`，make build-web 在 web-loading 之后、stamp-web 之前调。
 * - `robots.txt`、`sitemap.xml`：站点是单页应用，找不到的路径都回编辑页，不写真文件这两个地址拿到的是 HTML；
 * - 编辑页 `index.html`（nsh 生成，源码里改不了）：标题、描述、canonical、分享卡片，noscript 里给一句介绍和落地页链接；
 * - 编辑页和落地页共用的结构化数据（WebApplication）只在这里生成；落地页自己的标题、描述、canonical 写在 landing/index.html。
 * 站点地址取部署配置 PAIRDOWN_SITE；没配时只写不含地址的 robots.txt，其余跳过并提示。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { APP_DESCRIPTION as DESCRIPTION, APP_TITLE as TITLE } from "../src/app-meta.ts";
import { author, repo, site } from "./deploy-config.mjs";

/** 和 landing/index.html 的 og:image 是同一张图（landing/og.png，源文件 assets/og/og.html） */
const OG_IMAGE = "/lp/og.png";

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error("用法：node scripts/seo.mjs <产物目录>");

const origin = site();
const owner = author();

const escapeAttr = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
// JSON 放进 <script> 里：把 < 转义掉，内容里出现 </script> 也截不断
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;

function application() {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "@id": `${origin}/#app`,
    name: "Pairdown",
    url: `${origin}/`,
    description: DESCRIPTION,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and WebAssembly",
    inLanguage: "en",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    image: `${origin}${OG_IMAGE}`,
    featureList: [
      "WYSIWYG Markdown editing with a source view",
      "Plain .md files; unchanged blocks are written back byte for byte",
      "Tables, TeX math, footnotes and Mermaid diagrams",
      "Edit .md files in a folder on your computer through a local gateway",
      "Sync through secret GitHub Gists",
      "Open and save .md files, export HTML",
    ],
    ...(owner ? { author: { "@type": "Person", name: owner.name, url: `${owner.url}/` } } : {}),
    ...(repo() ? { sameAs: [`https://github.com/${repo()}`] } : {}),
  };
}

function editorHead() {
  const url = `${origin}/`;
  const meta = [
    `<meta name="description" content="${escapeAttr(DESCRIPTION)}">`,
    `<link rel="canonical" href="${url}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Pairdown">',
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${escapeAttr(TITLE)}">`,
    `<meta property="og:description" content="${escapeAttr(DESCRIPTION)}">`,
    `<meta property="og:image" content="${origin}${OG_IMAGE}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
  ];
  return meta.join("\n");
}

/** 改写一个页面，有 nsh 预生成的 .gz / .br 就跟着重写（否则服务器可能发出改之前的页面） */
function rewrite(file, change) {
  const path = join(outDir, file);
  const html = change(readFileSync(path, "utf8"));
  writeFileSync(path, html);
  if (existsSync(`${path}.gz`)) writeFileSync(`${path}.gz`, gzipSync(html, { level: 9 }));
  if (existsSync(`${path}.br`)) writeFileSync(`${path}.br`, brotliCompressSync(html));
}

function replaceOnce(html, from, to, file) {
  if (!html.includes(from)) throw new Error(`${file} 里找不到 ${from}：nsh 生成的页面变了，改 scripts/seo.mjs`);
  // 用函数给替换值：字符串里的 $& $' 之类会被 replace 当成特殊写法
  return html.replace(from, () => to);
}

const robots = ["User-agent: *", "Allow: /", "Disallow: /token", ...(origin ? ["", `Sitemap: ${origin}/sitemap.xml`] : []), ""];
writeFileSync(join(outDir, "robots.txt"), robots.join("\n"));

if (origin === "") {
  console.warn("没配 PAIRDOWN_SITE（见 .env.example）：robots.txt 不写 Sitemap，不生成 sitemap.xml，页面不加 canonical 和结构化数据");
} else {
  const urls = [`${origin}/`, `${origin}/lp/`].map((loc) => `  <url><loc>${loc}</loc></url>`);
  const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, "</urlset>", ""];
  writeFileSync(join(outDir, "sitemap.xml"), sitemap.join("\n"));

  const data = jsonLd(application());
  rewrite("index.html", (html) => {
    const titled = replaceOnce(html, "<title>Pairdown</title>", `<title>${TITLE}</title>\n${editorHead()}`, "index.html");
    const described = replaceOnce(
      titled,
      '<div id="nojs">Pairdown needs JavaScript.</div>',
      `<div id="nojs"><p>Pairdown is a WYSIWYG Markdown editor that runs in your browser and needs JavaScript.</p><p><a href="/lp/">Read about Pairdown</a></p></div>`,
      "index.html",
    );
    return replaceOnce(described, "</head>", `${data}\n</head>`, "index.html");
  });
  rewrite("lp/index.html", (html) => replaceOnce(html, "</head>", `${data}\n</head>`, "lp/index.html"));
}

// 作者链接是可选配置，没配就把占位注释去掉
rewrite("lp/index.html", (html) =>
  replaceOnce(
    html,
    "<!-- pairdown:author -->",
    owner ? `<a href="${escapeAttr(owner.url)}/">Made by ${escapeAttr(owner.name)}</a>` : "",
    "lp/index.html",
  ),
);
console.log(`写好了 ${join(outDir, "robots.txt")}${origin ? "、sitemap.xml，编辑页和落地页的 head" : ""}`);
