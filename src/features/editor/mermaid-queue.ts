/**
 * Mermaid 出图的排队、缓存和回包校验：不碰 WebView，发图、计时器、开关渲染页都由 mermaid.tsx 传进来，测试里换成假的。
 * 安全约定见 .claude/rules/security.md 的 Mermaid 一行。
 */
import { bytesToBase64 } from "../../store/image-file";

/** 画好的图（`url` 是 SVG 的 `data:` 地址），或者画不出的原因；`temporary` 的原因（超时、渲染器没开着）不进缓存，下次照样重画。 */
export type Rendered = { kind: "svg"; url: string; width: number; height: number } | { kind: "error"; message: string; temporary: boolean };

/** 渲染页发回来的：说「好了」，或者一张图的结果。 */
export type Reply = { kind: "ready" } | { kind: "drawn"; id: number; rendered: Rendered };

/** 一张图的宽高上限；宽高比超过 `MAX_RATIO` 也不要。正常的图到不了，超了多半是伪造的回包。 */
const MAX_SIDE = 20_000;
const MAX_RATIO = 100;

const REJECTED = "渲染器交回的图没通过安全检查，没有显示";

/** SVG 的 `data:` 地址：和应用不同源，在新标签页里打开也碰不到应用的存储。 */
export const svgDataUrl = (svg: string) => `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;

/** 把 `&#106;`、`&#x6a;` 这类字符引用换回字符，查 `javascript:` 等时不被绕过。 */
function decodeRefs(text: string): string {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (whole, n: string) => {
    const code = n[0] === "x" || n[0] === "X" ? parseInt(n.slice(1), 16) : parseInt(n, 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const UNSAFE: RegExp[] = [/<script/, /<foreignobject/, /\son[a-z]+\s*=\s*["']/, /\bhref\s*=\s*["'](?!\s*#)/, /url\((?!\s*["']?\s*#)/, /@import/];

const isSide = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_SIDE;

/** 渲染页交回的 SVG 能不能显示：不能时返回原因。只认 `<svg` 开头、不带脚本 / 事件属性 / foreignObject / javascript: / 外链地址、尺寸正常的。 */
export function svgProblem(svg: string, width: unknown, height: unknown): string | null {
  if (!isSide(width) || !isSide(height) || Math.max(width / height, height / width) > MAX_RATIO) return "渲染器交回的图尺寸不对，没有显示";
  if (!svg.startsWith("<svg")) return REJECTED;
  const flat = decodeRefs(svg).toLowerCase();
  if (UNSAFE.some((re) => re.test(flat))) return REJECTED;
  return flat.replace(/[\s\u0000-\u001f]/g, "").includes("javascript:") ? REJECTED : null;
}

/** 读渲染页发回来的一条消息；认不出的是 null。只有 mermaid 自己报的错（`error` 字段）算确定的结果，其余毛病都算临时的。 */
export function readReply(data: string): Reply | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (e) {
    console.warn("mermaid: not a message", e);
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const m = parsed as Record<string, unknown>;
  if (m.ready === true) return { kind: "ready" };
  if (typeof m.id !== "number") return null;
  if (typeof m.svg === "string") {
    const bad = svgProblem(m.svg, m.width, m.height);
    const rendered: Rendered = bad ? { kind: "error", message: bad, temporary: true } : { kind: "svg", url: svgDataUrl(m.svg), width: m.width as number, height: m.height as number };
    return { kind: "drawn", id: m.id, rendered };
  }
  if (typeof m.error === "string" && m.error.trim() !== "") return { kind: "drawn", id: m.id, rendered: { kind: "error", message: m.error, temporary: false } };
  return { kind: "drawn", id: m.id, rendered: { kind: "error", message: "图没画出来", temporary: true } };
}

export interface DrawerDeps<T> {
  /** 把一张图发给渲染页。 */
  post: (job: { id: number; code: string; dark: boolean }) => void;
  setTimer: (fn: () => void, ms: number) => T;
  clearTimer: (timer: T) => void;
  /** 有图要画、渲染页没开着：开起来，开好了调 `opened()`。 */
  open: () => void;
  /** 一张图超时了（渲染页多半卡住）：关掉渲染页；还有图要画时随后会调 `open`。 */
  reset: () => void;
  timeoutMs: number;
  cacheLimit: number;
}

export interface DiagramRequest {
  result: Promise<Rendered>;
  /** 不等了（切了文档、改了源码）：还没轮到的那张出队，不再画。 */
  cancel: () => void;
}

export interface Drawer {
  request(code: string, dark: boolean): DiagramRequest;
  /** 已经画好（或已知画不了）的结果；没有是 undefined。 */
  cached(code: string, dark: boolean): Rendered | undefined;
  opened(): void;
  /** 渲染页没了：在画的那张放回队首，开好了重画。 */
  closed(): void;
  /** 渲染页交回一张图；不是正在画的那张就不管。 */
  drawn(id: number, rendered: Rendered): void;
  /** 渲染器开不起来：排着的图都画不了。 */
  failAll(message: string): void;
}

interface Job {
  id: number;
  key: string;
  code: string;
  dark: boolean;
  promise: Promise<Rendered>;
  done: (r: Rendered) => void;
}

const keyOf = (code: string, dark: boolean) => `${dark ? "dark" : "light"}\n${code}`;

/**
 * 一次只发一张给渲染页（页里本来也是一张画完再画下一张），这张的计时从发出去时算起；画完或超时再发下一张。
 * 同样的源码和主题只画一次：画着的共用一份结果，画好的（和 mermaid 报的语法错误）按最近用过的记 `cacheLimit` 张。
 */
export function createDrawer<T>(deps: DrawerDeps<T>): Drawer {
  let queue: Job[] = [];
  let current: { job: Job; timer: T } | null = null;
  let isOpen = false;
  let nextId = 0;
  const byKey = new Map<string, Job>();
  const waiters = new Map<string, number>();
  const settled = new Map<string, Rendered>();

  function remember(key: string, r: Rendered) {
    settled.delete(key);
    settled.set(key, r);
    for (const old of settled.keys()) {
      if (settled.size <= deps.cacheLimit) break;
      settled.delete(old);
    }
  }

  function settle(job: Job, r: Rendered) {
    byKey.delete(job.key);
    waiters.delete(job.key);
    if (r.kind === "svg" || !r.temporary) remember(job.key, r);
    job.done(r);
  }

  function timedOut(job: Job) {
    if (current?.job !== job) return;
    current = null;
    isOpen = false;
    settle(job, { kind: "error", message: `这张图画了 ${deps.timeoutMs / 1000} 秒还没画完，可能太复杂`, temporary: true });
    deps.reset();
    if (queue.length > 0) deps.open();
  }

  function pump() {
    if (!isOpen || current) return;
    const [job, ...rest] = queue;
    if (!job) return;
    queue = rest;
    current = { job, timer: deps.setTimer(() => timedOut(job), deps.timeoutMs) };
    deps.post({ id: job.id, code: job.code, dark: job.dark });
  }

  function closed() {
    isOpen = false;
    if (!current) return;
    deps.clearTimer(current.timer);
    queue = [current.job, ...queue];
    current = null;
  }

  function cached(code: string, dark: boolean): Rendered | undefined {
    const key = keyOf(code, dark);
    const hit = settled.get(key);
    if (hit) remember(key, hit);
    return hit;
  }

  function enqueue(code: string, dark: boolean, key: string): Job {
    let done: (r: Rendered) => void = () => undefined;
    const promise = new Promise<Rendered>((resolve) => (done = resolve));
    const job: Job = { id: ++nextId, key, code, dark, promise, done };
    byKey.set(key, job);
    queue = [...queue, job];
    return job;
  }

  function cancelOf(job: Job): () => void {
    let cancelled = false;
    return () => {
      if (cancelled || byKey.get(job.key) !== job) return;
      cancelled = true;
      const left = (waiters.get(job.key) ?? 1) - 1;
      waiters.set(job.key, left);
      if (left > 0 || !queue.includes(job)) return;
      queue = queue.filter((j) => j !== job);
      settle(job, { kind: "error", message: "没人等这张图了", temporary: true });
    };
  }

  function request(code: string, dark: boolean): DiagramRequest {
    const hit = cached(code, dark);
    if (hit) return { result: Promise.resolve(hit), cancel: () => undefined };
    const key = keyOf(code, dark);
    const job = byKey.get(key) ?? enqueue(code, dark, key);
    waiters.set(key, (waiters.get(key) ?? 0) + 1);
    const cancel = cancelOf(job);
    if (isOpen) pump();
    else deps.open();
    return { result: job.promise, cancel };
  }

  function drawn(id: number, rendered: Rendered) {
    if (!current || current.job.id !== id) return;
    deps.clearTimer(current.timer);
    const job = current.job;
    current = null;
    settle(job, rendered);
    pump();
  }

  function failAll(message: string) {
    closed();
    const all = queue;
    queue = [];
    for (const job of all) settle(job, { kind: "error", message, temporary: true });
  }

  return {
    request,
    cached,
    opened: () => {
      isOpen = true;
      pump();
    },
    closed,
    drawn,
    failAll,
  };
}
