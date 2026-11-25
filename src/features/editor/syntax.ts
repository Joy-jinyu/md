/** 代码块的轻量分词：只认关键字、字符串、注释、数字、类型和属性名，够上色用，不求和编译器一样准。纯函数，不引 nsh。 */

export type TokenKind = "keyword" | "string" | "comment" | "number" | "type" | "attr";

/** 一段要上色的文字：`from`、`to` 是在代码文字里的下标（UTF-16，和编辑器的位置一一对应）。 */
export interface Token {
  from: number;
  to: number;
  kind: TokenKind;
}

interface CLike {
  kind: "clike";
  line: string[];
  block: [string, string][];
  quotes: string;
  keywords: Set<string>;
  types?: Set<string>;
  literals?: Set<string>;
  /** 大写字母开头的名字当类型（Go、Rust、TS 这类习惯）。 */
  capitalTypes?: boolean;
  /** 关键字不分大小写（SQL）。 */
  ignoreCase?: boolean;
  /** `"""` / `'''` 三引号字符串（Python）。 */
  triple?: boolean;
  /** `#` 只有在行首或空白后面才算注释（Shell：`a#b` 不是注释）。 */
  hashAfterSpace?: boolean;
  /** `$name`、`${…}` 是变量（Shell）。 */
  dollarVars?: boolean;
  /** `@name` 是装饰器 / 注解。 */
  decorators?: boolean;
  /** `/…/` 正则字面量（JS、TS）：按字符串上色，里面的引号不当字符串开头。 */
  regex?: boolean;
  /** 后面跟冒号的字符串是键（JSON）。 */
  keyStrings?: boolean;
}

type Lang = CLike | { kind: "html" } | { kind: "css" } | { kind: "markdown" } | { kind: "yaml" };

const words = (text: string) => new Set(text.split(" "));

const JS_KEYWORDS = words(
  "break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await as get set",
);
const TS_KEYWORDS = new Set([...JS_KEYWORDS, ...words("type interface enum implements namespace declare readonly abstract private protected public keyof infer is satisfies")]);
const TS_TYPES = words("string number boolean any unknown never void object symbol bigint");
const JS_LITERALS = words("true false null undefined NaN Infinity");

const C_LINE = ["//"];
const C_BLOCK: [string, string][] = [["/*", "*/"]];

const LANGS: Record<string, Lang> = {
  js: { kind: "clike", line: C_LINE, block: C_BLOCK, quotes: "'\"`", keywords: JS_KEYWORDS, literals: JS_LITERALS, capitalTypes: true, decorators: true, regex: true },
  ts: { kind: "clike", line: C_LINE, block: C_BLOCK, quotes: "'\"`", keywords: TS_KEYWORDS, types: TS_TYPES, literals: JS_LITERALS, capitalTypes: true, decorators: true, regex: true },
  json: { kind: "clike", line: C_LINE, block: C_BLOCK, quotes: '"', keywords: new Set(), literals: words("true false null"), keyStrings: true },
  python: {
    kind: "clike",
    line: ["#"],
    block: [],
    quotes: "'\"",
    triple: true,
    decorators: true,
    keywords: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"),
    types: words("int float str bool list dict set tuple bytes object type print len range self cls"),
    literals: words("True False None"),
  },
  bash: {
    kind: "clike",
    line: ["#"],
    block: [],
    quotes: "'\"",
    hashAfterSpace: true,
    dollarVars: true,
    keywords: words("if then else elif fi for in do done while until case esac function return local export readonly declare select time"),
    types: words("echo cd pwd source alias unset set shift exit eval exec test printf read cat grep sed awk ls mkdir rm cp mv chmod sudo"),
    literals: words("true false"),
  },
  go: {
    kind: "clike",
    line: C_LINE,
    block: C_BLOCK,
    quotes: "'\"`",
    capitalTypes: true,
    keywords: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
    types: words("bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any"),
    literals: words("true false nil iota"),
  },
  rust: {
    kind: "clike",
    line: C_LINE,
    block: C_BLOCK,
    quotes: '"',
    capitalTypes: true,
    keywords: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while"),
    types: words("bool char str i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 String Vec Option Result Box"),
    literals: words("true false None Some Ok Err"),
  },
  java: {
    kind: "clike",
    line: C_LINE,
    block: C_BLOCK,
    quotes: "'\"",
    capitalTypes: true,
    decorators: true,
    keywords: words("abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static super switch synchronized this throw throws transient try volatile while var record fun val when object companion override open data sealed"),
    types: words("boolean byte char double float int long short void"),
    literals: words("true false null"),
  },
  c: {
    kind: "clike",
    line: C_LINE,
    block: C_BLOCK,
    quotes: "'\"",
    keywords: words("auto break case catch class const constexpr continue default delete do else enum explicit extern for friend goto if inline namespace new noexcept operator private protected public return sizeof static struct switch template this throw try typedef typename union using virtual volatile while include define ifdef ifndef endif"),
    types: words("bool char double float int long short signed unsigned void size_t std string vector auto"),
    literals: words("true false NULL nullptr"),
  },
  sql: {
    kind: "clike",
    line: ["--"],
    block: C_BLOCK,
    quotes: "'\"",
    ignoreCase: true,
    keywords: words(
      "select from where and or not insert into values update set delete create table drop alter add index view join left right inner outer on group by order having limit offset as distinct union all case when then else end primary key foreign references default null is in like between exists",
    ),
    types: words("int integer bigint smallint varchar char text boolean date timestamp float double decimal numeric serial"),
    literals: words("true false"),
  },
  html: { kind: "html" },
  css: { kind: "css" },
  markdown: { kind: "markdown" },
  yaml: { kind: "yaml" },
};

