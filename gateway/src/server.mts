import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { checkHost, checkUpgrade } from "./auth.mts";
import { describeError, GatewayError } from "./errors.mts";
import { parseImageHost, readImageHost, uploadImage, viewOf, writeImageHost } from "./image-host.mts";
import type { Library } from "./library.mts";
import {
  CLOSE_BUSY, CLOSE_NO_HELLO, CLOSE_ORIGIN, CLOSE_VERSION, HELLO_TIMEOUT_MS, LISTEN_HOST, MAX_ASSET_BYTES, MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION, type ErrorBody, type Op, type RequestMap, type ServerMessage,
} from "./protocol.ts";
import { defaultTransferDeps, downloadImage, type TransferDeps } from "./transfer.mts";
import { watchLibrary } from "./watch.mts";

export type GatewayOptions = {
  library: Library;
  /** 0 表示随便挑一个空闲端口（测试用）。监听地址固定是 127.0.0.1，没有参数能改。 */
  port: number;
  /** Origin 白名单（auth.ts 的 allowedOrigins）。 */
  origins: readonly string[];
  transfer?: Partial<TransferDeps>;
  limits?: Partial<Limits>;
  log?: (s: string) => void;
  /** 网关的 config.json：图床配置存在里面。不给就没有图床（查是没设置，设置回 not-supported）。 */
  configPath?: string;
  /** 往图床发请求用的 fetch（测试换掉）。 */
  uploadFetch?: typeof fetch;
  /** 连着（已握手）的页面数变了时调。 */
  onClients?: (count: number) => void;
};

/** 防止一个页面（或本机别的程序）把网关拖垮的上限。 */
export type Limits = {
  /** 连上后多久不发 hello 就断开。 */
  helloTimeoutMs: number;
  /** 同时连着的 WebSocket（含还没 hello 的、被拒绝正在关的）。到上限后新连接握手后用 CLOSE_BUSY 关掉。 */
  maxConnections: number;
  /** 同时进行的 transfer 下载，到上限回 busy。 */
  maxTransfers: number;
};

/** maxConnections：一个浏览器标签页一条连接，32 条足够；maxTransfers：一篇文档粘贴多张外链图时够用。 */
const DEFAULT_LIMITS: Limits = { helloTimeoutMs: HELLO_TIMEOUT_MS, maxConnections: 32, maxTransfers: 4 };

/** base64 后的长度上限：不先解码就能挡掉超过 MAX_ASSET_BYTES 的图片。 */
const MAX_ASSET_BASE64 = Math.ceil(MAX_ASSET_BYTES / 3) * 4;

export type Gateway = { port: number; close: () => Promise<void> };

type Msg = Record<string, unknown>;
type Handler = (m: Msg) => Promise<unknown>;

const str = (m: Msg, key: string): string => {
  if (typeof m[key] !== "string") throw new GatewayError("bad-request", `缺少字段 ${key}`);
  return m[key] as string;
};
const optStr = (m: Msg, key: string): string | undefined => (m[key] === undefined ? undefined : str(m, key));

