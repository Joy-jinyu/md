/**
 * 本机网关后端（实施计划 10.2、10.3）：WebSocket 连 `ws://127.0.0.1:7341`，协议定义和网关共用 gateway/src/protocol.ts。
 * 文档 id 就是文库内的相对路径（`notes/a.md`），版本是网关给的内容 SHA-256。
 * 断开后每隔一会儿重连，连上后通知 watch（`all`），由编辑页按版本比对、接着保存；断开期间的请求直接失败，不排队。
 */
import { t } from "../i18n";
import { signal } from "nsh";
import {
  CLOSE_BUSY,
  CLOSE_MESSAGE_TOO_BIG,
  CLOSE_ORIGIN,
  CLOSE_VERSION,
  DEFAULT_PORT,
  type DocMeta as GatewayMeta,
  type ErrorCode,
  MAX_ASSET_BYTES,
  type Op,
  PROTOCOL_VERSION,
  type RequestMap,
  type ServerMessage,
} from "../../gateway/src/protocol";
import { cleanFileStem, dirOf, stemOf as stemWith } from "../doc/file-name";
import { type DocMeta, type DocumentStore, type ImageHostApi, ImageHostUnsupported, NameTaken, type StoreChange, type WriteResult } from "./document-store";
import { assetPathFromSrc, base64ToBytes, bytesToBase64, checkImage } from "./image-file";

export const GATEWAY_URL = `ws://127.0.0.1:${DEFAULT_PORT}`;

/** 设置页说明网关时要的端口和默认放行的页面来源：features 经这里拿，不直接引 gateway/。 */
export { DEFAULT_PORT, OFFICIAL_ORIGIN } from "../../gateway/src/protocol";

/** 一条连接；测试里换成替身。 */
export interface Socket {
  send(text: string): void;
  close(): void;
}

/** 连上来的东西：文本消息，和关闭码。 */
export interface SocketEvents {
  message(text: string): void;
  close(code: number): void;
}

/** 连上（WebSocket 握手完成）时 resolve；连不上时 reject。`giveUp` resolve 时还没连上的就别再连了（关掉）。 */
export type Connect = (url: string, events: SocketEvents, giveUp: Promise<void>) => Promise<Socket>;

/** 网关连接的状况：连着、断开了正在重连（`reason` 是知道的断开原因）、不再重连（原因给人看）。 */
export type GatewayLink = { state: "connected" } | { state: "reconnecting"; reason?: string } | { state: "stopped"; reason: string };

/** 网关明确不合作（来源不在白名单、协议版本不同、对方根本不是 Pairdown 网关）：不再连，原因给人看。 */
export class GatewayRefused extends Error {}

/** 重连的间隔（毫秒），断得越久隔得越长，最长 15 秒：网关没起时不刷屏，起来后十几秒内连上。 */
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000];
/** 网关嫌连接太多 / 消息太大时关掉连接：隔久一点再连，免得立刻又被关。 */
const BUSY_DELAY = 15000;
/** 一个请求最多等多久（毫秒）就当断线：网关在本机，5 MB 的文档读写也在 1 秒内回（体感值，留足余量）。 */
const REQUEST_MS = 10000;
/** 转存最多等多久（毫秒）：网关下载一张图限时 15 秒（gateway/README.md「安全模型」），再留出存盘和回话的余量。 */
const TRANSFER_MS = 25000;
/** 改名的回复丢了（断线）时，最多等多久重连上、去查改没改成。 */
const RENAME_CONFIRM_MS = 5000;
/** 请求超时、主动断开时用的关闭码（不是网关发的，只在页面里用）。 */
const CLOSE_NO_REPLY = -1;

type FailureCode = ErrorCode | "disconnected" | "bad-reply";

class GatewayFailure extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
    readonly version?: string,
  ) {
    super(message);
  }
}

const disconnectedMessage = () => t("和本机网关断开了，正在重连", "Lost the connection to the local gateway. Reconnecting…");
const badReplyMessage = () => t("本机网关的回复看不懂（网关版本不对，或者端口上不是 Pairdown 网关）", "Could not understand the gateway’s reply. Check that Pairdown’s gateway is running and up to date.");
const notGatewayMessage = () => t(`端口 ${DEFAULT_PORT} 上的程序不像 Pairdown 网关（握手的回复不对），没有用它。先停掉占着这个端口的程序，再启动网关`, `The program on port ${DEFAULT_PORT} did not respond like the Pairdown gateway. Stop the program using that port, then start the gateway.`);

