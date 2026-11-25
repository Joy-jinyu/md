import { expect, open, test } from "nsh/test";
import { documentToHtml, type DiagramPicture } from "../src/doc/to-html";
import { createDrawer, readReply, svgProblem } from "../src/features/editor/mermaid-queue";
import { LEGACY_DOC_KEY as DOC_KEY } from "../src/store/kv";

// 无头运行里没有网页引擎，图画不出来：这里只测画图前后用户看得到的状态和存下来的原文；真出图在浏览器和 macOS 窗口里实测（DESIGN.md「Mermaid 图」）。
const WEB = { platform: "web" as const, width: 1280, height: 860 };
const FLOW = "```mermaid\nflowchart TD\n  A[开始] --> B{判断}\n```\n";

async function saved(app: Awaited<ReturnType<typeof open>>): Promise<string> {
  await app.setLifecycle("background");
  return app.storage()[DOC_KEY] ?? "";
}

test("a Mermaid block shows the source while it is being drawn, never a blank box, and is saved unchanged", async () => {
  const doc = `# 图\n\n${FLOW}\n尾段。\n`;
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: doc } });
  await app.waitFor("text:Mermaid 图 · 正在渲染…");
  expect(app.texts()).toContain("flowchart TD\n  A[开始] --> B{判断}");
  await app.type("label:正文", "改");
  expect(await saved(app)).toBe(`# 改图\n\n${FLOW}\n尾段。\n`);
});

test("where there is no web view the block says it cannot be drawn and keeps the source", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: FLOW }, modules: { nsh: { "WebView.available": () => false } } });
  await app.waitFor("id:diagram-error");
  expect(app.texts()).toContain("Mermaid 图 · 没能渲染");
  expect(app.texts()).toContain("画不了 Mermaid 图：这里没有网页视图");
  expect(app.texts()).toContain("flowchart TD\n  A[开始] --> B{判断}");
});

test("an empty Mermaid block says how to fill it", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [DOC_KEY]: "```mermaid\n```\n" } });
  await app.waitFor("text:空 Mermaid 图，选中后点「编辑」写代码");
  expect(await saved(app)).toBe("```mermaid\n```\n");
});

const svgData = (n: number) => `data:image/svg+xml;base64,${"PHN2Zz48L3N2Zz4".repeat(n)}=`;
const diagramDoc = { type: "doc", content: [{ type: "diagram", attrs: { code: "graph TD; A-->B" } }] };
const exportWith = (diagram?: (code: string) => DiagramPicture | null) =>
  documentToHtml(diagramDoc, { title: "t", slug: (s) => s, linkHref: (h) => h, alertLabel: (k) => k, footnoteInline: (t) => [{ type: "text", text: t }], diagram });

test("an exported page shows a drawn diagram as a picture that follows light and dark, never as inline SVG markup", () => {
  const html = exportWith(() => ({ light: svgData(1), dark: svgData(2), width: 320.4, height: 200 }));
  expect(html).toContain(`<source media="(prefers-color-scheme: dark)" srcset="${svgData(2)}">`);
  expect(html).toContain(`<img src="${svgData(1)}" width="320" height="200" alt="Mermaid 图：graph TD; A--&gt;B">`);
  expect(html.includes("<svg")).toBe(false);
  expect(html.includes("<pre>")).toBe(false);
});

test("an exported diagram that could not be drawn, or whose picture is not an SVG data address, stays source", () => {
  for (const diagram of [undefined, () => null, () => ({ light: "javascript:alert(1)", dark: svgData(1), width: 1, height: 1 }), () => ({ light: `${svgData(1)}" onerror="x`, dark: svgData(1), width: 1, height: 1 })]) {
    const html = exportWith(diagram);
    expect(html).toContain("graph TD; A--&gt;B");
    expect(html).toContain("Mermaid 图（源码，没有渲染）");
    expect(html.includes("<img")).toBe(false);
  }
});