const ALIASES: Record<string, string> = {
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  node: "js",
  typescript: "ts",
  tsx: "ts",
  jsonc: "json",
  json5: "json",
  py: "python",
  python3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  golang: "go",
  rs: "rust",
  kotlin: "java",
  kt: "java",
  h: "c",
  cpp: "c",
  "c++": "c",
  cc: "c",
  hpp: "c",
  cs: "c",
  csharp: "c",
  htm: "html",
  xml: "html",
  svg: "html",
  vue: "html",
  scss: "css",
  less: "css",
  md: "markdown",
  yml: "yaml",
  toml: "yaml",
};

function langOf(language: string): Lang | null {
  const name = language.toLowerCase();
  return LANGS[ALIASES[name] ?? name] ?? null;
}

/** 把一段代码按语言切成要上色的片段，按位置排好；语言没认出时是空的。 */
export function tokenize(code: string, language: string | null | undefined): Token[] {
  const lang = language ? langOf(language) : null;
  if (!lang) return [];
  switch (lang.kind) {
    case "clike":
      return scanClike(code, lang);
    case "html":
      return scanHtml(code);
    case "css":
      return scanCss(code);
    case "markdown":
      return scanMarkdown(code);
    case "yaml":
      return scanYaml(code);
  }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[\w$]/;
const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)[a-zA-Z%]*/;

function lineEnd(code: string, from: number): number {
  const end = code.indexOf("\n", from);
  return end < 0 ? code.length : end;
}

/**
 * 下一个 `ch` 在哪（没有时是代码长度）。记住上次找到的位置，往后扫时不从头再找：
 * 一行里成千上万个没收尾的 `${` 这类输入，每处都重新往后找会变成平方级。
 */
function finder(code: string, ch: string) {
  let at = -1;
  return (from: number): number => {
    if (at < from) {
      const next = code.indexOf(ch, from);
      at = next < 0 ? code.length : next;
    }
    return at;
  };
}

/** 从引号处读到配对的引号（反斜杠转义）；没收尾的读到行尾（反引号可以跨行）。`triple`：认 `"""` / `'''`。返回结束位置。 */
function stringEnd(code: string, from: number, quote: string, triple: boolean): number {
  if (triple && quote !== "`" && code.startsWith(quote.repeat(3), from)) {
    const close = code.indexOf(quote.repeat(3), from + 3);
    return close < 0 ? code.length : close + 3;
  }
  let i = from + 1;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "\\") i += 2;
    else if (ch === quote) return i + 1;
    else if (ch === "\n" && quote !== "`") return i;
    else i++;
  }
  return code.length;
}

function commentAt(code: string, i: number, lang: CLike): number {
  for (const [open, close] of lang.block) {
    if (code.startsWith(open, i)) {
      const end = code.indexOf(close, i + open.length);
      return end < 0 ? code.length : end + close.length;
    }
  }
  for (const start of lang.line) {
    if (!code.startsWith(start, i)) continue;
    if (lang.hashAfterSpace && start === "#" && i > 0 && !/\s/.test(code[i - 1])) continue;
    return lineEnd(code, i);
  }
  return -1;
}

function wordKind(word: string, lang: CLike): TokenKind | null {
  const key = lang.ignoreCase ? word.toLowerCase() : word;
  if (lang.literals?.has(word)) return "number";
  if (lang.keywords.has(key)) return "keyword";
  if (lang.types?.has(key)) return "type";
  if (lang.capitalTypes && /^[A-Z][a-z]/.test(word)) return "type";
  return null;
}

/** 这些字符后面的 `/` 是正则开头，不是除号。 */
const BEFORE_REGEX = "(,=:[!&|?{};+-*%<>~^";
const REGEX_AFTER_WORD = words("return typeof case in of delete void throw new instanceof yield await else do");

