import type { PMMark, PMNode } from "./types";

/** 写一个块时的上下文选项 */
export interface WriteOptions {
  /** 无序 / 任务列表的符号（和前一个列表区分开时换一个） */
  bullet?: "-" | "*" | "+";
  /** 有序列表的分隔符 */
  delimiter?: "." | ")";
  /** 这一块在文件第一个位置：分隔线写成 ***，front matter 才写成 --- … --- */
  first?: boolean;
}

interface InlineCtx {
  table?: boolean;
  heading?: boolean;
}

type Tok =
  | { t: "text"; s: string; raw: string }
  | { t: "lit"; s: string; ref?: boolean; br?: boolean }
  | { t: "open"; mark: PMMark; id: number }
  | { t: "close"; mark: PMMark; id: number };

type CharClass = "ws" | "punct" | "other" | "edge";

const MARK_ORDER = ["link", "bold", "italic", "strike", "highlight", "underline", "subscript", "superscript"];
const EMPHASIS: Record<string, { md: string; tag: string }> = {
  bold: { md: "**", tag: "strong" },
  italic: { md: "*", tag: "em" },
  strike: { md: "~~", tag: "del" },
};
const TAGS: Record<string, string> = { underline: "u", subscript: "sub", superscript: "sup", highlight: "mark" };
const ENTITY = /^&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
const AUTOLINK_START = /^<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:|[^\s<>@]+@)/;
const WORD = /[\p{L}\p{N}]/u;
const PUNCT = /[\p{P}\p{S}]/u;

function sameMark(a: PMMark, b: PMMark): boolean {
  if (a.type !== b.type) return false;
  if (a.type !== "link") return true;
  return a.attrs?.href === b.attrs?.href && (a.attrs?.title ?? null) === (b.attrs?.title ?? null);
}

function inlineMarks(node: PMNode): PMMark[] {
  return (node.marks ?? []).filter((m) => MARK_ORDER.includes(m.type)).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
}

function hasCode(node: PMNode): boolean {
  return (node.marks ?? []).some((m) => m.type === "code");
}

function isWordChar(c: string | undefined): boolean {
  return c !== undefined && WORD.test(c);
}

function escapeLineStart(raw: string, k: number): { s: string; len: number } | null {
  const c = raw[k];
  if ("#>-+=".includes(c)) return { s: "\\" + c, len: 1 };
  const m = /^(\d{1,9})([.)])/.exec(raw.slice(k));
  return m ? { s: m[1] + "\\" + m[2], len: m[0].length } : null;
}

function escapeChar(raw: string, k: number, inLink: boolean): string {
  const c = raw[k];
  const next = raw[k + 1];
  switch (c) {
    // 反斜杠紧跟 ] 时写成实体：解析器会把 \[ … \] 读成公式，哪怕那个反斜杠本身是转义出来的
    case "\\":
      return next === undefined || next === "]" || next === "\n" ? "&#92;" : "\\\\";
    case "*":
    case "`":
    case "~":
    case "$":
      return "\\" + c;
    case "_":
      return isWordChar(raw[k - 1]) && isWordChar(next) ? "_" : "\\_";
    case "[":
      return inLink ? "&#91;" : "\\[";
    case "]":
      return inLink ? "&#93;" : "]";
    case "<":
      return /^<[A-Za-z/!?]/.test(raw.slice(k, k + 2)) && (!inLink || AUTOLINK_START.test(raw.slice(k))) ? "\\<" : "<";
    case "&":
      return ENTITY.test(raw.slice(k)) ? "\\&" : "&";
    default:
      return c;
  }
}

/** 文字转义：只转会被读成语法的字符，读回来必须还是同一串文字 */
function escapeText(raw: string, lineStart: boolean, inLink: boolean): string {
  let out = "";
  let atLine = lineStart;
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] === "\n") {
      out += "\n";
      atLine = true;
      continue;
    }
    const lead = atLine ? escapeLineStart(raw, k) : null;
    atLine = false;
    if (lead) {
      out += lead.s;
      k += lead.len - 1;
      continue;
    }
    out += escapeChar(raw, k, inLink);
  }
  return out;
}

function escapeEntityAmp(s: string): string {
  let out = "";
  for (let k = 0; k < s.length; k++) out += s[k] === "&" && ENTITY.test(s.slice(k)) ? "\\&" : s[k];
  return out;
}

