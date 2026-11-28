import { expect, test } from "nsh/test";
import { type AppCommand, available, COMMANDS, type CommandContext, filterCommands, SLASH_COMMANDS } from "../src/features/editor/commands";
import { loadMarkdown } from "../src/features/editor/convert";
import { countChars, countWords } from "../src/features/editor/counts";
import { findMatches, MAX_MATCHES, replacementFor } from "../src/features/editor/find";
import { stepHeading } from "../src/features/editor/heading-step";
import { caretPosIn, currentHeading, headingStarts, markdownTitle, type Node, topBlocks } from "../src/features/editor/outline";
import { blockAtLine, lineOfBlock } from "../src/features/editor/source-align";
import { createUi } from "../src/features/editor/ui-state";
import { setSyncConfigForTests, syncConfig } from "../src/sync/config";

/** 这个文件按「没配同步」来断言命令清单（不看打包时的部署配置）；配好以后多出「同步…」由下面专门的用例管。 */
setSyncConfigForTests({ clientId: "", siteOrigin: "", tokenUrl: "" });

const text = (t: string): Node => ({ type: "text", text: t });
const para = (...content: Node[]): Node => ({ type: "paragraph", content });
const heading = (level: number, t: string): Node => ({ type: "heading", attrs: { level }, content: [text(t)] });
const doc = (...content: Node[]): Node => ({ type: "doc", content });
const FIND = { caseSensitive: false, wholeWord: false, regex: false };

const ids = (list: AppCommand[]) => list.map((c) => c.id);

test("the command filter puts prefix matches first and ignores case and spaces", () => {
  const found = ids(filterCommands(COMMANDS, "H 2"));
  expect(found[0]).toBe("block.h2");
  expect(ids(filterCommands(COMMANDS, "bt2"))).toEqual(["block.h2"]);
  expect(ids(filterCommands(COMMANDS, "table")).includes("block.table")).toBe(true);
  expect(filterCommands(COMMANDS, "no such command")).toEqual([]);
  expect(filterCommands(SLASH_COMMANDS, "")).toEqual(SLASH_COMMANDS);
});

test("only find, replace, the document list, the palette, settings, appearance and the file commands work in source-only documents", () => {
  const ctx: CommandContext = { ui: createUi(), session: null, askLink: () => undefined, askAtom: () => undefined, toggleSource: null };
  // 网站、更新日志、反馈的链接按打包时的部署配置拼，配没配都可能，不在这里断言
  const byDeployConfig = new Set(["help.website", "help.changelog", "help.feedback"]);
  const usable = ids(COMMANDS.filter((c) => available(c, ctx) && !byDeployConfig.has(c.id)));
  expect(usable).toEqual([
    "view.find",
    "view.replace",
    "view.findNext",
    "view.findPrevious",
    "view.sidebar",
    "view.documents",
    "view.search",
    "view.palette",
    "view.settings",
    "view.appearance",
    "theme.system",
    "theme.light",
    "theme.dark",
    "file.new",
    "file.quickOpen",
    "file.history",
    "file.open",
    "file.saveAs",
    "file.exportHtml",
    "help.markdown",
    "help.shortcuts",
  ]);
});

test("「同步…」 is only offered when sync is configured (a GitHub OAuth App client id)", () => {
  const ctx: CommandContext = { ui: createUi(), session: null, askLink: () => undefined, askAtom: () => undefined, toggleSource: null };
  const sync = COMMANDS.filter((c) => c.id === "file.sync");
  const before = syncConfig();
  try {
    setSyncConfigForTests({ clientId: "", siteOrigin: "", tokenUrl: "" });
    expect(sync.filter((c) => available(c, ctx))).toEqual([]);
    setSyncConfigForTests({ clientId: "test-client", siteOrigin: "https://pairdown.example", tokenUrl: "https://api.github.com/test-auth-worker/token" });
    expect(ids(sync.filter((c) => available(c, ctx)))).toEqual(["file.sync"]);
  } finally {
    setSyncConfigForTests(before);
  }
});

test("selected text counts CJK characters as words and leaves line breaks out of the character count", () => {
  expect(countWords("中文 abc 12")).toBe(4);
  expect(countWords("hello, world")).toBe(2);
  expect(countWords("")).toBe(0);
  expect(countChars("ab\ncd")).toBe(4);
  expect(countChars("👍x")).toBe(2);
});

