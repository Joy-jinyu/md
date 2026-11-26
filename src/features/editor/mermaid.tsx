/**
 * Mermaid 出图：一个藏起来的 WebView 里跑打包进应用的 mermaid（assets/vendor/mermaid/，第一次有图要画时才载入），
 * 图表源码只当数据发进去（postMessage 的 JSON），拿回 SVG 文字和尺寸。
 * 浏览器里 WebView 是 sandbox iframe（不透明源，碰不到应用的存储），macOS 是 WKWebView；页里的 CSP 不许任何外部请求。
 * 交回的 SVG 先过校验（mermaid-queue.ts 的 svgProblem），再以 `data:` 地址交给 Image 当图片显示，不当 HTML 插进应用的界面。安全约定见 .claude/rules/security.md。
 */
import { cleanup, colorScheme, effect, signal, untracked, View, WebView, type WebViewRef } from "nsh";
import { type Phrase, phrase, t } from "../../i18n";
import mermaidUrl from "../../../assets/vendor/mermaid/mermaid.min.js?url";
import { messageOf } from "../../doc/message";
import { createDrawer, type DiagramRequest, readReply, type Rendered } from "./mermaid-queue";

export type { Rendered } from "./mermaid-queue";

/** 渲染器从拿到页面到说「好了」最多等这么久；一张图最多画这么久（画不完说明 mermaid 卡住了，整个渲染器重建）。 */
const LOAD_TIMEOUT_MS = 20_000;
const RENDER_TIMEOUT_MS = 15_000;
/** 画好的图最多记这么多张，按最近用过的留。 */
const CACHE_LIMIT = 100;
/** 改源码后停手这么久再画。 */
const DEBOUNCE_MS = 300;
/** 渲染页的视口：甘特图按容器宽度排，取和正文列差不多宽。 */
const FRAME = { width: 720, height: 600 };
/**
 * 渲染页的外框：在窗口里、透明、点不到，不做成 0×0 或移到窗口外——浏览器会给看不见的跨源 iframe 限速（推断，Chrome 的做法）。
 * 2026-11-25 本机 Chrome 实测（测试页本身是 hidden，分不出这条的效果）：30 张小图连载入 1.9–3 秒画完，外框是 0×0 时也一样快。
 */
const HIDDEN = { position: "absolute", left: 0, top: 0, width: 1, height: 1, overflow: "hidden", opacity: 0, pointerEvents: "none" } as const;

/** 页里只许内联的脚本和样式（mermaid 自己、桥接脚本），别的（网络、图片、字体、表单）一律不许。 */
const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";

/**
 * 渲染页的桥接脚本：收到 `{ id, code, dark }` 就画，一张画完再画下一张（mermaid.initialize 是全局的），
 * 回 `{ id, svg, width, height }` 或 `{ id, error }`。
 * strict：图里的 HTML 转义、点击回调（click … call / javascript:）不生效；htmlLabels、themeCSS、themeVariables、fontFamily 锁住（图里写 %%{init}%% 也改不了）。
 * SVG 原本是 width="100%"，当图片显示时量不出大小，这里按 viewBox 写回固定宽高。
 */
const PAGE_SCRIPT = `(function () {
  var SECURE = ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels", "themeCSS", "themeVariables", "fontFamily"];
  var FONT = '"PingFang SC", -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif';
  var seq = 0;
  var chain = Promise.resolve();
  function sized(svg) {
    var root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    var box = (root.getAttribute("viewBox") || "").split(/[\\s,]+/).map(Number);
    var w = Math.ceil(box[2] || 0), h = Math.ceil(box[3] || 0);
    if (!(w > 0 && h > 0)) throw new Error("md:bad-size");
    root.setAttribute("width", String(w));
    root.setAttribute("height", String(h));
    root.style.removeProperty("max-width");
    return { svg: new XMLSerializer().serializeToString(root), width: w, height: h };
  }
  function render(code, dark) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, secure: SECURE, suppressErrorRendering: true, theme: dark ? "dark" : "default", darkMode: dark, fontFamily: FONT });
    return mermaid.render("pd-mermaid-" + (++seq), code).then(function (r) { return sized(r.svg); });
  }
  addEventListener("message", function (e) {
    var job;
    try { job = JSON.parse(e.data); } catch (err) { return; }
    if (!job || typeof job.id !== "number" || typeof job.code !== "string") return;
    chain = chain.then(function () { return render(job.code, job.dark === true); }).then(
      function (r) { nsh.postMessage(JSON.stringify({ id: job.id, svg: r.svg, width: r.width, height: r.height })); },
      function (err) { nsh.postMessage(JSON.stringify({ id: job.id, error: String((err && err.message) || err) })); });
  });
  nsh.postMessage(JSON.stringify({ ready: true }));
})();`;

/**
 * 库文本放进 srcdoc 前转义：`</script` 会把页面切开，`<!--` 会让后面的 `<script` 改变脚本的结束位置。
 * 12.3.0 实测：没有 `</script`，`<!--` 两处（一处在字符串里、一处在不带 u 标志的正则里），换成 `<\x21--` 意思不变。
 */
