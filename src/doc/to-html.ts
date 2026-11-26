/**
 * 导出为 HTML：编辑器 JSON → 一个自包含的 .html（排版 CSS 内联，明暗跟随系统）。
 * 安全约定：所有文字和属性都转义；链接地址由调用方的 `linkHref` 判断能不能留（不能留的去掉 href，只留文字）；
 * 原文里的 HTML（HTML 块、行内 HTML）一律当文字显示，不原样输出；页面带 CSP，不许任何脚本。
 */
import { HTML_STYLE } from "./html-style";
import type { PMMark, PMNode } from "./types";

export interface HtmlOptions {
  /** 页面标题（<title>）。 */
  title: string;
  /** 界面附加的 HTML 标签使用的语言。 */
  language?: "en" | "zh-CN";
  /** 标题文字 → 锚点 id；和编辑器里跳锚点用同一个，导出的文档里 `[x](#标题)` 才跳得到。 */
  slug: (text: string) => string;
  /** 链接地址 → 能输出的 href；不能输出（javascript:、file: 这类）时是 null。 */
  linkHref: (href: string) => string | null;
  /** 提示块类型（note、tip…）→ 标签文字。 */
  alertLabel: (kind: string) => string;
  /** 脚注正文（一行 Markdown）→ 行内节点；和正文用同一个转换层读，所以这里只管写出。 */
  footnoteInline: (markdown: string) => PMNode[];
  /** Mermaid 源码 → 画好的图；没给或画不出（null）时导出源码。 */
  diagram?: (code: string) => DiagramPicture | null;
}

/** 画好的 Mermaid 图：浅色、深色各一张 SVG 的 data: 地址（base64），和图的大小。 */
export interface DiagramPicture {
  light: string;
  dark: string;
  width: number;
  height: number;
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** 文字和属性值都用它转义。 */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** 浏览器解析地址时会先删掉 Tab、换行，去掉首尾的控制字符和空格（`java&#9;script:` 照样是 javascript:）；判断协议前照样处理。 */
const cleanUrl = (url: string) => url.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");

/**
 * 图片地址：http(s)、data:image 和相对路径留着；javascript: 这类别的协议去掉。
 * blob: 只在编辑器这一次打开时有效，导出的文件里必然是坏图，也去掉。
 * 外链图片在导出页里照常加载（导出文件是给人看、打印的，见 DESIGN.md「导出」）。
 */
function imageSrc(raw: string): string | null {
  const src = cleanUrl(raw);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(src)?.[1]?.toLowerCase();
  if (!scheme) return src;
  if (scheme === "http" || scheme === "https") return src;
  return scheme === "data" && /^data:image\//i.test(src) ? src : null;
}

const FOOTNOTE_DEF = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*/;
/** 标题 id 由 slug 生成，slug 去掉了冒号，所以带冒号的脚注 id 不会和标题撞。 */
const footId = (label: string) => `fn:${label}`;
const footRefId = (label: string) => `fnref:${label}`;

/** 写一篇时的状态：标题 id 去重、脚注收集、每个脚注第一个引用带 id。 */
interface Ctx {
  opts: HtmlOptions;
  ids: Map<string, number>;
  headingIds: Map<PMNode, string>;
  notes: { label: string; text: string }[];
  refsSeen: Set<string>;
}

const MARK_TAGS: Record<string, string> = {
  bold: "strong",
  italic: "em",
  strike: "del",
  underline: "u",
  highlight: "mark",
  subscript: "sub",
  superscript: "sup",
  code: "code",
};
const MARK_ORDER = ["link", "bold", "italic", "strike", "underline", "highlight", "subscript", "superscript", "code"];

function sameMark(a: PMMark, b: PMMark) {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

function openTag(mark: PMMark, ctx: Ctx): string {
  if (mark.type !== "link") return `<${MARK_TAGS[mark.type]}>`;
  const href = ctx.opts.linkHref(cleanUrl(str(mark.attrs?.href)));
  const title = str(mark.attrs?.title);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  if (href === null) return `<a${titleAttr}>`;
  const rel = href.startsWith("#") ? "" : ' rel="noopener noreferrer"';
  return `<a href="${escapeHtml(href)}"${rel}${titleAttr}>`;
}

const closeTag = (mark: PMMark) => (mark.type === "link" ? "</a>" : `</${MARK_TAGS[mark.type]}>`);

function copy(ctx: Ctx, zh: string, en: string): string {
  return ctx.opts.language === "en" ? en : zh;
}

function inlineLeaf(node: PMNode, ctx: Ctx): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "text":
      return escapeHtml(node.text ?? "");
    case "hardBreak":
      return "<br>";
    case "image": {
      const src = imageSrc(str(a.src));
      const title = str(a.title) ? ` title="${escapeHtml(str(a.title))}"` : "";
      return src === null ? `<span class="missing">[${escapeHtml(str(a.alt))}]</span>` : `<img src="${escapeHtml(src)}" alt="${escapeHtml(str(a.alt))}"${title} loading="lazy">`;
    }
    case "mathInline":
      return `<code class="math" title="${copy(ctx, "TeX 公式（没有排版）", "TeX formula (source)")}">$${escapeHtml(str(a.tex))}$</code>`;
    case "htmlInline":
      return `<code class="raw">${escapeHtml(str(a.html))}</code>`;
    case "footnoteRef": {
      const label = str(a.label);
      const first = !ctx.refsSeen.has(label);
      ctx.refsSeen.add(label);
      const id = first ? ` id="${escapeHtml(footRefId(label))}"` : "";
      return `<sup class="fnref"><a href="#${escapeHtml(footId(label))}"${id}>${escapeHtml(label)}</a></sup>`;
    }
    default:
      return "";
  }
}

