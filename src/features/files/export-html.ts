/** 「导出为 HTML」：从存着的 Markdown 读一遍（和打开文档同一个转换层），写成自包含的 HTML。源码方式打开的大文档也能导出。 */
import { documentToHtml, type HtmlOptions } from "../../doc/to-html";
import type { PMNode } from "../../doc/types";
import { IN_BROWSER } from "../../platform";
import { documentStore } from "../../store/backend";
import { bytesToBase64, isRelativeSrc } from "../../store/image-file";
import { imagesIn } from "../editor/images";
import { ALERT_KINDS } from "../editor/commands";
import { loadMarkdown } from "../editor/convert";
import { linkTarget, slugify } from "../editor/links";
import { renderedNow, requestDiagram } from "../editor/mermaid";
import { markdownTitle } from "../editor/outline";

/** macOS 应用一次最多写 8 MiB（nsh 的 fs.writeFile 上限，见 platform/macos/file-store.ts）；浏览器下载没有这个限制。 */
const MAX_EXPORT_BYTES = IN_BROWSER ? Number.POSITIVE_INFINITY : 8 * 1024 * 1024;
const MIB = 1024 * 1024;

/**
 * 导出要在一次 JS 调用里把整篇读完、写出，nsh 单次调用超过 2000ms 直接中断。耗时跟行数和字数走：2026-11-25 本机实测
 * 带脚注、表格、公式的长文 2.4 万行 703ms、4 万行 1348ms，普通段落 2.1 万行 / 121 万字 704ms。留 3 倍余量取下面两个数。
 */
const MAX_EXPORT_LINES = 20_000;
const MAX_EXPORT_CHARS = 1_000_000;

/** 这篇太长，整篇读一遍会超出单次调用的时间预算：导出 HTML（和别的要整篇读一遍的事）先不做。 */
export const tooLongToConvert = (markdown: string) => markdown.length > MAX_EXPORT_CHARS || markdown.split("\n").length > MAX_EXPORT_LINES;

const ALERT_LABEL = new Map<string, string>(ALERT_KINDS.map((k) => [k.alert, k.label]));

/** 导出的链接只留应用自己也肯打开的那几种（http、https、mailto、文档内锚点），别的去掉 href。 */
function exportHref(href: string): string | null {
  return linkTarget(href).kind === "blocked" ? null : href.trim();
}

/** 脚注正文按行内 Markdown 读；读出来不是一个段落（比如以 `- ` 开头读成了列表）时按原文字显示。 */
function footnoteInline(text: string): PMNode[] {
  const blocks = loadMarkdown(text).json.content ?? [];
  const only = blocks.length === 1 && blocks[0].type === "paragraph" ? blocks[0].content : undefined;
  return only ?? [{ type: "text", text }];
}

const optionsFor = (markdown: string) => ({
  title: markdownTitle(markdown) || "未命名",
  slug: slugify,
  linkHref: exportHref,
  alertLabel: (kind: string) => ALERT_LABEL.get(kind) ?? kind,
  footnoteInline,
});

export function markdownToHtml(markdown: string): string {
  return documentToHtml(loadMarkdown(markdown).json, optionsFor(markdown));
}

/** 换掉文档里每张图片的地址（返回新的 JSON，原来的不动）。 */
function mapImages(node: PMNode, swap: Map<string, string>): PMNode {
  const src = node.type === "image" ? String(node.attrs?.src ?? "") : "";
  const next = swap.has(src) ? { ...node, attrs: { ...node.attrs, src: swap.get(src) } } : node;
  return next.content ? { ...next, content: next.content.map((c) => mapImages(c, swap)) } : next;
}

/** 存在文档库里的图片（相对路径）：取出字节内联成 data: 地址，导出的 HTML 单独拿走也看得到图。取不到的留原地址。 */
async function inlineImages(doc: PMNode, docId: string): Promise<PMNode> {
  const swap = new Map<string, string>();
  for (const src of new Set(imagesIn(doc).map((i) => i.src).filter(isRelativeSrc))) {
    const asset = await documentStore.getAsset(docId, src).catch((e: unknown) => {
      console.warn("image not inlined", src, e);
      return null;
    });
    if (asset) swap.set(src, `data:${asset.mime};base64,${bytesToBase64(asset.bytes)}`);
  }
  return swap.size > 0 ? mapImages(doc, swap) : doc;
}