const pageHtml = (lib: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}"></head><body><script>${lib.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\x21--")}</script><script>${PAGE_SCRIPT}</script></body></html>`;

/** 渲染页的 HTML；null 是渲染器没开着。 */
const page = signal<string | null>(null);
/** 拼好的渲染页（含 5.5 MB 的库文本）：只 fetch 一次，重建渲染器时直接用。 */
let pageCache: string | null = null;
/** 每开一次、停一次渲染器加一：晚到的回调对不上就不管。 */
let run = 0;
let starting = false;
let loads = 0;
let mounted = 0;
let view: WebViewRef | null = null;
let loadTimer: ReturnType<typeof setTimeout> | undefined;

const drawer = createDrawer({
  post: (job) => view?.postMessage(JSON.stringify(job)),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t),
  open: start,
  reset: stop,
  timeoutMs: RENDER_TIMEOUT_MS,
  cacheLimit: CACHE_LIMIT,
});

function stop() {
  run++;
  clearTimeout(loadTimer);
  page.set(null);
  view = null;
  starting = false;
  loads = 0;
  drawer.closed();
}

function failAll(message: Phrase) {
  stop();
  drawer.failAll(message);
}

async function loadPage(): Promise<string> {
  if (!(await WebView.available())) throw new Error(t("这里没有网页视图", "A web view is unavailable"));
  if (pageCache !== null) return pageCache;
  const res = await fetch(mermaidUrl);
  if (!res.ok) throw new Error(t(`载入 mermaid 失败（HTTP ${res.status}）`, `Could not load Mermaid (HTTP ${res.status})`));
  pageCache = pageHtml(await res.text());
  return pageCache;
}

function start() {
  if (starting) return;
  if (mounted === 0) return failAll(() => t("Mermaid 渲染器没有开着", "The Mermaid renderer is unavailable"));
  starting = true;
  const mine = run;
  void loadPage().then(
    (html) => {
      if (mine !== run) return;
      loadTimer = setTimeout(() => failAll(() => t("Mermaid 渲染器没加载出来", "The Mermaid renderer did not load")), LOAD_TIMEOUT_MS);
      page.set(html);
    },
    (e: unknown) => mine === run && failAll(() => t(`画不了 Mermaid 图：${messageOf(e)}`, `Could not render Mermaid diagram: ${messageOf(e)}`)),
  );
}

function receive(data: string, mine: number) {
  if (mine !== run) return;
  const reply = readReply(data);
  if (reply?.kind === "ready") {
    clearTimeout(loadTimer);
    drawer.opened();
  } else if (reply) drawer.drawn(reply.id, reply.rendered);
}

/** 已经画好（或已知画不了）的结果；没有是 undefined。 */
export const renderedNow = (code: string, dark: boolean): Rendered | undefined => drawer.cached(code, dark);

/** 把一张 Mermaid 图画成 SVG；同样的源码和主题只画一次。画不出时是 `{ kind: "error" }`，不抛错。不等了要调 `cancel`。 */
export const requestDiagram = (code: string, dark: boolean): DiagramRequest => drawer.request(code, dark);

/** mermaid 的报错常是几行（第几行、原文摘录、^ 指位置、期望什么）：取首行和末行拼成一行。 */
export function errorLine(message: string): string {
  const lines = message.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const text = lines.length > 1 ? `${lines[0]} ${lines[lines.length - 1]}` : (lines[0] ?? t("图没画出来", "Could not render the diagram"));
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

export type DiagramShown = { kind: "loading" } | { kind: "empty" } | { kind: "ready"; url: string; width: number; height: number } | { kind: "error"; message: Phrase };

/**
 * 节点视图用：跟着源码和明暗画图，给出现在该显示什么。
 * 第一次马上画；之后源码变了停手 `DEBOUNCE_MS` 再画，新图出来前留着旧图。源码、明暗变了或视图拆掉时，还没轮到的那张出队。
 */
export function diagramShown(code: () => string): () => DiagramShown {
  const shown = signal<DiagramShown>({ kind: "loading" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let first = true;
  let cancel: () => void = () => undefined;
  const drop = () => {
    clearTimeout(timer);
    cancel();
    cancel = () => undefined;
  };
  const show = (r: Rendered) =>
    shown.set(r.kind === "error" ? { kind: "error", message: () => errorLine(phrase(r.message)) } : { kind: "ready", url: r.url, width: r.width, height: r.height });
  effect(() => {
    const source = code();
    const dark = colorScheme() === "dark";
    untracked(() => {
      drop();
      const mine = ++generation;
      const wait = first ? 0 : DEBOUNCE_MS;
      first = false;
      if (source.trim() === "") return shown.set({ kind: "empty" });
      const hit = renderedNow(source, dark);
      if (hit) return show(hit);
      if (shown().kind !== "ready") shown.set({ kind: "loading" });
      timer = setTimeout(() => {
        const req = requestDiagram(source, dark);
        cancel = req.cancel;
        void req.result.then((r) => mine === generation && show(r));
      }, wait);
    });
  });
  cleanup(() => {
    generation++;
    drop();
  });
  return shown;
}

/** 藏起来的渲染器：编辑页挂一个，第一次有图要画时才建 WebView、载入 mermaid。页面要是跳走了（不该发生）就整个停掉。 */
export function MermaidRenderer() {
  mounted++;
  cleanup(() => {
    mounted--;
    if (mounted === 0) failAll(() => t("Mermaid 渲染器关掉了", "The Mermaid renderer closed"));
  });
  return (
    <If when={page()}>
      {(html) => {
        const mine = run;
        return (
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={HIDDEN}>
            <WebView
              ref={(r: WebViewRef) => (view = r)}
              html={html()}
              incognito
              scrollable={false}
              style={FRAME}
              onLoadStart={() => {
                loads++;
                if (loads > 1) failAll(() => t("Mermaid 渲染器跳到了别的页面，已经停下", "The Mermaid renderer navigated away and stopped"));
              }}
              onError={(e) => failAll(() => t(`Mermaid 渲染器出错：${e.message}`, `Mermaid renderer error: ${e.message}`))}
              onMessage={(e) => receive(e.data, mine)}
            />
          </View>
        );
      }}
    </If>
  );
}
