import { expect, test } from "nsh/test";
import { diffBlocks, splitBlocks } from "../src/doc/block-diff";
import { decide } from "../src/sync/plan";

const SYNCED = { base: "base text", version: "v1" };

test("never synced: a local document is uploaded; nothing to do without one", () => {
  expect(decide("hello", null, null)).toBe("create");
  expect(decide("hello", null, { version: "v9", text: "other" })).toBe("create");
  expect(decide(null, null, null)).toBe("none");
});

test("only one side changed: follow it without asking", () => {
  expect(decide("base text", SYNCED, { version: "v1", text: "base text" })).toBe("none");
  expect(decide("mine", SYNCED, { version: "v1", text: "base text" })).toBe("push");
  expect(decide("base text", SYNCED, { version: "v2", text: "theirs" })).toBe("pull");
});

test("both changed differently is a conflict; changed the same way, or the remote's version moved without its text, is not", () => {
  expect(decide("mine", SYNCED, { version: "v2", text: "theirs" })).toBe("conflict");
  expect(decide("same edit", SYNCED, { version: "v2", text: "same edit" })).toBe("adopt");
  expect(decide("base text", SYNCED, { version: "v2", text: "base text" })).toBe("adopt");
  expect(decide("mine", SYNCED, { version: "v2", text: "base text" })).toBe("push");
});

test("a remote whose version did not move (or has none) still counts as changed when its text did: both changed is a conflict, never a push over it", () => {
  const noVersion = { base: "base text", version: "" };
  expect(decide("mine", noVersion, { version: "", text: "theirs" })).toBe("conflict");
  expect(decide("base text", noVersion, { version: "", text: "theirs" })).toBe("pull");
  const sameSecond = { base: "base text", version: "2026-11-25T10:00:00Z" };
  expect(decide("mine", sameSecond, { version: "2026-11-25T10:00:00Z", text: "theirs" })).toBe("conflict");
  expect(decide("mine", sameSecond, { version: "2026-11-25T10:00:00Z", text: "base text" })).toBe("push");
});

test("line endings and trailing blank lines are not a difference: both sides ending up that close is not a conflict, and nothing is pushed or pulled for them", () => {
  const synced = { base: "a\n", version: "v1" };
  expect(decide("a\nb\n", synced, { version: "v2", text: "a\r\nb\r\n\r\n" })).toBe("adopt");
  expect(decide("a\n\n\n", synced, { version: "v1", text: "a\n" })).toBe("none");
  expect(decide("a\n", synced, { version: "v2", text: "a\r\n" })).toBe("adopt");
});

test("one side deleted: ask, never delete the other side; both gone: forget the link", () => {
  expect(decide("base text", SYNCED, null)).toBe("remote-deleted");
  expect(decide("mine", SYNCED, null)).toBe("remote-deleted");
  expect(decide(null, SYNCED, { version: "v1", text: "base text" })).toBe("local-deleted");
  expect(decide(null, SYNCED, { version: "v2", text: "theirs" })).toBe("local-deleted");
  expect(decide(null, SYNCED, null)).toBe("forget");
});

test("blocks are the paragraphs between blank lines, whatever the line endings", () => {
  expect(splitBlocks("# T\r\n\r\npara one\nline two\n\n\n  \n- a\n- b\n")).toEqual(["# T", "para one\nline two", "- a\n- b"]);
  expect(splitBlocks("\n\n")).toEqual([]);
});

test("the block diff marks the blocks only one side has, and keeps shared ones unmarked", () => {
  const local = "# Title\n\nshared\n\nmine only\n\nend\n";
  const remote = "# Title\n\nnew at top\n\nshared\n\nend\n";
  const d = diffBlocks(local, remote);
  expect(d.local).toEqual([
    { text: "# Title", only: false },
    { text: "shared", only: false },
    { text: "mine only", only: true },
    { text: "end", only: false },
  ]);
  expect(d.remote).toEqual([
    { text: "# Title", only: false },
    { text: "new at top", only: true },
    { text: "shared", only: false },
    { text: "end", only: false },
  ]);
  expect(d.rough).toBe(false);
});

/** 两边各 `n` 块，`gen(i, side)` 生成第 i 块；返回用时和两边标成「只在这一边」的块数。 */
function timed(n: number, gen: (i: number, side: "a" | "b") => string) {
  const local = Array.from({ length: n }, (_, i) => gen(i, "a")).join("\n\n");
  const remote = Array.from({ length: n }, (_, i) => gen(i, "b")).join("\n\n");
  const started = Date.now();
  const d = diffBlocks(local, remote);
  return { ms: Date.now() - started, onlyLocal: d.local.filter((b) => b.only).length, onlyRemote: d.remote.filter((b) => b.only).length, rough: d.rough };
}

test("the worst cases stay well inside the 2-second budget and still mark only what differs", () => {
  // 首尾都不一样、中间 4998 段相同：去头尾去不掉，要靠只出现一次的块分段
  const ends = timed(5000, (i, s) => (i === 0 || i === 4999 ? `${s}${i}` : `p${i}`));
  expect([ends.onlyLocal, ends.onlyRemote, ends.rough]).toEqual([2, 2, false]);
  expect(ends.ms < 500).toBe(true);
  // 全都不一样：整段标成不同就是准的，不算「没逐块比较」
  const all = timed(5000, (i, s) => `${s} para ${i}`);
  expect([all.onlyLocal, all.onlyRemote, all.rough]).toEqual([5000, 5000, false]);
  expect(all.ms < 500).toBe(true);
  // 每块 2000 字、只在最后几个字不同，块数在直接比的上限附近
  const long = timed(1400, (i, s) => `${"x".repeat(2000)}${String(i).padStart(5, "0")}${s}`);
  expect([long.onlyLocal, long.onlyRemote]).toEqual([1400, 1400]);
  // 这一例逐字比 280 万字，2026-11-25 机器负载 3～4 时单独量 484～508ms（另两例 45～111ms）：上限放到预算 2000ms 的一半，慢一倍就会报
  expect(long.ms < 1000).toBe(true);
  // 一边在最前面插了一段，其余整体后移
  const shifted = timed(5000, (i, s) => (s === "b" ? `p${i - 1}` : `p${i}`));
  expect([shifted.onlyLocal, shifted.onlyRemote]).toEqual([1, 1]);
});

test("a long stretch with only repeated blocks that cannot be lined up is marked as not compared block by block", () => {
  const local = Array.from({ length: 3000 }, (_, i) => (i % 2 ? "---" : `a${i}`)).join("\n\n");
  const remote = Array.from({ length: 3000 }, (_, i) => (i % 2 ? "---" : `b${i}`)).join("\n\n");
  expect(diffBlocks(local, remote).rough).toBe(true);
  expect(diffBlocks("a\n\nb\n", "a\n\nc\n").rough).toBe(false);
});

test("a long document with one changed block diffs quickly and marks just that block", () => {
  const blocks = Array.from({ length: 5000 }, (_, i) => `paragraph ${i}`);
  const local = blocks.join("\n\n");
  const remote = blocks.map((b, i) => (i === 2500 ? "changed" : b)).join("\n\n");
  const started = Date.now();
  const d = diffBlocks(local, remote);
  expect(Date.now() - started < 500).toBe(true);
  expect(d.local.filter((b) => b.only).map((b) => b.text)).toEqual(["paragraph 2500"]);
  expect(d.remote.filter((b) => b.only).map((b) => b.text)).toEqual(["changed"]);
});