function webSocketConnect(url: string, events: SocketEvents, giveUp: Promise<void>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let opened = false;
    void giveUp.then(() => !opened && ws.close());
    ws.onopen = () => {
      opened = true;
      resolve({ send: (text) => ws.send(text), close: () => ws.close() });
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") events.message(e.data);
    };
    ws.onclose = (e) => (opened ? events.close(e.code) : reject(new Error(t(`连不上网关（${e.code}）`, `Could not connect to the gateway (${e.code})`))));
  });
}

type Params<K extends Op> = RequestMap[K]["params"];
type Result<K extends Op> = RequestMap[K]["result"];
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isVersion = (r: Obj) => typeof r.version === "string";
const isStrings = (v: unknown) => Array.isArray(v) && v.every((n) => typeof n === "string");
/** 图床配置的两种视图：GitHub 仓库（kind 是 github），上传接口（kind 不写或 upload）。 */
const isHostView = (h: unknown) =>
  isObj(h) &&
  (h.kind === "github"
    ? typeof h.repo === "string" && typeof h.branch === "string" && typeof h.dir === "string" && typeof h.hasToken === "boolean"
    : (h.kind === undefined || h.kind === "upload") && typeof h.url === "string" && typeof h.field === "string" && typeof h.urlPath === "string" && isStrings(h.headerNames));

/** 每种请求的成功结果要长什么样；不合的当成看不懂的回复。没列的只要求是个对象。 */
const RESULT_SHAPE: Partial<Record<Op, (r: Obj) => boolean>> = {
  hello: (r) => r.version === PROTOCOL_VERSION && typeof r.library === "string" && r.library !== "",
  list: (r) => Array.isArray(r.docs) && r.docs.every((d) => isObj(d) && typeof d.path === "string" && typeof d.size === "number" && typeof d.mtimeMs === "number"),
  read: (r) => typeof r.text === "string" && isVersion(r),
  write: isVersion,
  create: isVersion,
  putAsset: (r) => typeof r.src === "string",
  getAsset: (r) => typeof r.mime === "string" && /^image\//.test(r.mime) && typeof r.data === "string",
  transfer: (r) => typeof r.src === "string",
  imageHost: (r) => r.host === null || isHostView(r.host),
  setImageHost: isObj,
  uploadImage: (r) => typeof r.url === "string" && /^https?:\/\/\S+$/i.test(r.url),
};

/** 网关来的一条消息：形状对得上才收。回复只看外壳（结果的形状在对上请求以后按 op 查）。 */
function readMessage(raw: unknown): ServerMessage | null {
  if (!isObj(raw)) return null;
  if (raw.type === "relist") return { type: "relist" };
  if (raw.type === "changed") {
    const ok = Array.isArray(raw.changes) && raw.changes.every((c) => isObj(c) && typeof c.path === "string" && (typeof c.version === "string" || c.version === null));
    return ok ? (raw as ServerMessage) : null;
  }
  if (raw.type !== "reply" || typeof raw.id !== "number") return null;
  if (raw.ok === true) return isObj(raw.result) ? (raw as ServerMessage) : null;
  const e = raw.error;
  return raw.ok === false && isObj(e) && typeof e.code === "string" && typeof e.message === "string" ? (raw as ServerMessage) : null;
}

/** 一条连上并 hello 过的连接：发请求、按序号对回包。 */
interface Session {
  library: string;
  /** `ms`：这个请求最多等多久（默认 Timing.requestMs）。 */
  request<K extends Op>(op: K, params: Params<K>, ms?: number): Promise<Result<K>>;
  close(): void;
}

interface SessionHooks {
  push(message: ServerMessage): void;
  /** 握手完成以后连接断了（握手中断开的不报这里，由 openSession 抛错）。 */
  closed(code: number): void;
}