/** `/` 在这里是不是正则字面量的开头：往前看最近一个不是空格的字符（最多看 40 个）。 */
function regexAllowed(code: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && at - i <= 40 && (code[i] === " " || code[i] === "\t")) i--;
  if (i < 0 || code[i] === "\n") return true;
  if (BEFORE_REGEX.includes(code[i])) return true;
  if (!IDENT.test(code[i])) return false;
  let start = i;
  while (start > 0 && i - start < 12 && IDENT.test(code[start - 1])) start--;
  return REGEX_AFTER_WORD.has(code.slice(start, i + 1));
}

/** 正则字面量最长多少字：往后找收尾的 `/` 最多找这么远，一行里成千上万个没收尾的 `/[` 才不会每个都扫到行尾。 */
const MAX_REGEX = 300;

/** 正则字面量在哪结束（含后面的标志）；这一行里（MAX_REGEX 字以内）没收尾就不是正则，返回 -1。 */
function regexEnd(code: string, from: number): number {
  let inClass = false;
  const last = Math.min(code.length, from + MAX_REGEX);
  for (let i = from + 1; i < last; i++) {
    const ch = code[i];
    if (ch === "\n") return -1;
    if (ch === "\\") i++;
    else if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) return wordEnd(code, i + 1);
  }
  return -1;
}

/** 下一个不是空白的字符是不是 `:`（JSON 的键）。 */
function followedByColon(code: string, from: number): boolean {
  const m = /^[ \t]*:/.exec(code.slice(from, from + 40));
  return m !== null;
}

/** C 系（JS、TS、Go、Rust、Java、C）、Python、Shell、SQL、JSON 共用的扫描。 */
function scanClike(code: string, lang: CLike): Token[] {
  const out: Token[] = [];
  const nextBrace = finder(code, "}");
  const nextLine = finder(code, "\n");
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const comment = commentAt(code, i, lang);
    const regex = lang.regex && ch === "/" && comment < 0 && regexAllowed(code, i) ? regexEnd(code, i) : -1;
    if (comment > 0) {
      out.push({ from: i, to: comment, kind: "comment" });
      i = comment;
    } else if (regex > 0) {
      out.push({ from: i, to: regex, kind: "string" });
      i = regex;
    } else if (lang.quotes.includes(ch)) {
      const end = stringEnd(code, i, ch, !!lang.triple);
      out.push({ from: i, to: end, kind: lang.keyStrings && followedByColon(code, end) ? "attr" : "string" });
      i = end;
    } else if (/\d/.test(ch) && (i === 0 || !IDENT.test(code[i - 1]))) {
      const len = NUMBER.exec(code.slice(i, i + 64))?.[0].length ?? 1;
      out.push({ from: i, to: i + len, kind: "number" });
      i += len;
    } else if ((lang.dollarVars && ch === "$") || (lang.decorators && ch === "@")) {
      // `${…}` 只认同一行里收尾的，没收尾的只标 `${` 两个字
      const close = ch === "$" && code[i + 1] === "{" ? nextBrace(i) : -1;
      const end = close < 0 ? wordEnd(code, i + 1) : close < nextLine(i) ? close + 1 : i + 2;
      if (end > i + 1) out.push({ from: i, to: end, kind: "attr" });
      i = Math.max(end, i + 1);
    } else if (IDENT_START.test(ch)) {
      const end = wordEnd(code, i);
      const kind = wordKind(code.slice(i, end), lang);
      if (kind) out.push({ from: i, to: end, kind });
      i = end;
    } else i++;
  }
  return out;
}

function wordEnd(code: string, from: number): number {
  let i = from;
  while (i < code.length && IDENT.test(code[i])) i++;
  return i;
}

/** HTML / XML：注释、标签名、属性名、属性值。标签外的文字不上色。 */
function scanHtml(code: string): Token[] {
  const out: Token[] = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?([A-Za-z][\w:-]*)([^<>]*)>?/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m[0].startsWith("<!--")) {
      out.push({ from: m.index, to: m.index + m[0].length, kind: "comment" });
      continue;
    }
    const nameAt = m.index + m[0].indexOf(m[1]);
    out.push({ from: nameAt, to: nameAt + m[1].length, kind: "keyword" });
    const attrsAt = nameAt + m[1].length;
    const attr = /([^\s=/"']+)|("[^"]*"?|'[^']*'?)/g;
    for (let a = attr.exec(m[2]); a; a = attr.exec(m[2])) {
      out.push({ from: attrsAt + a.index, to: attrsAt + a.index + a[0].length, kind: a[1] ? "attr" : "string" });
    }
  }
  return out;
}