/**
 * 导出时等 Mermaid 图：先给 `DIAGRAM_WAIT_BASE_MS`（头一次要载入 mermaid），每张（浅色、深色各画一次）再加 `DIAGRAM_WAIT_EACH_MS`，
 * 最多等 `DIAGRAM_WAIT_MAX_MS`；没画完的导出源码。数值出处：2026-11-25 本机浏览器实测见 DESIGN.md「Mermaid 图」。
 */
const DIAGRAM_WAIT_BASE_MS = 10_000;
const DIAGRAM_WAIT_EACH_MS = 1_000;
const DIAGRAM_WAIT_MAX_MS = 60_000;

const diagramCodes = (node: PMNode): string[] => [...(node.type === "diagram" ? [String(node.attrs?.code ?? "")] : []), ...(node.content ?? []).flatMap(diagramCodes)];

interface DrawnDiagrams {
  diagram: HtmlOptions["diagram"];
  /** 画不出、导出成源码的图有几张（按文档里出现的次数）。 */
  missing: number;
}

/** 把文档里的 Mermaid 图浅色、深色各画一张（编辑器里画过的直接拿），给导出用；一张都没有时什么都不等。 */
async function drawDiagrams(doc: PMNode): Promise<DrawnDiagrams> {
  const all = diagramCodes(doc).filter((c) => c.trim() !== "");
  const codes = [...new Set(all)];
  if (codes.length === 0) return { diagram: undefined, missing: 0 };
  const requests = codes.flatMap((c) => [requestDiagram(c, false), requestDiagram(c, true)]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(requests.map((r) => r.result)),
    new Promise((r) => (timer = setTimeout(r, Math.min(DIAGRAM_WAIT_MAX_MS, DIAGRAM_WAIT_BASE_MS + codes.length * DIAGRAM_WAIT_EACH_MS)))),
  ]);
  clearTimeout(timer);
  for (const r of requests) r.cancel();
  const diagram = (code: string) => {
    const light = renderedNow(code, false);
    const dark = renderedNow(code, true);
    if (light?.kind !== "svg" || dark?.kind !== "svg") return null;
    return { light: light.url, dark: dark.url, width: light.width, height: light.height };
  };
  return { diagram, missing: all.filter((c) => diagram(c) === null).length };
}

/** 导出的 HTML；`note` 是要补进回执的一句（图片没内联时说明原因），没有是空串。 */
export interface ExportedHtml {
  html: string;
  note: string;
}

/**
 * 导出用：同 `markdownToHtml`，另外把这篇存在文档库里的图片内联进去，Mermaid 图画得出的换成图片（画不出的张数写进 `note`）。
 * 内联后超过 `limit`（macOS 一次写不下）就整篇不内联，图片留相对地址，`note` 说明。
 */
export async function markdownToHtmlWithImages(markdown: string, docId: string | null, limit = MAX_EXPORT_BYTES): Promise<ExportedHtml> {
  const doc = loadMarkdown(markdown).json;
  const drawn = await drawDiagrams(doc);
  const options = { ...optionsFor(markdown), diagram: drawn.diagram };
  const diagramNote = drawn.missing > 0 ? `${drawn.missing} 张 Mermaid 图没画出来，导出的是源码。` : "";
  const inlined = docId ? await inlineImages(doc, docId) : doc;
  const html = documentToHtml(inlined, options);
  if (inlined === doc || new TextEncoder().encode(html).length <= limit) return { html, note: diagramNote };
  return {
    html: documentToHtml(doc, options),
    note: `图片合起来超过 ${Math.round(limit / MIB)} MB，应用一次写不下，这次没有内联进 HTML：HTML 里还是图片的相对地址，单独拿走看不到图。${diagramNote}`,
  };
}