export function linkDest(href: string): string {
  const h = escapeEntityAmp(href.replace(/\\/g, "\\\\"));
  if (h === "") return "<>";
  return /[\s<>()]/.test(h) ? `<${h.replace(/[<>]/g, "\\$&")}>` : h;
}

export function linkTitle(title: unknown): string {
  if (typeof title !== "string" || title === "") return "";
  return ` "${escapeEntityAmp(title.replace(/["\\]/g, "\\$&"))}"`;
}

function codeSpan(body: string): string {
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = body.startsWith("`") || body.endsWith("`") || (body.startsWith(" ") && body.endsWith(" ") && body.trim() !== "");
  return pad ? `${fence} ${body} ${fence}` : `${fence}${body}${fence}`;
}

function leafLiteral(node: PMNode, ctx: InlineCtx): Tok | null {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "hardBreak":
      return ctx.table || ctx.heading ? { t: "lit", s: "<br>" } : { t: "lit", s: "\\\n", br: true };
    case "image":
      return { t: "lit", s: `![${escapeText(String(a.alt ?? ""), false, true)}](${linkDest(String(a.src ?? ""))}${linkTitle(a.title)})` };
    case "mathInline":
      return { t: "lit", s: `$${String(a.tex ?? "")}$` };
    case "htmlInline":
      return { t: "lit", s: String(a.html ?? "") };
    case "footnoteRef":
      return { t: "lit", s: `[^${String(a.label ?? "")}]`, ref: true };
    default:
      return null;
  }
}

/** 从栈顶关掉不再需要的 mark，直到栈里剩下的都还要用（保持嵌套合法） */
function closeUnwanted(stack: { mark: PMMark; id: number }[], wanted: PMMark[], toks: Tok[]): void {
  let keep = 0;
  while (keep < stack.length && wanted.some((m) => sameMark(m, stack[keep].mark))) keep++;
  while (stack.length > keep) {
    const e = stack.pop()!;
    toks.push({ t: "close", mark: e.mark, id: e.id });
  }
}

/** 编辑器行内节点 → 记号序列：mark 的开合按栈配对，首尾空白挪到 mark 外面 */
function tokenize(nodes: PMNode[], ctx: InlineCtx): Tok[] {
  const toks: Tok[] = [];
  const stack: { mark: PMMark; id: number }[] = [];
  let nextId = 0;
  let pendingWs = "";
  let lineStart = true;
  for (const node of nodes) {
    const plain = node.type === "text" && !hasCode(node);
    const text = node.text ?? "";
    const lead = plain ? (/^\s*/.exec(text)?.[0] ?? "") : "";
    const core = plain ? text.slice(lead.length).trimEnd() : text;
    const trail = plain && core !== "" ? text.slice(lead.length + core.length) : "";
    const marks = inlineMarks(node);
    const wanted = plain && core === "" ? stack.map((e) => e.mark).filter((m) => marks.some((x) => sameMark(x, m))) : marks;
    closeUnwanted(stack, wanted, toks);
    const toOpen = wanted.filter((m) => !stack.some((e) => sameMark(e.mark, m)));
    const ws = pendingWs + (toOpen.length ? lead : "");
    if (ws) toks.push({ t: "text", s: ws, raw: ws });
    pendingWs = "";
    for (const mark of toOpen) {
      stack.push({ mark, id: nextId });
      toks.push({ t: "open", mark, id: nextId++ });
    }
    if (ws || toOpen.length) lineStart = false;
    const inLink = stack.some((e) => e.mark.type === "link");
    if (plain) {
      const body = (toOpen.length ? "" : lead) + core;
      const prev = toks[toks.length - 1];
      let s = escapeText(body, lineStart, inLink);
      if (prev?.t === "lit" && prev.ref && s.startsWith(":")) s = "\\" + s;
      if (body) toks.push({ t: "text", s, raw: body });
      if (body) lineStart = false;
      pendingWs = trail;
      continue;
    }
    const lit = node.type === "text" ? ({ t: "lit", s: codeSpan(text) } as Tok) : leafLiteral(node, ctx);
    if (!lit) continue;
    toks.push(lit);
    lineStart = lit.t === "lit" && lit.br === true;
  }
  closeUnwanted(stack, [], toks);
  if (pendingWs) toks.push({ t: "text", s: pendingWs, raw: pendingWs });
  return toks;
}

