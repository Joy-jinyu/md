/**
 * 带宽度 / 对齐的图片在 Markdown 里写成 HTML 的 `<img>`（实施计划 4.2）：`![]()` 写不下这两样。
 * 只认这个模块自己写得出的那种标签：属性只有 src、alt、title、width、align，值用双引号，有 width 或 align。
 * 别的 `<img>`（带 style、height、onerror……）当原文保留，不读成图片节点，免得写回时丢属性。
 */

export type ImageAlign = "left" | "center" | "right";

export interface SizedImage {
  src: string;
  alt: string;
  title: string | null;
  width: string | null;
  align: ImageAlign | null;
}

/** 宽度：像素数（`300`）或百分比（`50%`）。 */
const WIDTH = /^\d{1,4}%?$/;
const ALIGNS: readonly string[] = ["left", "center", "right"];
const TAG = /^<img((?:\s+[a-zA-Z-]+="[^"<>]*")+)\s*\/?>$/i;
const ATTR = /\s+([a-zA-Z-]+)="([^"<>]*)"/g;
const ALLOWED = new Set(["src", "alt", "title", "width", "align"]);

const NAMED: Record<string, string> = { amp: "&", quot: '"', lt: "<", gt: ">" };
const ENTITY = /&(?:#([0-9]{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]*));/g;

function codePoint(dec: string | undefined, hex: string | undefined): string | null {
  const n = dec !== undefined ? Number(dec) : parseInt(hex ?? "", 16);
  return n > 0 && n <= 0x10ffff && (n < 0xd800 || n > 0xdfff) ? String.fromCodePoint(n) : null;
}

/** 解开属性值里的实体：四种基本的和数字实体；遇到别的具名实体（`&nbsp;`……）是 null，整个标签当原文保留。 */
function unescape(s: string): string | null {
  let bad = false;
  const out = s.replace(ENTITY, (m, dec?: string, hex?: string, name?: string) => {
    const c = name !== undefined ? (NAMED[name] ?? null) : codePoint(dec, hex);
    if (c === null) bad = true;
    return c ?? m;
  });
  return bad ? null : out;
}

/**
 * 写进属性值：`&"<>` 换成实体；换行换成空格（换行会把表格行、列表项拆开）。
 * 表格里 `|` 写成 `&#124;`：表格先按 | 切格子，写成 `\|` 的话反斜杠留在属性值里，每重写一次多一个。
 */
function escape(s: string, table: boolean): string {
  const out = s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ");
  return table ? out.replace(/\|/g, "&#124;") : out;
}

export function normalWidth(width: unknown): string | null {
  const w = width === null || width === undefined ? "" : String(width);
  return WIDTH.test(w) ? w : null;
}

export function normalAlign(align: unknown): ImageAlign | null {
  return typeof align === "string" && ALIGNS.includes(align) ? (align as ImageAlign) : null;
}

function readAttrs(list: string): Map<string, string> | null {
  const attrs = new Map<string, string>();
  for (const [, name, value] of list.matchAll(ATTR)) {
    const key = name.toLowerCase();
    const text = unescape(value);
    if (!ALLOWED.has(key) || attrs.has(key) || text === null) return null;
    attrs.set(key, text);
  }
  return attrs;
}

/** 读一个 `<img …>`：是这个模块认的那种就给出属性，否则 null（照原文保留）。 */
export function parseImgTag(html: string): SizedImage | null {
  const m = TAG.exec(html.trim());
  const attrs = m ? readAttrs(m[1]) : null;
  if (!attrs) return null;
  const src = attrs.get("src") ?? "";
  const width = attrs.has("width") ? normalWidth(attrs.get("width")) : null;
  const align = attrs.has("align") ? normalAlign(attrs.get("align")) : null;
  // 写了但值不认得（width="auto"）也不读，原样留着
  if (src === "" || (attrs.has("width") && !width) || (attrs.has("align") && !align) || (!width && !align)) return null;
  return { src, alt: attrs.get("alt") ?? "", title: attrs.get("title") || null, width, align };
}

/** 写成 `<img src alt title width align>`；alt、title 为空不写。`table`：写在表格格子里。 */
export function imgTag(image: SizedImage, table = false): string {
  const attr = (name: string, value: string | null) => (value ? ` ${name}="${escape(value, table)}"` : "");
  return `<img src="${escape(image.src, table)}"${attr("alt", image.alt)}${attr("title", image.title)}${attr("width", image.width)}${attr("align", image.align)}>`;
}