/** 行内节点 → HTML：mark 按固定顺序嵌套，相邻节点共有的 mark 不重复开合。 */
function inline(nodes: PMNode[], ctx: Ctx): string {
  let out = "";
  const stack: PMMark[] = [];
  for (const node of nodes) {
    const wanted = (node.marks ?? []).filter((m) => MARK_ORDER.includes(m.type)).sort((x, y) => MARK_ORDER.indexOf(x.type) - MARK_ORDER.indexOf(y.type));
    let keep = 0;
    while (keep < stack.length && keep < wanted.length && sameMark(stack[keep], wanted[keep])) keep++;
    while (stack.length > keep) out += closeTag(stack.pop() as PMMark);
    for (const m of wanted.slice(keep)) {
      stack.push(m);
      out += openTag(m, ctx);
    }
    out += inlineLeaf(node, ctx);
  }
  while (stack.length) out += closeTag(stack.pop() as PMMark);
  return out;
}

const textOf = (node: PMNode): string => (node.type === "text" ? (node.text ?? "") : (node.content ?? []).map(textOf).join(""));

function headingId(text: string, ctx: Ctx): string {
  const base = ctx.opts.slug(text) || "section";
  const n = ctx.ids.get(base) ?? 0;
  ctx.ids.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

/** 只有注释的 HTML 块：浏览器里本来就看不见，导出时也不显示。逐个找 `-->`，不用正则：嵌套量词的写法遇到「一串注释后跟别的字」会指数回溯。 */
function onlyComments(src: string): boolean {
  let at = 0;
  let seen = false;
  for (;;) {
    while (at < src.length && /\s/.test(src[at])) at++;
    if (at === src.length) return seen;
    if (!src.startsWith("<!--", at)) return false;
    const end = src.indexOf("-->", at + 4);
    if (end < 0) return false;
    at = end + 3;
    seen = true;
  }
}

/** 脚注正文跨行时并成一行：按行切开再拼，不用 `\s*\n\s*`（一长串空白时是平方级）。 */
const oneLine = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .join(" ");
/** 每一行都是引用式链接的定义：链接已经用上了地址，定义行本身不显示。 */
const LINK_DEFS = /^(?: {0,3}\[(?!\^)(?:[^\\[\]]|\\.)+\]:.*(?:\n|$))+$/;

function rawBlock(src: string, ctx: Ctx): string {
  const note = FOOTNOTE_DEF.exec(src);
  if (note) {
    ctx.notes.push({ label: note[1], text: oneLine(src.slice(note[0].length)) });
    return "";
  }
  if (onlyComments(src) || LINK_DEFS.test(src)) return "";
  return `<figure class="source"><figcaption>${copy(ctx, "原文 HTML（导出时按文字显示）", "Original HTML (shown as text)")}</figcaption><pre><code>${escapeHtml(src)}</code></pre></figure>`;
}

function listItem(item: PMNode, ctx: Ctx): string {
  const checked = item.attrs?.checked;
  const body = blocks(item.content ?? [], ctx);
  if (typeof checked !== "boolean") return `<li>${body}</li>`;
  return `<li class="task"><input type="checkbox" disabled${checked ? " checked" : ""}> ${body}</li>`;
}

function list(node: PMNode, ctx: Ctx): string {
  const items = (node.content ?? []).map((it) => listItem(it, ctx)).join("");
  const loose = node.attrs?.loose === true ? " loose" : "";
  if (node.type === "orderedList") {
    const start = Number(node.attrs?.start ?? 1);
    return `<ol class="list${loose}"${Number.isFinite(start) && start !== 1 ? ` start="${Math.trunc(start)}"` : ""}>${items}</ol>`;
  }
  return `<ul class="list${node.type === "taskList" ? " tasks" : ""}${loose}">${items}</ul>`;
}

const ALIGNS = new Set(["left", "center", "right"]);

function table(node: PMNode, ctx: Ctx): string {
  const rows = node.content ?? [];
  const cell = (c: PMNode) => {
    const tag = c.type === "tableHeader" ? "th" : "td";
    const align = str(c.attrs?.align);
    const style = ALIGNS.has(align) ? ` style="text-align:${align}"` : "";
    const body = (c.content ?? []).map((p) => inline(p.content ?? [], ctx)).join("<br>");
    return `<${tag}${style}>${body}</${tag}>`;
  };
  const row = (r: PMNode) => `<tr>${(r.content ?? []).map(cell).join("")}</tr>`;
  const [head, ...rest] = rows;
  const thead = head ? `<thead>${row(head)}</thead>` : "";
  return `<div class="table"><table>${thead}<tbody>${rest.map(row).join("")}</tbody></table></div>`;
}

function codeBlock(code: string, language: string, caption?: string): string {
  const lang = language.replace(/[^\w#+.-]/g, "");
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : "";
  const cap = caption ?? (lang ? lang : "");
  const label = cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : "";
  return `<figure class="code">${label}<pre><code${cls}>${escapeHtml(code)}</code></pre></figure>`;
}

const SVG_DATA = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/;

/**
 * 画好的 Mermaid 图只当图片输出（<img> 里的 SVG 不跑脚本、不加载别的东西），跟着系统明暗换浅色 / 深色那张；
 * 不是 SVG data: 地址的一律不信，退回源码。
 */
function diagram(code: string, ctx: Ctx): string {
  const pic = ctx.opts.diagram?.(code);
  const size = (n: number) => Math.max(1, Math.round(Number.isFinite(n) ? n : 1));
  if (!pic || !SVG_DATA.test(pic.light) || !SVG_DATA.test(pic.dark)) return codeBlock(code, "mermaid", copy(ctx, "Mermaid 图（源码，没有渲染）", "Mermaid diagram (source)"));
  const alt = escapeHtml(`${copy(ctx, "Mermaid 图：", "Mermaid diagram: ")}${code.trim().split("\n")[0]}`);
  return `<figure class="diagram"><picture><source media="(prefers-color-scheme: dark)" srcset="${pic.dark}"><img src="${pic.light}" width="${size(pic.width)}" height="${size(pic.height)}" alt="${alt}"></picture></figure>`;
}

function blockquote(node: PMNode, ctx: Ctx): string {
  const alert = str(node.attrs?.alert);
  const body = blocks(node.content ?? [], ctx);
  if (!alert) return `<blockquote>${body}</blockquote>`;
  const kind = alert.replace(/[^a-z]/g, "");
  return `<div class="alert alert-${kind}"><p class="alert-title">${escapeHtml(ctx.opts.alertLabel(alert))}</p>${body}</div>`;
}

function toc(doc: PMNode, ctx: Ctx): string {
  const items = (doc.content ?? [])
    .filter((n) => n.type === "heading")
    .map((h) => `<li class="toc-${Number(h.attrs?.level ?? 1)}"><a href="#${escapeHtml(ctx.headingIds.get(h) ?? "")}">${escapeHtml(textOf(h))}</a></li>`);
  return `<nav class="toc"><p class="toc-title">${copy(ctx, "目录", "Table of contents")}</p><ul>${items.join("")}</ul></nav>`;
}

function block(node: PMNode, ctx: Ctx, doc?: PMNode): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "paragraph":
      return node.content?.length ? `<p>${inline(node.content, ctx)}</p>` : "";
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(a.level ?? 1)));
      const id = ctx.headingIds.get(node) ?? headingId(textOf(node), ctx);
      return `<h${level} id="${escapeHtml(id)}">${inline(node.content ?? [], ctx)}</h${level}>`;
    }
    case "blockquote":
      return blockquote(node, ctx);
    case "bulletList":
    case "orderedList":
    case "taskList":
      return list(node, ctx);
    case "codeBlock":
      return codeBlock(textOf(node), str(a.language));
    case "diagram":
      return diagram(str(a.code), ctx);
    case "mathBlock":
      return `<figure class="math-block" title="${copy(ctx, "TeX 公式（没有排版）", "TeX formula (source)")}"><figcaption>${copy(ctx, "公式（TeX 源码）", "Formula (TeX source)")}</figcaption><pre><code>${escapeHtml(str(a.tex))}</code></pre></figure>`;
    case "horizontalRule":
      return "<hr>";
    case "table":
      return table(node, ctx);
    case "rawBlock":
      return rawBlock(str(a.src), ctx);
    case "toc":
      return doc ? toc(doc, ctx) : "";
    case "frontmatter":
      return "";
    default:
      return node.content ? blocks(node.content, ctx) : "";
  }
}