interface Waiting {
  op: Op;
  resolve(v: unknown): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Timing {
  /** 连上并 hello 完最多等多久（含建立连接）。 */
  handshakeMs: number;
  requestMs: number;
}

function closeReason(code: number): string | null {
  if (code === CLOSE_ORIGIN) return t("网关拒绝了这个页面的来源（Origin）。启动网关时加上 --origin 和这个页面的地址", "The gateway rejected this page’s origin. Start the gateway with --origin followed by this site’s address.");
  if (code === CLOSE_VERSION) return t("网关和页面的协议版本不一样。更新网关后再刷新页面", "The gateway and this page use different protocol versions. Update the gateway, then refresh the page.");
  return null;
}

/** 断开了但还会重连时，知道原因的说一句。 */
function dropReason(code: number): string | undefined {
  if (code === CLOSE_BUSY) return t("网关的连接数满了（可能开着很多 Pairdown 页面），过一会儿再连", "The gateway has too many connections. Close other Pairdown tabs or try again shortly.");
  if (code === CLOSE_MESSAGE_TOO_BIG) return t("刚才发给网关的内容太大（多半是图片），网关断开了连接", "A request exceeded the gateway’s size limit, so the connection closed.");
  if (code === CLOSE_NO_REPLY) return t("网关好一会儿没有回应", "The gateway stopped responding.");
  return undefined;
}

/** 握手中途失败的原因：网关明确拒绝的不再连。 */
function handshakeError(code: number): Error {
  const reason = closeReason(code);
  return reason ? new GatewayRefused(reason) : new Error(t(`握手时连接断了（${code}）`, `The connection closed during setup (${code})`));
}

/** 一条连接：发请求、按序号对回包、每个请求限时；`open` 连上并 hello 完才交出去。 */
class Channel implements Session {
  library = "";
  private readonly pending = new Map<number, Waiting>();
  private next = 1;
  private live = true;
  private ready = false;
  private socket: Socket | null = null;
  private giveUp: () => void = () => undefined;
  private readonly gaveUp = new Promise<void>((resolve) => (this.giveUp = resolve));
  private failHandshake: (e: Error) => void = () => undefined;
  private readonly handshake = new Promise<never>((_, reject) => (this.failHandshake = reject));

  constructor(
    private readonly hooks: SessionHooks,
    private readonly timing: Timing,
  ) {
    this.handshake.catch(() => undefined);
  }

  /** 这条连接不能用了：没回的请求都按断线失败；握手完成以后的才报给 hooks（排重连），握手中的让握手失败。 */
  private end(code: number) {
    if (!this.live) return;
    this.live = false;
    // 握手中的先让握手带着原因失败：等 hello 的那个请求紧接着也会失败，race 取先失败的那个
    if (!this.ready) this.failHandshake(handshakeError(code));
    for (const w of this.pending.values()) {
      clearTimeout(w.timer);
      w.reject(new GatewayFailure("disconnected", disconnectedMessage()));
    }
    this.pending.clear();
    this.socket?.close();
    if (this.ready) this.hooks.closed(code);
  }

  private settle(id: number, outcome: (w: Waiting) => void) {
    const w = this.pending.get(id);
    if (!w) return;
    this.pending.delete(id);
    clearTimeout(w.timer);
    outcome(w);
  }

  private onReply(m: Extract<ServerMessage, { type: "reply" }>) {
    this.settle(m.id, (w) => {
      if (!m.ok) return w.reject(new GatewayFailure(m.error.code, m.error.message, m.error.version));
      const shaped = RESULT_SHAPE[w.op]?.(m.result as Obj) ?? true;
      return shaped ? w.resolve(m.result) : w.reject(new GatewayFailure("bad-reply", badReplyMessage()));
    });
  }

  private onMessage(text: string) {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      console.warn("gateway message unreadable", e);
      return;
    }
    const m = readMessage(raw);
    if (m === null) {
      console.warn("gateway message has an unexpected shape");
      // 看不懂的回复也要让等它的请求结束，不然请求一直挂着
      if (isObj(raw) && typeof raw.id === "number") this.settle(raw.id, (w) => w.reject(new GatewayFailure("bad-reply", badReplyMessage())));
      return;
    }
    if (m.type === "reply") this.onReply(m);
    else this.hooks.push(m);
  }