test("headings step up and down one level, and stop at paragraph and H1", () => {
  expect(stepHeading(3, "up")).toBe(2);
  expect(stepHeading(1, "up")).toBe(1);
  expect(stepHeading(null, "up")).toBe(6);
  expect(stepHeading(2, "down")).toBe(3);
  expect(stepHeading(6, "down")).toBe(null);
  expect(stepHeading(null, "down")).toBe(null);
});

const LIST = { type: "bulletList", content: [{ type: "listItem", content: [para(text("x"))] }] };
const OUTLINED = doc(heading(1, "Title"), para(text("abc")), LIST, { type: "horizontalRule" }, heading(2, "S2"));

test("the outline lists top-level headings and knows which section a position is in", () => {
  const hs = headingStarts(OUTLINED);
  expect(hs).toEqual([
    { pos: 0, level: 1, text: "Title" },
    { pos: 20, level: 2, text: "S2" },
  ]);
  expect(currentHeading(hs, 8)).toBe(0);
  expect(currentHeading(hs, 21)).toBe(1);
  expect(currentHeading([], 5)).toBe(-1);
  expect(markdownTitle("intro\n\n## Hello world ##\n")).toBe("Hello world");
});

test("the caret goes into the first text of a block, or onto a block that has no text", () => {
  const [title, , list, rule] = topBlocks(OUTLINED);
  expect(caretPosIn(title)).toBe(1);
  expect(list.pos).toBe(12);
  expect(caretPosIn(list)).toBe(15);
  expect(caretPosIn(rule)).toBe(rule.pos);
});

test("source lines and top-level blocks map to each other", () => {
  const { pending } = loadMarkdown("# A\n\npara\n\n- x\n- y\n");
  expect(lineOfBlock(pending, 0)).toBe(0);
  expect(lineOfBlock(pending, 1)).toBe(2);
  expect(lineOfBlock(pending, 2)).toBe(4);
  expect(blockAtLine(pending, 5)).toBe(2);
  expect(blockAtLine(pending, 3)).toBe(1);
});

test("find reports positions inside blocks, and honours case, whole words and regex", () => {
  const d = doc(para(text("alpha Alpha")), heading(2, "alphabet"));
  expect(findMatches(d, { ...FIND, query: "alpha" }).matches.map((m) => [m.from, m.to])).toEqual([
    [1, 6],
    [7, 12],
    [14, 19],
  ]);
  expect(findMatches(d, { ...FIND, query: "alpha", caseSensitive: true }).matches.length).toBe(2);
  expect(findMatches(d, { ...FIND, query: "alpha", wholeWord: true }).matches.length).toBe(2);
  expect(findMatches(d, { ...FIND, query: "al(p)", regex: true }).matches.length).toBe(3);
  expect(findMatches(d, { ...FIND, query: "(", regex: true }).error).not.toBe(null);
});

test("find skips matches that run across an inline formula, and stops counting at the cap", () => {
  const withMath = doc(para(text("a"), { type: "mathInline", attrs: { tex: "x" } }, text("b ab")));
  expect(findMatches(withMath, { ...FIND, query: ".b", regex: true }).matches.map((m) => m.text)).toEqual(["ab"]);
  const many = doc(para(text("a ".repeat(MAX_MATCHES + 5))));
  const r = findMatches(many, { ...FIND, query: "a" });
  expect(r.matches.length).toBe(MAX_MATCHES);
  expect(r.capped).toBe(true);
});

test("regex replacement fills in groups and sees the text around the match, plain replacement is literal", () => {
  const d = doc(para(text("on 2026-11 foobar foobaz $42")));
  const one = (q: string, rep: string, regex = true) => {
    const query = { ...FIND, query: q, regex };
    return findMatches(d, query).matches.map((m) => replacementFor(m, query, rep));
  };
  expect(one("(\\d+)-(\\d+)", "$2/$1")).toEqual(["11/2026"]);
  expect(one("foo(?=bar)", "X")).toEqual(["X"]);
  expect(one("(?<=\\$)\\d+", "[$&]")).toEqual(["[42]"]);
  expect(one("foobar", "$1", false)).toEqual(["$1"]);
});

test("find without a limit returns every match past the highlight cap", () => {
  const many = doc(para(text("a ".repeat(MAX_MATCHES + 5))));
  expect(findMatches(many, { ...FIND, query: "a" }, Infinity).matches.length).toBe(MAX_MATCHES + 5);
});