/** 假的渲染页：记下发过去的图，计时器手动拨。 */
function fakePage(timeoutMs = 15_000) {
  const posted: number[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let resets = 0;
  let opens = 0;
  const drawer = createDrawer<number>({
    post: (job) => void posted.push(job.id),
    setTimer: (fn) => {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimer: (t) => void timers.delete(t),
    open: () => void opens++,
    reset: () => void resets++,
    timeoutMs,
    cacheLimit: 100,
  });
  return {
    drawer,
    posted,
    pendingTimers: () => timers.size,
    fireTimers: () => {
      const due = [...timers.values()];
      timers.clear();
      due.forEach((fn) => fn());
    },
    resets: () => resets,
    opens: () => opens,
  };
}

const okSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><path marker-end="url(#m)"/></svg>';
const drawnReply = (id: number, svg = okSvg) => readReply(JSON.stringify({ id, svg, width: 10, height: 10 }));

test("diagrams go to the renderer one at a time, and each one's time limit starts only when it is sent", async () => {
  const page = fakePage();
  const a = page.drawer.request("graph TD; A-->B", false);
  const b = page.drawer.request("graph TD; C-->D", false);
  page.drawer.opened();
  const c = page.drawer.request("graph TD; E-->F", false);
  expect(page.posted).toEqual([1]);
  expect(page.pendingTimers()).toBe(1);
  const reply = drawnReply(1);
  if (reply?.kind !== "drawn") throw new Error("not drawn");
  page.drawer.drawn(reply.id, reply.rendered);
  expect((await a.result).kind).toBe("svg");
  expect(page.posted).toEqual([1, 2]);
  expect(page.pendingTimers()).toBe(1);
  b.cancel();
  c.cancel();
});

test("a diagram that takes too long fails on its own, the renderer is rebuilt, and the next one gets a fresh time limit", async () => {
  const page = fakePage();
  const a = page.drawer.request("graph TD; slow", false);
  page.drawer.request("graph TD; next", false);
  page.drawer.opened();
  page.fireTimers();
  expect(await a.result).toEqual({ kind: "error", message: "这张图画了 15 秒还没画完，可能太复杂", temporary: true });
  expect(page.resets()).toBe(1);
  expect(page.pendingTimers()).toBe(0);
  expect(page.posted).toEqual([1]);
  page.drawer.opened();
  expect(page.posted).toEqual([1, 2]);
  expect(page.pendingTimers()).toBe(1);
});

test("passing failures are not remembered and are drawn again; drawn pictures and Mermaid's own syntax errors are", async () => {
  const page = fakePage();
  page.drawer.request("graph TD; A", false);
  page.drawer.failAll("Mermaid 渲染器关掉了");
  expect(page.drawer.cached("graph TD; A", false)).toBe(undefined);
  page.drawer.request("graph TD; A", false);
  page.drawer.opened();
  expect(page.posted).toEqual([2]);
  page.drawer.drawn(2, { kind: "error", message: "Parse error on line 1", temporary: false });
  expect(page.drawer.cached("graph TD; A", false)).toEqual({ kind: "error", message: "Parse error on line 1", temporary: false });
  const again = page.drawer.request("graph TD; A", false);
  expect((await again.result).kind).toBe("error");
  expect(page.posted).toEqual([2]);
});

test("a diagram nobody waits for any more is not drawn", () => {
  const page = fakePage();
  page.drawer.request("graph TD; first", false);
  const gone = page.drawer.request("graph TD; gone", false);
  const kept = page.drawer.request("graph TD; kept", true);
  page.drawer.opened();
  gone.cancel();
  page.drawer.drawn(1, { kind: "error", message: "x", temporary: false });
  expect(page.posted).toEqual([1, 3]);
  kept.cancel();
});

test("a reply for a diagram that is not being drawn is ignored", () => {
  const page = fakePage();
  page.drawer.request("graph TD; A", false);
  page.drawer.opened();
  page.drawer.drawn(7, { kind: "error", message: "伪造", temporary: false });
  expect(page.drawer.cached("graph TD; A", false)).toBe(undefined);
  expect(page.pendingTimers()).toBe(1);
});

test("a picture from the renderer is shown only if it is a plain SVG of a sane size, as a data: address", () => {
  const good = drawnReply(1);
  expect(good?.kind === "drawn" && good.rendered.kind === "svg" && good.rendered.url.startsWith("data:image/svg+xml;base64,")).toBe(true);
  const forged = [
    "<html><script>alert(1)</script>",
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    "<svg><g ONCLICK = 'x'></g></svg>",
    "<svg><foreignObject><body/></foreignObject></svg>",
    '<svg><a href="&#106;ava&#x73;cript:alert(1)">x</a></svg>',
    '<svg><a xlink:href="java\tscript:x">x</a></svg>',
    '<svg><image href="http://evil.invalid/x.png"/></svg>',
    "<svg><style>.a{background:url(http://evil.invalid/x)}</style></svg>",
    '<svg><style>@import "x.css";</style></svg>',
  ];
  for (const svg of forged) {
    const r = drawnReply(1, svg);
    expect(r?.kind === "drawn" && r.rendered).toEqual({ kind: "error", message: "渲染器交回的图没通过安全检查，没有显示", temporary: true });
  }
  for (const [width, height] of [[0.001, 1e9], [20_001, 10], [5_000, 10], [Number.NaN, 10], ["10", 10]]) {
    const r = readReply(JSON.stringify({ id: 1, svg: okSvg, width, height }));
    expect(r?.kind === "drawn" && r.rendered.kind).toBe("error");
  }
  expect(readReply("not json")).toBe(null);
  expect(readReply(JSON.stringify({ id: "1", svg: okSvg, width: 10, height: 10 }))).toBe(null);
  expect(svgProblem('<svg><path fill="url( #g)"/><use href="#n"/><text>one = 1</text></svg>', 10, 10)).toBe(null);
});
