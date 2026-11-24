import { expect, test } from "nsh/test";
import { loadMarkdown } from "../src/features/editor/convert";
import { parseMarkdown } from "../src/features/editor/parse";
import { FULL_SYNTAX } from "./fixtures/full-syntax";
import { longDoc, looseList, SAMPLES, sectionDoc } from "./fixtures/samples";

/** 切片拼回去必须正好是原文 */
function rejoin(src: string): string {
  const p = parseMarkdown(src);
  const body = p.lead + p.slices.map((s) => s.text + s.sep).join("");
  return (p.bom ? "﻿" : "") + (p.crlf ? body.replace(/\n/g, "\r\n") : body);
}

// 期望的切片数和原样块位置：按 CommonMark 的块边界数出来，一个列表、一张表格、一个 HTML 块各算一片
const EXPECTED: Record<string, { slices: number; raw: number[]; degraded?: boolean }> = {
  "equal-json": { slices: 4, raw: [] },
  "refs-footnotes": { slices: 6, raw: [1, 2, 3, 4] },
  crlf: { slices: 4, raw: [] },
  bom: { slices: 2, raw: [] },
  "no-trailing-newline": { slices: 2, raw: [] },
  "blank-edges": { slices: 2, raw: [] },
  "indented-after-list": { slices: 4, raw: [] },
  setext: { slices: 3, raw: [] },
  "rule-not-first": { slices: 4, raw: [] },
  "tight-list-end-defs": { slices: 5, raw: [0] },
  details: { slices: 3, raw: [1] },
  "div-center": { slices: 2, raw: [0] },
  "comment-blank-lines": { slices: 3, raw: [1] },
  "adjacent-lists": { slices: 2, raw: [] },
  "duplicate-headings": { slices: 5, raw: [] },
  "nested-definition": { slices: 3, raw: [0] },
  "mixed-eol": { slices: 2, raw: [] },
  empty: { slices: 0, raw: [] },
};

for (const [name, want] of Object.entries(EXPECTED)) {
  test(`切片：${name}`, () => {
    const src = SAMPLES[name];
    const p = parseMarkdown(src);
    expect(rejoin(src)).toBe(src);
    expect(p.degraded).toBe(want.degraded === true);
    expect(p.slices.length).toBe(want.slices);
    expect(p.slices.flatMap((s, i) => (s.kind === "raw" ? [i] : []))).toEqual(want.raw);
  });
}

test("切片：语法全集不退化，拼回等于原文，<details> 整块原样", () => {
  const p = parseMarkdown(FULL_SYNTAX);
  expect(rejoin(FULL_SYNTAX)).toBe(FULL_SYNTAX);
  expect(p.degraded).toBe(false);
  const details = p.slices.find((s) => s.text.startsWith("<details>"));
  expect(details?.kind).toBe("raw");
  expect(details?.text.endsWith("</details>")).toBe(true);
});

test("切片：800 项松散列表是一片，不超时", () => {
  const src = looseList(800);
  const t = Date.now();
  const p = parseMarkdown(src);
  const ms = Date.now() - t;
  console.log(`TIMING loose-list-800 chars=${src.length} parse+slice=${ms}ms slices=${p.slices.length}`);
  expect(p.degraded).toBe(false);
  expect(p.slices.length).toBe(1);
  expect(ms).toBeLessThan(1000);
});

// 计时取三次里最少的一次：make test 时别的测试文件同时在跑，单次数字会被挤高（每次都打印出来）
test("切片：15 万字符 / 7500 块，解析 + 切片 ≤ 500ms（三次取最少）", async () => {
  const src = sectionDoc(2500);
  const runs: number[] = [];
  let p = parseMarkdown("");
  for (let k = 0; k < 3; k++) {
    const t = Date.now();
    p = parseMarkdown(src);
    runs.push(Date.now() - t);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const blocks = p.slices.reduce((n, s) => n + (s.kind === "raw" ? 1 : s.blocks.length), 0);
  console.log(`TIMING sections-2500 chars=${src.length} blocks=${blocks} slices=${p.slices.length} parse+slice=${JSON.stringify(runs)}ms`);
  expect(p.degraded).toBe(false);
  expect(rejoin(src)).toBe(src);
  expect(Math.min(...runs)).toBeLessThanOrEqual(500);
});

test("切片：约 1 万行的真实感长文不退化", () => {
  const src = longDoc(600);
  const t = Date.now();
  const p = parseMarkdown(src);
  const parseMs = Date.now() - t;
  const t2 = Date.now();
  loadMarkdown(src);
  const loadMs = Date.now() - t2;
  console.log(`TIMING long-doc lines=${src.split("\n").length} chars=${src.length} slices=${p.slices.length} parse+slice=${parseMs}ms load(parse+slice+toDoc)=${loadMs}ms`);
  expect(p.degraded).toBe(false);
  expect(rejoin(src)).toBe(src);
});