/** CSS：注释、字符串、@规则、花括号里的属性名、数字（带单位）和十六进制颜色。 */
function scanCss(code: string): Token[] {
  const out: Token[] = [];
  // 名字整段吃掉再看后面是不是冒号（不用先行断言）：断言失败时正则会从名字里的每个字重试一遍，长名字成了平方级
  const re = /\/\*[\s\S]*?(?:\*\/|$)|"[^"\n]*"?|'[^'\n]*'?|@[\w-]+|#[\da-fA-F]{3,8}\b|-?\d*\.?\d+[a-zA-Z%]*|([\w-]+)|[{}]|!important/g;
  let depth = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const text = m[0];
    const at = (kind: TokenKind) => out.push({ from: m.index, to: m.index + text.length, kind });
    if (text === "{") depth++;
    else if (text === "}") depth = Math.max(0, depth - 1);
    else if (text.startsWith("/*")) at("comment");
    else if (text[0] === '"' || text[0] === "'") at("string");
    else if (text[0] === "@" || text === "!important") at("keyword");
    else if (m[1] !== undefined) {
      if (depth > 0 && followedByColon(code, m.index + text.length)) at("attr");
    } else if (m.index === 0 || !/[\w-]/.test(code[m.index - 1])) at("number");
  }
  return out;
}

/** Markdown：标题行、列表和引用记号、围栏、行内代码、链接地址。 */
function scanMarkdown(code: string): Token[] {
  const out: Token[] = [];
  let offset = 0;
  for (const line of code.split("\n")) {
    const lead = /^(\s*)(#{1,6}\s.*|>+|[-*+]\s|\d+[.)]\s|```.*|~~~.*)?/.exec(line);
    const mark = lead?.[2];
    if (mark) {
      const from = offset + lead[1].length;
      const kind: TokenKind = mark.startsWith(">") ? "comment" : mark.startsWith("`") || mark.startsWith("~") ? "string" : "keyword";
      out.push({ from, to: from + mark.length, kind });
    }
    if (!mark?.startsWith("#")) out.push(...markdownInline(line, offset));
    offset += line.length + 1;
  }
  return out.sort((a, b) => a.from - b.from);
}

/**
 * 一行里的行内代码（`` `…` ``）和链接地址（`](地址 …)` 里的地址）。手写扫描：
 * 用正则时一行里重复几千次没收尾的 `](x` 会让回溯变成平方级（2026-11-25 实测 6000 字 3 秒多）。
 */
const LINK_TARGET = /[^)\s]+/y;

function markdownInline(line: string, offset: number): Token[] {
  const out: Token[] = [];
  // 往后已经没有收尾的 ` / ) 了：后面同样的开头也不用再找
  let ticks = true;
  let links = true;
  const nextClose = finder(line, ")");
  let i = 0;
  while (i < line.length) {
    if (ticks && line[i] === "`") {
      const close = line.indexOf("`", i + 1);
      if (close < 0) ticks = false;
      else if (close > i + 1) out.push({ from: offset + i, to: offset + close + 1, kind: "string" });
      i = close < 0 ? i + 1 : close > i + 1 ? close + 1 : close;
    } else if (links && line.startsWith("](", i)) {
      const close = nextClose(i + 2);
      if (close >= line.length) {
        links = false;
        continue;
      }
      LINK_TARGET.lastIndex = i + 2;
      const target = LINK_TARGET.exec(line)?.[0];
      if (target) out.push({ from: offset + i + 2, to: offset + i + 2 + target.length, kind: "attr" });
      i = target ? close + 1 : i + 2;
    } else i++;
  }
  return out;
}

/** YAML / TOML：注释、键、字符串、数字和 true / false / null。 */
function scanYaml(code: string): Token[] {
  const out: Token[] = [];
  let offset = 0;
  for (const line of code.split("\n")) {
    const key = /^(\s*(?:-\s+)?)([\w.$-]+|"[^"]*"|'[^']*')(\s*[:=])/.exec(line);
    if (key) out.push({ from: offset + key[1].length, to: offset + key[1].length + key[2].length, kind: "attr" });
    const rest = key ? key[0].length : 0;
    const re = /\s#.*$|^#.*$|"(?:[^"\\]|\\.)*"?|'[^']*'?|\b(?:true|false|null|yes|no)\b|-?\b\d[\d_.]*\b/g;
    re.lastIndex = rest;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const text = m[0];
      const start = offset + m.index + (text.startsWith(" ") || text.startsWith("\t") ? 1 : 0);
      const kind: TokenKind = text.trimStart().startsWith("#") ? "comment" : text[0] === '"' || text[0] === "'" ? "string" : /\d/.test(text[0]) || text[0] === "-" ? "number" : "keyword";
      out.push({ from: start, to: offset + m.index + text.length, kind });
    }
    offset += line.length + 1;
  }
  return out;
}