  request<K extends Op>(op: K, params: Params<K>, ms = this.timing.requestMs): Promise<Result<K>> {
    return new Promise<Result<K>>((resolve, reject) => {
      const socket = this.socket;
      if (!this.live || !socket) return reject(new GatewayFailure("disconnected", disconnectedMessage()));
      const id = this.next++;
      const timer = setTimeout(() => {
        console.warn("gateway request timed out", op);
        this.end(CLOSE_NO_REPLY);
      }, ms);
      this.pending.set(id, { op, resolve: resolve as (v: unknown) => void, reject, timer });
      socket.send(JSON.stringify({ id, op, ...params }));
    });
  }

  close() {
    this.end(CLOSE_NO_REPLY);
  }

  async open(connect: Connect): Promise<Session> {
    const events: SocketEvents = { message: (text) => this.onMessage(text), close: (code) => this.end(code) };
    // 计时从建连接前开始：端口上的程序只接 TCP、不回 WebSocket 握手时，connect 本身就不返回
    const timer = setTimeout(() => this.failHandshake(new Error(t("网关握手超时", "The gateway did not connect in time"))), this.timing.handshakeMs);
    try {
      // 超时以后才连上的那条：关掉，不留着占网关的连接数
      const connecting = connect(GATEWAY_URL, events, this.gaveUp).then((s) => {
        if (!this.live) s.close();
        return s;
      });
      this.socket = await Promise.race([connecting, this.handshake]);
      if (!this.live) await this.handshake;
      const hello = await Promise.race([this.request("hello", { version: PROTOCOL_VERSION }), this.handshake]);
      this.ready = true;
      this.library = hello.library;
      return this;
    } catch (e) {
      this.abandon();
      if (e instanceof GatewayFailure && e.code === "bad-reply") throw new GatewayRefused(notGatewayMessage());
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 握手没成：不再连、不再等。 */
  private abandon() {
    this.live = false;
    this.giveUp();
    for (const w of this.pending.values()) clearTimeout(w.timer);
    this.pending.clear();
    this.socket?.close();
  }
}

const openSession = (connect: Connect, hooks: SessionHooks, timing: Timing): Promise<Session> => new Channel(hooks, timing).open(connect);

const DOC_EXT = /\.md$/i;
const isDoc = (path: string) => DOC_EXT.test(path);
const stemOf = (path: string) => stemWith(path, DOC_EXT);

function toMeta(m: GatewayMeta): DocMeta {
  const meta: DocMeta = { id: m.path, name: stemOf(m.path), title: "", updatedAt: m.mtimeMs, version: "", size: m.size };
  return m.problem ? { ...meta, problem: m.problem } : meta;
}

type Action = "read" | "write" | "other";

/** 错误码 → 给人看的一句话（网关的 message 是给开发者看的，不直接透出）。 */
function explain(e: GatewayFailure, path: string, action: Action): Error {
  switch (e.code) {
    case "not-utf8":
      return new Error(t(`「${path}」不是 UTF-8 编码的文本，${action === "write" ? "网关不往里写" : "打不开"}（先用别的工具转成 UTF-8）`, `“${path}” is not UTF-8 text. ${action === "write" ? "The gateway did not write to it." : "It cannot be opened."} Convert it to UTF-8 first.`));
    case "too-large":
      if (action === "write") return new Error(t("这篇超过 5 MB，网关存不下。拆成几篇再存", "This document exceeds the gateway’s 5 MB limit. Split it into smaller documents to save it."));
      return new Error(action === "read" ? t(`「${path}」超过 5 MB，打不开`, `“${path}” cannot be opened because it exceeds 5 MB`) : t("超过网关能收的大小（文档 5 MB、图片 10 MB）", "The file exceeds the gateway’s size limit (5 MB for documents, 10 MB for images)"));
    case "bad-path":
      return new Error(t(`「${path}」这个文件名或路径网关不收（含 ..、隐藏文件、扩展名不对等）`, `The gateway does not accept the file name or path “${path}”`));
    case "busy":
      return new Error(t("网关正忙，过一会儿再试", "The gateway is busy. Try again shortly."));
    case "bad-type":
      return new Error(t("不是网关认得的图片格式（png、jpg、gif、webp、avif）", "Unsupported image format. Use PNG, JPEG, GIF, WebP, or AVIF."));
    case "not-supported":
    case "bad-request":
    case "no-hello":
    case "version-mismatch":
      return new Error(t("网关和页面对不上（版本不同），更新网关后刷新页面", "The gateway and this page use different versions. Update the gateway, then refresh the page."));
    case "internal":
      return new Error(t("网关内部出错了，详情看网关窗口里的输出", "The gateway encountered an internal error. Check its output for details."));
    case "disconnected":
    case "bad-reply":
      return e;
    default:
      return new Error(t(e.message, `The local gateway could not complete this request (${e.code}).`));
  }
}

export interface GatewayBackend {
  store: DocumentStore;
  /** 文库名（网关 hello 回的）。 */
  library(): string;
  link(): GatewayLink;
  /** 不用它了：断开，不再重连。 */
  close(): void;
}

/** 推来的一批里「旧路径消失 + 新路径出现、版本和旧路径手上的一样」：是别处（另一个标签页）改了名。 */
function renamesIn(changes: { path: string; version: string | null }[], known: Known): { from: string; to: string }[] {
  const appeared = changes.filter((c) => c.version !== null && isDoc(c.path) && !known.has(c.path));
  return changes.flatMap((c) => {
    const had = known.get(c.path);
    if (c.version !== null || !had) return [];
    const to = appeared.find((a) => a.version === had);
    return to ? [{ from: c.path, to: to.path }] : [];
  });
}

/** 网关推来的消息 → 通知 watch。自己刚读过 / 写过的那一版（版本和 `known` 里的一样）不算外面的改动。 */
function onPush(m: ServerMessage, known: Known, notify: (change: StoreChange) => void) {
  if (m.type === "relist") return notify({ ids: [], all: true });
  if (m.type !== "changed") return;
  const renamed = renamesIn(m.changes, known);
  for (const r of renamed) {
    known.set(r.to, known.get(r.from) ?? null);
    known.delete(r.from);
  }
  const ids = m.changes.filter((c) => isDoc(c.path) && known.get(c.path) !== c.version).map((c) => c.path);
  for (const c of m.changes) if (known.has(c.path)) known.set(c.path, c.version);
  if (ids.length > 0 || renamed.length > 0) notify(renamed.length > 0 ? { ids, all: false, renamed } : { ids, all: false });
}

/** 网关连接的看护：断了按退避重连（同一时刻只有一个定时器），被拒绝或不用了就停。 */
class Keeper {
  readonly link = signal<GatewayLink>({ state: "connected" });
  readonly watchers = new Set<(change: StoreChange) => void>();
  /** 每篇最近一次读到或写成的版本：网关推来的版本和它一样，就是自己刚写的，不用通知。 */
  readonly known: Known = new Map();
  library = "";
  private session: Session | null = null;
  private readonly reconnected = new Set<() => void>();
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private readonly hooks: SessionHooks = { push: (m) => onPush(m, this.known, (c) => this.notify(c)), closed: (code) => this.closed(code) };

  constructor(
    private readonly connect: Connect,
    private readonly timeoutMs: number,
    private readonly requestMs: number,
  ) {}

  /** 第一次连：连上是 true；连不上是 false，并且不在后台接着连。网关明确拒绝时抛 `GatewayRefused`。 */
  async start(): Promise<boolean> {
    try {
      this.session = await openSession(this.connect, this.hooks, { handshakeMs: this.timeoutMs, requestMs: this.requestMs });
    } catch (e) {
      this.disposed = true;
      if (e instanceof GatewayRefused) throw e;
      console.debug("no local gateway, using browser storage", e);
      return false;
    }
    this.library = this.session.library;
    return true;
  }

  readonly call: Call = (op, params, ms) => (this.session ? this.session.request(op, params, ms) : Promise.reject(new GatewayFailure("disconnected", disconnectedMessage())));

  /** 等到连着（最多 `ms` 毫秒）；等不到或者不再重连是 false。 */
  readonly whenConnected: WhenConnected = (ms) => {
    if (this.session) return Promise.resolve(true);
    if (this.disposed) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = () => resolve(true);
      this.reconnected.add(done);
      setTimeout(() => {
        if (this.reconnected.delete(done)) resolve(false);
      }, ms);
    });
  };

