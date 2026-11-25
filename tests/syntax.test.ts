import { expect, test } from "nsh/test";
import { type TokenKind, tokenize } from "../src/features/editor/syntax";

/** 代码里每段上色的文字和它的种类，按位置排。 */
function colored(code: string, language: string): [string, TokenKind][] {
  return tokenize(code, language).map((t) => [code.slice(t.from, t.to), t.kind]);
}

test("JS / TS: keywords, strings, comments, numbers, types", () => {
  expect(colored('const a: number = 42; // hi\nlet s = "x\\"y";', "ts")).toEqual([
    ["const", "keyword"],
    ["number", "type"],
    ["42", "number"],
    ["// hi", "comment"],
    ["let", "keyword"],
    ['"x\\"y"', "string"],
  ]);
  expect(colored("/* a */ class Foo {}", "javascript")).toEqual([
    ["/* a */", "comment"],
    ["class", "keyword"],
    ["Foo", "type"],
  ]);
});

test("Python: triple-quoted strings, hash comments, literals", () => {
  expect(colored('def f():  # c\n    return """a\nb""" or None', "py")).toEqual([
    ["def", "keyword"],
    ["# c", "comment"],
    ["return", "keyword"],
    ['"""a\nb"""', "string"],
    ["or", "keyword"],
    ["None", "number"],
  ]);
});

test("Shell: a # inside a word is not a comment; variables are marked", () => {
  expect(colored('echo "$HOME" a#b # end', "bash")).toEqual([
    ["echo", "type"],
    ['"$HOME"', "string"],
    ["# end", "comment"],
  ]);
  expect(colored("cd $DIR", "sh")).toEqual([
    ["cd", "type"],
    ["$DIR", "attr"],
  ]);
});

test("JSON keys, HTML tags and attributes, CSS properties, YAML keys", () => {
  expect(colored('{"k": "v", "n": 1.5, "b": true}', "json")).toEqual([
    ['"k"', "attr"],
    ['"v"', "string"],
    ['"n"', "attr"],
    ["1.5", "number"],
    ['"b"', "attr"],
    ["true", "number"],
  ]);
  expect(colored('<a href="x">t</a><!-- c -->', "html")).toEqual([
    ["a", "keyword"],
    ["href", "attr"],
    ['"x"', "string"],
    ["a", "keyword"],
    ["<!-- c -->", "comment"],
  ]);
  expect(colored("h1 { color: #fff; margin: 0 2px; }", "css")).toEqual([
    ["color", "attr"],
    ["#fff", "number"],
    ["margin", "attr"],
    ["0", "number"],
    ["2px", "number"],
  ]);
  expect(colored("name: x # c\nok: true", "yml")).toEqual([
    ["name", "attr"],
    ["# c", "comment"],
    ["ok", "attr"],
    ["true", "keyword"],
  ]);
});

test("Go, Rust, SQL keywords; an unknown or missing language colors nothing", () => {
  expect(colored("func main() {}", "go")).toEqual([["func", "keyword"]]);
  expect(colored("fn main() -> i32 {}", "rust")).toEqual([
    ["fn", "keyword"],
    ["i32", "type"],
  ]);
  expect(colored("SELECT a FROM t -- c", "sql")).toEqual([
    ["SELECT", "keyword"],
    ["FROM", "keyword"],
    ["-- c", "comment"],
  ]);
  expect(tokenize("const a = 1", "brainfuck")).toEqual([]);
  expect(tokenize("const a = 1", null)).toEqual([]);
});

test("JS: four quotes are two empty strings, a regex literal's quote does not start a string; bash ${ without a close stays on its line", () => {
  expect(colored('a = """" + x', "js")).toEqual([
    ['""', "string"],
    ['""', "string"],
  ]);
  expect(colored('a = b / c; const re = /"[/]/g; let y = 1;', "js")).toEqual([
    ["const", "keyword"],
    ['/"[/]/g', "string"],
    ["let", "keyword"],
    ["1", "number"],
  ]);
  expect(colored("echo ${A\nfoo\nbar } baz", "bash")).toEqual([
    ["echo", "type"],
    ["${", "attr"],
  ]);
  expect(colored("echo ${HOME} x", "bash")).toEqual([
    ["echo", "type"],
    ["${HOME}", "attr"],
  ]);
});

test("Markdown: inline code and link targets; a ]( without a close is not a link", () => {
  expect(colored("see `code` and [a](http://x.y \"t\") ](x `q`", "markdown")).toEqual([
    ["`code`", "string"],
    ["http://x.y", "attr"],
    ["`q`", "string"],
  ]);
});

/** 病态输入：回溯或者反复往后找会变成平方级的写法。阈值放宽（本机实测都在 10ms 内），只挡住秒级的退化。 */
const SLOW_INPUTS: [string, string][] = [
  ["markdown", "](x".repeat(10_000)],
  ["markdown", "]( ".repeat(30_000) + ")"],
  ["css", "a".repeat(100_000)],
  ["css", ("a".repeat(50) + " ").repeat(2_000)],
  ["bash", "${".repeat(100_000)],
  ["js", "/".repeat(50_000)],
  // 每个没收尾的 `/[` 最多往后找 300 字（MAX_REGEX），按上色的长度上限（2 万字）给
  ["js", "a = /[".repeat(3_400)],
  ["python", '"""'.repeat(30_000)],
  ["html", "<a " + 'x="'.repeat(30_000)],
  ["yaml", " ".repeat(100_000) + "x"],
];

test("pathological code is tokenized quickly", () => {
  for (const [language, code] of SLOW_INPUTS) {
    const start = Date.now();
    tokenize(code, language);
    const took = Date.now() - start;
    if (took >= 1500) throw new Error(`${language} ${JSON.stringify(code.slice(0, 12))}… took ${took}ms`);
  }
});