/** 每种请求怎么做。返回值就是回包里的 result。 */
function handlers(lib: Library, transfer: TransferDeps, maxTransfers: number, hostOps: Pick<{ [K in Op]: Handler }, "imageHost" | "setImageHost" | "uploadImage">): { [K in Exclude<Op, "hello">]: Handler } {
  let transfers = 0;
  return {
    ...hostOps,
    list: async () => ({ docs: await lib.list() }),
    read: (m) => lib.read(str(m, "path")),
    write: (m) => lib.write(str(m, "path"), str(m, "text"), str(m, "baseVersion")),
    create: (m) => lib.create(str(m, "path"), optStr(m, "text")),
    rename: async (m) => (await lib.rename(str(m, "path"), str(m, "to")), {}),
    remove: async (m) => (await lib.remove(str(m, "path"), optStr(m, "baseVersion")), {}),
    putAsset: (m) => {
      const data = str(m, "data");
      if (data.length > MAX_ASSET_BASE64) throw new GatewayError("too-large", "图片超过 10 MiB");
      return lib.putAsset(optStr(m, "doc"), Buffer.from(data, "base64"));
    },
    getAsset: async (m) => {
      const a = await lib.getAsset(optStr(m, "doc"), str(m, "src"));
      return { path: a.path, mime: a.mime, data: a.bytes.toString("base64") };
    },
    transfer: async (m) => {
      const direction = str(m, "direction");
      if (direction === "upload") throw new GatewayError("not-supported", "上传到图床还没做");
      if (direction !== "download") throw new GatewayError("bad-request", `不认识的 direction：${direction}`);
      const doc = optStr(m, "doc");
      const url = str(m, "url");
      if (transfers >= maxTransfers) throw new GatewayError("busy", "同时下载的图片太多，稍后再试");
      transfers++;
      try {
        const { path, src } = await lib.putAsset(doc, await downloadImage(url, transfer));
        return { path, src };
      } finally {
        transfers--;
      }
    },
  };
}

/** 图床的三个请求。上传和下载共用不了计数，但一次只传一张、有超时，不另设上限。 */
function imageHostHandlers(configPath: string | undefined, fetchFn: typeof fetch | undefined): Pick<{ [K in Op]: Handler }, "imageHost" | "setImageHost" | "uploadImage"> {
  const current = () => (configPath ? readImageHost(configPath) : Promise.resolve(null));
  return {
    imageHost: async () => {
      const host = await current();
      return { host: host ? viewOf(host) : null };
    },
    setImageHost: async (m) => {
      if (!configPath) throw new GatewayError("not-supported", "这个网关没有配置文件，存不了图床设置");
      await writeImageHost(configPath, m.host === null ? null : parseImageHost(m.host, await current()));
      return {};
    },
    uploadImage: async (m) => {
      const data = str(m, "data");
      if (data.length > MAX_ASSET_BASE64) throw new GatewayError("too-large", "图片超过 10 MiB");
      const host = await current();
      if (!host) throw new GatewayError("no-image-host", "还没有设置图床");
      return { url: await uploadImage(host, Buffer.from(data, "base64"), fetchFn) };
    },
  };
}

const send = (ws: WebSocket, msg: ServerMessage) => ws.send(JSON.stringify(msg));

function parse(data: unknown): { id: number; op: string; msg: Msg } | null {
  try {
    const msg = JSON.parse(String(data)) as Msg;
    if (typeof msg !== "object" || msg === null || !Number.isInteger(msg.id) || typeof msg.op !== "string") return null;
    return { id: msg.id as number, op: msg.op, msg };
  } catch {
    return null;
  }
}

/** 写进日志的请求头：截断，去掉控制字符（防止伪造日志行、终端转义）。 */
function clean(s: string | undefined): string {
  if (s === undefined) return "<无>";
  const t = s.replace(/\p{Cc}/gu, "?");
  return t.length > 120 ? `${t.slice(0, 120)}…` : t;
}

