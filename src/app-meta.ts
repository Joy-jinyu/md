/**
 * 网页版编辑页给搜索引擎和分享卡片的标题、描述（英文）。唯一来源：App.tsx 的 `<Head>` 运行时用，
 * scripts/seo.mjs 打包时写进静态 index.html（不跑 JS 的分享预览只读得到静态的）。
 * nsh 的 `<Head>` 不认页面里已有的标签，会再加一份，两边取同一个值才不会出现内容不同的两条。
 * 这个文件不能引 nsh：Node 直接 import 它。
 */
export const APP_TITLE = "Pairdown — WYSIWYG Markdown Editor Online";
export const APP_DESCRIPTION =
  "A WYSIWYG Markdown editor in your browser. Documents stay plain .md files, with tables, math, footnotes, Mermaid diagrams and optional GitHub sync.";