function blocks(nodes: PMNode[], ctx: Ctx, doc?: PMNode): string {
  return nodes.map((n) => block(n, ctx, doc)).join("\n");
}

function footnotes(ctx: Ctx): string {
  if (ctx.notes.length === 0) return "";
  const items = ctx.notes.map((n) => {
    const back = ctx.refsSeen.has(n.label) ? ` <a class="fnback" href="#${escapeHtml(footRefId(n.label))}" aria-label="${copy(ctx, "回到正文", "Return to text")}">↩</a>` : "";
    return `<li id="${escapeHtml(footId(n.label))}"><span class="fnlabel">${escapeHtml(n.label)}</span> ${inline(ctx.opts.footnoteInline(n.text), ctx)}${back}</li>`;
  });
  return `<section class="footnotes"><hr><ol>${items.join("")}</ol></section>`;
}

/** 脚本、表单提交、外部样式一律不许；图片可以从任何地方来（保留原地址）。 */
const CSP = "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/** 一整篇编辑器 JSON → 自包含的 HTML 页面。 */
export function documentToHtml(doc: PMNode, opts: HtmlOptions): string {
  const ctx: Ctx = { opts, ids: new Map(), headingIds: new Map(), notes: [], refsSeen: new Set() };
  // 目录可能在标题前面：先给顶层标题排好 id
  for (const n of doc.content ?? []) if (n.type === "heading") ctx.headingIds.set(n, headingId(textOf(n), ctx));
  const body = blocks(doc.content ?? [], ctx, doc);
  return [
    "<!doctype html>",
    `<html lang="${opts.language === "en" ? "en" : "zh-CN"}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="generator" content="Pairdown">',
    `<title>${escapeHtml(opts.title)}</title>`,
    `<style>${HTML_STYLE}</style>`,
    "</head>",
    "<body>",
    '<main class="doc">',
    body,
    footnotes(ctx),
    "</main>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
}