  close() {
    this.disposed = true;
    if (this.retry !== undefined) clearTimeout(this.retry);
    this.retry = undefined;
    this.session?.close();
    this.session = null;
  }

  private notify(change: StoreChange) {
    for (const w of this.watchers) w(change);
  }

  private stop(reason: string) {
    this.disposed = true;
    this.link.set({ state: "stopped", reason });
  }

  private schedule(delay: number) {
    if (this.retry !== undefined || this.disposed) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      void this.reconnect();
    }, delay);
  }

  private backoff() {
    return RETRY_DELAYS[Math.min(this.attempt++, RETRY_DELAYS.length - 1)];
  }

  private closed(code: number) {
    this.session = null;
    if (this.disposed) return;
    const reason = closeReason(code);
    if (reason) return this.stop(reason);
    const why = dropReason(code);
    this.link.set(why ? { state: "reconnecting", reason: why } : { state: "reconnecting" });
    this.schedule(code === CLOSE_BUSY || code === CLOSE_MESSAGE_TOO_BIG ? BUSY_DELAY : this.backoff());
  }

  private async reconnect() {
    let next: Session;
    try {
      next = await openSession(this.connect, this.hooks, { handshakeMs: this.timeoutMs * 4, requestMs: this.requestMs });
    } catch (e) {
      if (e instanceof GatewayRefused) return this.stop(e.message);
      console.debug("gateway still unreachable", e);
      return this.schedule(this.backoff());
    }
    if (this.disposed) return next.close();
    // 网关换了一个文库：手上的 id 都指向别的文件了，不能接着用
    if (next.library !== this.library) {
      this.stop(t(`网关现在开的是文库「${next.library}」，不是这个页面打开时的「${this.library}」。刷新页面后用新的文库`, `The gateway now serves “${next.library}” instead of “${this.library}”. Refresh the page to open the new library.`));
      return next.close();
    }
    this.session = next;
    this.attempt = 0;
    this.link.set({ state: "connected" });
    for (const done of this.reconnected) done();
    this.reconnected.clear();
    this.notify({ ids: [], all: true });
  }
}

