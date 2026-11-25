/**
 * 导出的 HTML 里内联的排版 CSS：照编辑页的字号和间距（DESIGN.md「字号」），明暗跟随系统。
 * 颜色只用 CSS 的系统色（Canvas、CanvasText、LinkText…）和它们按比例混出来的浅色：导出的文件拿不到 theme.json，
 * 系统色在浅色、深色外观下由浏览器自己给两套，不用写死任何色值。
 */
const mix = (percent: number) => `color-mix(in srgb, CanvasText ${percent}%, Canvas)`;

export const HTML_STYLE = `
:root { color-scheme: light dark; --muted: ${mix(6)}; --border: ${mix(14)}; --border-strong: ${mix(28)}; --soft: ${mix(62)}; }
* { box-sizing: border-box; }
body { margin: 0; background: Canvas; color: CanvasText; font: 17px/30px -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif; -webkit-text-size-adjust: 100%; }
main.doc { max-width: 760px; margin: 0 auto; padding: 40px 32px 120px; overflow-wrap: break-word; }
p, ul, ol, blockquote, figure, .table, .alert, nav.toc { margin: 12px 0; }
h1, h2, h3, h4, h5, h6 { margin: 32px 0 6px; font-weight: 600; }
h1 { font-size: 30px; line-height: 40px; } h2 { font-size: 24px; line-height: 34px; } h3 { font-size: 20px; line-height: 30px; }
h4 { font-size: 18px; line-height: 28px; } h5 { font-size: 17px; line-height: 28px; } h6 { font-size: 15px; line-height: 26px; color: var(--soft); }
main.doc > :first-child { margin-top: 0; }
a { color: LinkText; text-underline-offset: 2px; } a:not([href]) { color: inherit; text-decoration: underline dotted; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
code { font-size: 15px; background: var(--muted); border-radius: 6px; padding: 1px 4px; }
pre { margin: 0; padding: 12px 16px; background: var(--muted); border-radius: 6px; overflow-x: auto; font-size: 14px; line-height: 22px; }
pre code { background: none; padding: 0; font-size: inherit; white-space: pre; }
figure { margin-left: 0; margin-right: 0; }
figcaption { font-size: 12px; line-height: 18px; color: var(--soft); margin-bottom: 4px; }
figure.source pre, figure.math-block pre { white-space: pre-wrap; }
code.math, code.raw { color: var(--soft); }
blockquote { margin-left: 0; margin-right: 0; padding-left: 16px; border-left: 3px solid var(--border-strong); color: var(--soft); }
.alert { padding: 4px 0 4px 16px; border-left: 3px solid var(--border-strong); }
.alert-title { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
.alert-note, .alert-tip, .alert-important { border-left-color: LinkText; } .alert-note .alert-title, .alert-tip .alert-title, .alert-important .alert-title { color: LinkText; }
.alert-warning, .alert-caution { border-left-color: CanvasText; } .alert-warning .alert-title::before, .alert-caution .alert-title::before { content: "⚠ "; }
ul.list, ol.list { padding-left: 24px; } li + li { margin-top: 4px; } .loose > li + li { margin-top: 12px; } li > p { margin: 0; } .loose > li > p { margin: 6px 0; }
ul.tasks { list-style: none; padding-left: 4px; } li.task > input { width: 16px; height: 16px; margin: 0 8px 0 0; vertical-align: -2px; } li.task > p:first-of-type { display: inline; }
.table { overflow-x: auto; } table { border-collapse: collapse; } th, td { border: 1px solid var(--border); padding: 8px 12px; vertical-align: top; } th { background: var(--muted); font-weight: 600; }
hr { border: 0; border-top: 1px solid var(--border-strong); margin: 32px 0; }
img { max-width: 100%; height: auto; } figure.diagram { text-align: center; } .missing { color: var(--soft); }
mark { background: Mark; color: MarkText; border-radius: 3px; padding: 0 2px; }
nav.toc { padding: 12px 16px; background: var(--muted); border-radius: 6px; } .toc-title { margin: 0 0 4px; font-weight: 600; } nav.toc ul { list-style: none; margin: 0; padding: 0; }
.toc-2 { padding-left: 16px; } .toc-3 { padding-left: 32px; } .toc-4 { padding-left: 48px; } .toc-5 { padding-left: 64px; } .toc-6 { padding-left: 80px; }
sup.fnref { font-size: 12px; line-height: 0; } sup.fnref a { text-decoration: none; } sup.fnref a::before { content: "["; } sup.fnref a::after { content: "]"; }
.footnotes { margin-top: 48px; font-size: 15px; line-height: 26px; color: var(--soft); } .footnotes hr { margin: 0 0 16px; } .fnlabel { font-weight: 600; } .fnback { text-decoration: none; }
@media (max-width: 480px) { main.doc { padding: 24px 16px 80px; } }
@media print { body { font-size: 12pt; line-height: 1.6; } main.doc { max-width: none; padding: 0; } a { color: inherit; } pre, figure, table, .alert, img { break-inside: avoid; } h1, h2, h3, h4 { break-after: avoid; } }
`;