function classOf(c: string | undefined): CharClass {
  if (c === undefined) return "edge";
  if (/\s/.test(c)) return "ws";
  return PUNCT.test(c) ? "punct" : "other";
}

function classBefore(toks: Tok[], k: number): CharClass {
  const t = toks[k - 1];
  if (!t) return "edge";
  return t.t === "text" ? classOf(t.s[t.s.length - 1]) : "punct";
}

function classAfter(toks: Tok[], k: number): CharClass {
  const t = toks[k + 1];
  if (!t) return "edge";
  return t.t === "text" ? classOf(t.s[0]) : "punct";
}

/** CommonMark 的左 / 右侧翼规则：* 和 ~~ 能不能在这里开、合 */
function canDelimit(toks: Tok[], a: number, b: number): boolean {
  if (b === a + 1) return false;
  const before = classBefore(toks, a);
  const first = classAfter(toks, a);
  const last = classBefore(toks, b);
  const after = classAfter(toks, b);
  const left = first !== "ws" && first !== "edge" && (first !== "punct" || before !== "other");
  const right = last !== "ws" && last !== "edge" && (last !== "punct" || after !== "other");
  return left && right;
}

function simpleHighlight(toks: Tok[], a: number, b: number): boolean {
  const inner = toks[a + 1];
  if (b !== a + 2 || inner.t !== "text" || /[=\n]/.test(inner.raw)) return false;
  const prev = toks[a - 1];
  const next = toks[b + 1];
  return !(prev?.t === "text" && prev.raw.endsWith("=")) && !(next?.t === "text" && next.raw.startsWith("="));
}

/** 链接文字就是地址本身：写成 <地址>（自动链接里不处理转义，所以要求地址里没有空白和尖括号） */
function autolinkOf(toks: Tok[], a: number, b: number, mark: PMMark): string | null {
  const inner = toks[a + 1];
  const href = String(mark.attrs?.href ?? "");
  if (b !== a + 2 || inner.t !== "text" || mark.attrs?.title || !/^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/.test(href)) return null;
  if (inner.raw === href) return `<${href}>`;
  return href === `mailto:${inner.raw}` && /^[^\s<>@\\]+@[^\s<>@\\]+$/.test(inner.raw) ? `<${inner.raw}>` : null;
}

function delimiters(toks: Tok[], a: number, b: number, forms: Map<number, [string, string]>): [string, string] {
  const mark = (toks[a] as { mark: PMMark }).mark;
  const auto = mark.type === "link" ? autolinkOf(toks, a, b, mark) : null;
  if (auto) return [auto, ""];
  if (mark.type === "link") return ["[", `](${linkDest(String(mark.attrs?.href ?? ""))}${linkTitle(mark.attrs?.title)})`];
  if (mark.type === "highlight" && simpleHighlight(toks, a, b)) return ["==", "=="];
  const tag = TAGS[mark.type];
  if (tag) return [`<${tag}>`, `</${tag}>`];
  const e = EMPHASIS[mark.type];
  const prev = toks[a - 1];
  const prevForm = prev?.t === "close" ? forms.get(prev.id)?.[1] : undefined;
  const clash = prevForm !== undefined && prevForm.endsWith(e.md[0]);
  return !clash && canDelimit(toks, a, b) ? [e.md, e.md] : [`<${e.tag}>`, `</${e.tag}>`];
}

/** 末尾是一个没被转义的 !：后面再接 [ 就会被读成图片 */
function endsWithBang(out: string): boolean {
  return /(?:^|[^\\])(?:\\\\)*!$/.test(out);
}

function render(toks: Tok[]): string {
  const forms = new Map<number, [string, string]>();
  const closeAt = new Map<number, number>();
  toks.forEach((t, k) => {
    if (t.t === "close") closeAt.set(t.id, k);
  });
  let out = "";
  let skip = -1;
  toks.forEach((t, k) => {
    if (k === skip) return;
    if (t.t === "open") {
      const form = delimiters(toks, k, closeAt.get(t.id)!, forms);
      forms.set(t.id, form);
      if (form[0] === "[" && endsWithBang(out)) out = out.slice(0, -1) + "\\!";
      out += form[0];
      if (form[0].startsWith("<") && form[1] === "") skip = k + 1;
    } else if (t.t === "close") out += forms.get(t.id)![1];
    else {
      if (t.t === "lit" && !t.ref && t.s.startsWith("[") && endsWithBang(out)) out = out.slice(0, -1) + "\\!";
      out += t.s;
    }
  });
  return out;
}