/**
 * 试着连网关：`timeoutMs` 内连上并 hello 成功就返回后端；连不上（网关没起、浏览器不让连本机、端口上的程序不说话）返回 null，不报错，也不在后台接着连。
 * 网关明确拒绝（来源、版本）或者端口上的不是 Pairdown 网关时抛 `GatewayRefused`，带给人看的原因。`connect`、`requestMs` 只在测试里换。
 */
export async function openGateway(timeoutMs: number, connect: Connect = webSocketConnect, requestMs = REQUEST_MS): Promise<GatewayBackend | null> {
  const keeper = new Keeper(connect, timeoutMs, requestMs);
  if (!(await keeper.start())) return null;
  const store = gatewayStore(keeper.call, keeper.known, keeper.whenConnected);
  store.watch = (onChange) => {
    keeper.watchers.add(onChange);
    return () => keeper.watchers.delete(onChange);
  };
  return { store, library: () => keeper.library, link: () => keeper.link(), close: () => keeper.close() };
}

type Call = <K extends Op>(op: K, params: Params<K>, ms?: number) => Promise<Result<K>>;
type WhenConnected = (ms: number) => Promise<boolean>;

const failure = (e: unknown) => (e instanceof GatewayFailure ? e : null);
const rethrow = (e: unknown, path: string, action: Action) => {
  const f = failure(e);
  return f ? explain(f, path, action) : e;
};

type Known = Map<string, string | null>;

const fresh = (path: string, text: string, version: string): DocMeta => ({ id: path, name: stemOf(path), title: "", updatedAt: Date.now(), version, size: text.length });

async function readDoc(call: Call, known: Known, id: string) {
  try {
    const r = await call("read", { path: id });
    known.set(id, r.version);
    return r;
  } catch (e) {
    if (failure(e)?.code === "not-found") return null;
    throw rethrow(e, id, "read");
  }
}

async function writeDoc(call: Call, known: Known, id: string, text: string, baseVersion: string): Promise<WriteResult> {
  try {
    const r = await call("write", { path: id, text, baseVersion });
    known.set(id, r.version);
    return { ok: true, meta: fresh(id, text, r.version) };
  } catch (e) {
    const f = failure(e);
    if (f?.code === "conflict") return { ok: false, version: f.version ?? "" };
    if (f?.code === "not-found") return { ok: false, version: "" };
    throw rethrow(e, id, "write");
  }
}