/** 一条连接：先 hello（限时），之后按 op 分派；每个请求回一个同 id 的 reply。 */
function serveConnection(ws: WebSocket, lib: Library, table: ReturnType<typeof handlers>, helloTimeoutMs: number, onReady: () => void, log: (s: string) => void) {
  let ready = false;
  const fail = (id: number, error: ErrorBody) => send(ws, { type: "reply", id, ok: false, error });
  const helloTimer = setTimeout(() => ws.close(CLOSE_NO_HELLO, "hello timeout"), helloTimeoutMs);
  ws.on("close", () => clearTimeout(helloTimer));
  ws.on("message", (data, isBinary) => {
    const req = isBinary ? null : parse(data);
    if (!ready) {
      if (!req || req.op !== "hello") return ws.close(CLOSE_NO_HELLO, "hello first");
      if (req.msg.version !== PROTOCOL_VERSION) {
        fail(req.id, { code: "version-mismatch", message: `网关的协议版本是 ${PROTOCOL_VERSION}` });
        return ws.close(CLOSE_VERSION, "version mismatch");
      }
      ready = true;
      clearTimeout(helloTimer);
      onReady();
      const result: RequestMap["hello"]["result"] = { version: PROTOCOL_VERSION, library: lib.name };
      return send(ws, { type: "reply", id: req.id, ok: true, result });
    }
    if (!req) return fail(-1, { code: "bad-request", message: "消息不是带 id 和 op 的 JSON" });
    const handler = Object.hasOwn(table, req.op) ? table[req.op as keyof typeof table] : undefined;
    if (!handler) return fail(req.id, { code: "bad-request", message: `不认识的 op：${req.op}` });
    // 参数检查会同步抛错，包一层才能一样回成错误
    Promise.resolve(req.msg).then(handler).then(
      (result) => send(ws, { type: "reply", id: req.id, ok: true, result } as ServerMessage),
      (e: unknown) => {
        if (e instanceof GatewayError) return fail(req.id, { code: e.code, message: e.message, ...(e.version ? { version: e.version } : {}) });
        log(`${req.op} 出错：${describeError(e)}`);
        fail(req.id, { code: "internal", message: "网关内部错误" });
      },
    );
  });
}

/** 启动网关：HTTP 只用来升级 WebSocket，别的请求一律 404。 */
export async function startGateway(opts: GatewayOptions): Promise<Gateway> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const table = handlers(opts.library, { ...defaultTransferDeps, ...opts.transfer }, limits.maxTransfers, imageHostHandlers(opts.configPath, opts.uploadFetch));
  const http = createServer((_req, res) => res.writeHead(404).end());
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const live = new Set<WebSocket>();
  let port = opts.port;

  const refuse = (socket: Duplex, status: string) =>
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
  // 超限消息、非法帧时 ws 会发 error 再自己关连接（1009 / 1002）；不挂监听，error 没人接，整个进程会退出
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer, then: (ws: WebSocket) => void) =>
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", (e) => log(`连接出错：${describeError(e)}`));
      then(ws);
    });
  // 拒绝 Origin、连接太多也先完成握手：浏览器只有握手成功后才看得到关闭码
  http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    if (!checkHost(req.headers.host, port)) {
      log(`拒绝 WebSocket：Host 是 ${clean(req.headers.host)}`);
      return refuse(socket, "421 Misdirected Request");
    }
    if (!checkUpgrade(req.headers.origin, opts.origins)) {
      log(`拒绝 Origin：${clean(req.headers.origin)}`);
      return upgrade(req, socket, head, (ws) => ws.close(CLOSE_ORIGIN, "origin not allowed"));
    }
    if (wss.clients.size >= limits.maxConnections) {
      log(`拒绝 WebSocket：已有 ${wss.clients.size} 条连接`);
      return upgrade(req, socket, head, (ws) => ws.close(CLOSE_BUSY, "too many connections"));
    }
    upgrade(req, socket, head, (ws) => {
      serveConnection(ws, opts.library, table, limits.helloTimeoutMs, () => {
        live.add(ws);
        opts.onClients?.(live.size);
      }, log);
      ws.on("close", () => {
        if (live.delete(ws)) opts.onClients?.(live.size);
      });
    });
  });

  const broadcast = (e: ServerMessage) => {
    for (const ws of live) send(ws, e);
  };
  const stopWatch = watchLibrary(opts.library, broadcast, log);

  await new Promise<void>((res, rej) => {
    http.once("error", rej);
    http.listen(opts.port, LISTEN_HOST, () => res());
  }).catch((e) => {
    stopWatch();
    throw e;
  });
  const addr = http.address();
  port = typeof addr === "object" && addr ? addr.port : opts.port;
  return {
    port,
    close: async () => {
      stopWatch();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((res) => wss.close(() => res()));
      await new Promise<void>((res) => http.close(() => res()));
    },
  };
}