function entityOf(c: string): string {
  return c === "\t" ? "&#9;" : "&#32;";
}

/** 行首、行尾的空白会被解析器吃掉，换成实体保住 */
function protectEdges(s: string): string {
  return s
    .split("\n")
    .map((line) => line.replace(/^[ \t]/, entityOf).replace(/[ \t](\\?)$/, (m, bs: string) => entityOf(m[0]) + bs))
    .join("\n");
}

/**
 * 表格先按 | 切格子再读行内语法，所以格子里任何位置的 |（文字、代码、链接地址、HTML）都要转义。
 * 实测 nsh 0.6.0：| 前面有奇数个反斜杠才算转义，偶数个照样切格子。
 */
function escapeCellPipes(s: string): string {
  return s.replace(/(\\*)\|/g, (m, bs: string) => (bs.length % 2 ? m : `${bs}\\|`));
}

/** 编辑器行内节点 → Markdown */
export function writeInline(nodes: PMNode[], ctx: InlineCtx = {}): string {
  const out = protectEdges(render(tokenize(nodes, ctx)));
  return ctx.table ? escapeCellPipes(out) : out;
}

export function isEmptyParagraph(node: PMNode): boolean {
  return node.type === "paragraph" && (node.content ?? []).length === 0;
}

function textOf(node: PMNode): string {
  return (node.content ?? []).map((c) => c.text ?? "").join("");
}