/** 改名的回复没收到（断线）：等重连上，看列表里是不是旧名字没了、新名字有了。 */
async function renameLanded(call: Call, whenConnected: WhenConnected, id: string, to: string): Promise<boolean> {
  if (!(await whenConnected(RENAME_CONFIRM_MS))) return false;
  try {
    const paths = new Set((await call("list", {})).docs.map((d) => d.path));
    return paths.has(to) && !paths.has(id);
  } catch (e) {
    console.warn("rename not confirmed", e);
    return false;
  }
}

/**
 * 只改文档本身的名字（网关不搬它的 assets/）；改成以后从列表里取它的说明。
 * 改名成了就算成了：随后取列表失败（断线）只是拿不到大小和时间，给一份兜底的说明。
 */
async function renameDoc(call: Call, known: Known, whenConnected: WhenConnected, id: string, to: string): Promise<DocMeta> {
  if (to !== id) {
    try {
      await call("rename", { path: id, to });
    } catch (e) {
      const f = failure(e);
      if (f?.code === "exists") throw new NameTaken(t(`文库里已经有「${to}」了`, `The library already contains “${to}”`), to);
      if (f?.code === "not-found") throw new Error(t("这篇文档已经不在了（可能在别处删掉了）", "This document is no longer available. It may have been deleted elsewhere."));
      if (f?.code !== "disconnected") throw rethrow(e, to, "other");
      if (!(await renameLanded(call, whenConnected, id, to))) throw new Error(t("和本机网关断开了，不知道改名成没成。连上以后看看列表里的名字", "The gateway disconnected before confirming the rename. Check the document list after reconnecting."));
    }
    known.set(to, known.get(id) ?? null);
    known.delete(id);
  }
  const fallback: DocMeta = { id: to, name: stemOf(to), title: "", updatedAt: Date.now(), version: "", size: 0 };
  try {
    return (await call("list", {})).docs.map(toMeta).find((d) => d.id === to) ?? fallback;
  } catch (e) {
    console.warn("library not listed after rename", e);
    return fallback;
  }
}