function fenced(code: string, info: string): string {
  const ch = info.includes("`") ? "~" : "`";
  const runs = code.match(ch === "`" ? /`+/g : /~+/g) ?? [];
  const fence = ch.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return `${fence}${info}\n${code ? code + "\n" : ""}${fence}`;
}

function heading(node: PMNode): string {
  const level = Number(node.attrs?.level ?? 1);
  const inner = writeInline(node.content ?? [], { heading: true }).replace(/(^|[ \t])#(#*)$/, "$1\\#$2");
  return "#".repeat(level) + (inner ? " " + inner : "");
}

function blockquote(node: PMNode): string {
  const alert = node.attrs?.alert;
  const body = writeBlocks(node.content ?? [], () => "\n\n");
  const lines = [...(typeof alert === "string" && alert ? [`[!${alert.toUpperCase()}]`] : []), ...(body ? body.split("\n") : [])];
  return lines.length ? lines.map((l) => (l === "" ? ">" : "> " + l)).join("\n") : ">";
}

const FOLLOWS_PARAGRAPH = new Set(["bulletList", "taskList", "codeBlock", "diagram", "blockquote", "heading"]);

function canFollowTight(prev: PMNode, next: PMNode): boolean {
  if (prev.type !== "paragraph") return false;
  if (next.type === "orderedList") return Number(next.attrs?.start ?? 1) === 1;
  return FOLLOWS_PARAGRAPH.has(next.type);
}

function itemIsTight(item: PMNode): boolean {
  const kids = (item.content ?? []).filter((k, i) => i > 0 || !isEmptyParagraph(k));
  return kids.every((k, i) => i === 0 || canFollowTight(kids[i - 1], k));
}

function listItem(item: PMNode, marker: string, loose: boolean): string {
  const checked = item.attrs?.checked;
  const head = typeof checked === "boolean" ? `${marker} ${checked ? "[x]" : "[ ]"}` : marker;
  const kids = item.content ?? [];
  const firstEmpty = kids.length > 1 && isEmptyParagraph(kids[0]);
  const body = writeBlocks(firstEmpty ? kids.slice(1) : kids, () => (loose ? "\n\n" : "\n"));
  if (body === "") return head;
  const pad = " ".repeat(marker.length + 1);
  const lines = body.split("\n").map((l) => (l === "" ? "" : pad + l));
  if (firstEmpty && head === marker) return `${head}\n${lines.join("\n")}`;
  return `${head} ${lines[0].slice(pad.length)}${lines.length > 1 ? "\n" + lines.slice(1).join("\n") : ""}`;
}

function list(node: PMNode, opts: WriteOptions): string {
  const ordered = node.type === "orderedList";
  const start = Number(node.attrs?.start ?? 1);
  const items = node.content ?? [];
  const loose = node.attrs?.loose === true || !items.every(itemIsTight);
  const marker = (k: number): string => (ordered ? `${start + k}${opts.delimiter ?? "."}` : (opts.bullet ?? "-"));
  return items.map((it, k) => listItem(it, marker(k), loose)).join(loose ? "\n\n" : "\n");
}

function cellText(cell: PMNode): string {
  return (cell.content ?? [])
    .map((p) => writeInline(p.content ?? [], { table: true }))
    .filter((s) => s !== "")
    .join("<br>");
}

function table(node: PMNode): string {
  const rows = (node.content ?? []).map((r) => r.content ?? []);
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const line = (cells: PMNode[]): string => `| ${Array.from({ length: cols }, (_, c) => (cells[c] ? cellText(cells[c]) : "")).join(" | ")} |`;
  const align = (c: number): string => {
    const a = rows[0]?.[c]?.attrs?.align;
    return a === "left" ? ":--" : a === "right" ? "--:" : a === "center" ? ":-:" : "---";
  };
  const delim = `| ${Array.from({ length: cols }, (_, c) => align(c)).join(" | ")} |`;
  return [line(rows[0] ?? []), delim, ...rows.slice(1).map(line)].join("\n");
}

const LIST_TYPES = new Set(["bulletList", "taskList", "orderedList"]);

/** 一段 Markdown 首行的列表符号（- * + 或有序列表的 . )），不是列表返回 null */
export function listMarkerOf(text: string): string | null {
  const m = /^ {0,3}(?:([-+*])|\d{1,9}([.)]))(?:[ \t]|$)/m.exec(text.split("\n", 1)[0]);
  return m ? (m[1] ?? m[2]) : null;
}

/** 两个同类列表挨着时会并成一个：挑一个和前一个列表不同的符号 */
export function listOptions(node: PMNode, prev: PMNode | null, prevText: string): WriteOptions {
  if (!LIST_TYPES.has(node.type) || !prev || !LIST_TYPES.has(prev.type)) return {};
  const prevMarker = listMarkerOf(prevText);
  if (node.type === "orderedList") return prev.type === "orderedList" && prevMarker === "." ? { delimiter: ")" } : {};
  if (prev.type === "orderedList") return {};
  return { bullet: (["-", "*", "+"] as const).find((b) => b !== prevMarker) ?? "-" };
}

function writeBlocks(nodes: PMNode[], sep: (prev: PMNode, next: PMNode) => string): string {
  let out = "";
  let prev: PMNode | null = null;
  let prevText = "";
  for (const node of nodes) {
    if (isEmptyParagraph(node)) continue;
    const text = blockToMarkdown(node, listOptions(node, prev, prevText));
    out += prev ? sep(prev, node) + text : text;
    prev = node;
    prevText = text;
  }
  return out;
}

/** 一个编辑器块 → 固定写法的 Markdown（不带末尾换行） */
export function blockToMarkdown(node: PMNode, opts: WriteOptions = {}): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case "paragraph":
      return writeInline(node.content ?? []);
    case "heading":
      return heading(node);
    case "blockquote":
      return blockquote(node);
    case "bulletList":
    case "taskList":
    case "orderedList":
      return list(node, opts);
    case "codeBlock":
      return fenced(textOf(node), [a.language, a.meta].filter((x) => typeof x === "string" && x !== "").join(" "));
    case "diagram":
      return fenced(String(a.code ?? ""), "mermaid");
    case "mathBlock":
      return `$$\n${String(a.tex ?? "")}\n$$`;
    case "horizontalRule":
      return opts.first ? "***" : "---";
    case "table":
      return table(node);
    case "frontmatter":
      return opts.first ? `---\n${String(a.yaml ?? "")}\n---` : fenced(String(a.yaml ?? ""), "yaml");
    case "rawBlock":
      return String(a.src ?? "");
    case "toc":
      return "[toc]";
    default:
      return writeInline(node.content ?? []);
  }
}