function gatewayStore(call: Call, known: Known, whenConnected: WhenConnected): DocumentStore {
  const pathFor = (dir: string, name: string) => `${dir}${cleanFileStem(name) || "未命名"}.md`;
  return {
    list: async () => (await call("list", {})).docs.map(toMeta),
    read: (id) => readDoc(call, known, id),
    write: (id, text, baseVersion) => writeDoc(call, known, id, text, String(baseVersion)),
    async create(name, text) {
      const path = pathFor("", name);
      try {
        const r = await call("create", { path, text });
        known.set(path, r.version);
        return fresh(path, text, r.version);
      } catch (e) {
        if (failure(e)?.code === "exists") throw new NameTaken(t(`文库里已经有「${path}」了`, `The library already contains “${path}”`), path);
        throw rethrow(e, path, "write");
      }
    },
    rename: (id, name) => renameDoc(call, known, whenConnected, id, pathFor(dirOf(id), name)),
    async remove(id) {
      try {
        await call("remove", { path: id });
      } catch (e) {
        if (failure(e)?.code !== "not-found") throw rethrow(e, id, "other");
      }
      known.delete(id);
    },
    async putAsset(docId, bytes) {
      // 先在页面里挡：太大的图整条消息超过网关的上限，网关只能断开连接、回不了错误码（gateway/README.md「上限」）
      checkImage(bytes, MAX_ASSET_BYTES);
      try {
        return (await call("putAsset", { doc: docId, data: bytesToBase64(bytes) })).src;
      } catch (e) {
        throw rethrow(e, docId, "other");
      }
    },
    async getAsset(docId, src) {
      if (!assetPathFromSrc(docId, src)) return null;
      try {
        // `?v=1`、`#x` 不是文件名的一部分（同 image-file.ts 的 assetPathFromSrc）；网关只认路径
        const r = await call("getAsset", { doc: docId, src: decodeURIComponentSafe(src.trim().replace(/[?#][\s\S]*$/, "")) });
        return { mime: r.mime, bytes: base64ToBytes(r.data) };
      } catch (e) {
        const code = failure(e)?.code;
        if (code === "not-found" || code === "bad-path") return null;
        throw rethrow(e, docId, "other");
      }
    },
    async transfer(docId, url) {
      try {
        return (await call("transfer", { direction: "download", url, doc: docId }, TRANSFER_MS)).src;
      } catch (e) {
        throw transferError(e, docId);
      }
    },
    imageHost: imageHostApi(call),
  };
}

/** 图床的三个请求都经网关；旧网关不认（回 bad-request），读配置时当成「不支持」。 */
function imageHostApi(call: Call): ImageHostApi {
  return {
    async get() {
      try {
        return (await call("imageHost", {})).host;
      } catch (e) {
        if (failure(e)?.code === "bad-request") throw new ImageHostUnsupported(t("本机网关版本太旧，不支持图床。更新网关后再试", "This gateway version does not support image hosting. Update the gateway and try again."));
        throw hostError(e);
      }
    },
    async set(host) {
      try {
        await call("setImageHost", { host });
      } catch (e) {
        // 旧版网关只回中文详情，英文界面统一指出可检查的配置项。
        const f = failure(e);
        throw f?.code === "bad-request" && f.message.trim() ? new Error(t(f.message.trim(), "The gateway rejected the image host settings. Check the URL, repository, branch and directory.")) : hostError(e);
      }
    },
    async upload(bytes) {
      // 同 putAsset：太大的图先在页面挡掉
      checkImage(bytes, MAX_ASSET_BYTES);
      try {
        return (await call("uploadImage", { data: bytesToBase64(bytes) }, TRANSFER_MS)).url;
      } catch (e) {
        throw hostError(e);
      }
    },
  };
}

/** 图床请求失败的原因 → 给人看的一句话。旧版网关只回中文详情，英文界面显示排查提示。 */
function hostError(e: unknown): unknown {
  const f = failure(e);
  switch (f?.code) {
    case "bad-url":
      return new Error(t("上传地址不对（只能是 http / https 的地址）", "Enter an upload URL beginning with http:// or https://."));
    case "no-image-host":
      return new Error(t("还没有设置图床", "No image host has been configured."));
    case "upload-failed":
      return new Error(t(f.message.trim() || "图床没传成（接口不回、超时、返回的不是成功，或者返回里找不到图片地址）", "Could not upload the image. Check the image host settings and try again."));
    case "bad-type":
      return new Error(t("不是认得的图片（只收 png、jpg、gif、webp、avif；SVG 不收）", "Unsupported image format. Use PNG, JPEG, GIF, WebP, or AVIF."));
    case "too-large":
      return new Error(t("图片超过 10 MB，网关不传", "The image exceeds the gateway’s 10 MB upload limit."));
    default:
      return rethrow(e, "", "other");
  }
}

/** 正文里的地址可能 URL 编码过（`%20`），网关要的是解开的（gateway/README.md「页面侧接入要注意」）。 */
function decodeURIComponentSafe(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch (e) {
    console.warn("image address not decodable", e);
    return src;
  }
}

/** 转存失败的原因 → 给人看的一句话（正文不改）。 */
function transferError(e: unknown, docId: string): unknown {
  const f = failure(e);
  switch (f?.code) {
    case "bad-url":
      return new Error(t("地址不对（只能转存 http / https 的图片）", "Only images with HTTP or HTTPS addresses can be saved to the library."));
    case "forbidden-address":
      return new Error(t("这个地址指向本机或内网，网关不去下载", "The gateway cannot download images from local or private network addresses."));
    case "fetch-failed":
      return new Error(t("下载失败（网站不回、超时、或者返回的不是成功）", "The image download failed. Check the address and try again."));
    case "bad-type":
      return new Error(t("下载到的不是认得的图片（只收 png、jpg、gif、webp、avif；SVG 不收）", "The downloaded image uses an unsupported format. Use PNG, JPEG, GIF, WebP, or AVIF."));
    case "too-large":
      return new Error(t("图片超过 10 MB，网关不存", "The image exceeds the gateway’s 10 MB storage limit."));
    default:
      return rethrow(e, docId, "other");
  }
}
