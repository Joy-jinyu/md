import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { WebSocket } from "ws";
import { allowedOrigins } from "../src/auth.mts";
import { Library } from "../src/library.mts";
import { PROTOCOL_VERSION, type ChangedEvent, type Reply } from "../src/protocol.ts";
import { startGateway, type GatewayOptions } from "../src/server.mts";

export const TEST_ORIGIN = "http://127.0.0.1:8811";

/** 1×1 的 PNG。 */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until<T>(get: () => T | undefined, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = get();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("等超时");
    await sleep(10);
  }
}

export type Client = {
  ws: WebSocket;
  closed: Promise<number>;
  events: ChangedEvent[];
  /** 除 reply 和 changed 以外网关主动推的消息（如 relist）。 */
  signals: { type: string }[];
  request: (op: string, params?: Record<string, unknown>) => Promise<Reply>;
};

/** 连网关；origin 为 undefined 时不带 Origin 头。连上不自动 hello。 */
export function rawClient(t: TestContext, port: number, origin: string | undefined, host?: string): Client {
  const headers: Record<string, string> = {};
  if (origin !== undefined) headers.Origin = origin;
  if (host !== undefined) headers.Host = host;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers });
  const replies = new Map<number, (r: Reply) => void>();
  const events: ChangedEvent[] = [];
  const signals: { type: string }[] = [];
  let next = 1;
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.type === "changed") events.push(m);
    else if (m.type === "reply") replies.get(m.id)?.(m);
    else signals.push(m);
  });
  ws.on("error", () => undefined);
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  t.after(() => ws.terminate());
  const request = async (op: string, params: Record<string, unknown> = {}) => {
    if (ws.readyState === WebSocket.CONNECTING) await new Promise((r) => ws.once("open", r));
    const id = next++;
    const p = new Promise<Reply>((r) => replies.set(id, r));
    ws.send(JSON.stringify({ id, op, ...params }));
    return p;
  };
  return { ws, closed, events, signals, request };
}

/** 新建一个临时文库，起网关（随机端口），白名单只有 TEST_ORIGIN 和线上来源。 */
export async function setup(t: TestContext, more: Partial<GatewayOptions> = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pairdown-lib-")));
  const outside = await realpath(await mkdtemp(join(tmpdir(), "pairdown-outside-")));
  const logs: string[] = [];
  const library = await Library.open(dir, (s) => logs.push(s));
  const gw = await startGateway({ library, port: 0, origins: allowedOrigins([TEST_ORIGIN]), log: (s) => logs.push(s), ...more });
  t.after(async () => {
    await gw.close();
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const connect = async () => {
    const c = rawClient(t, gw.port, TEST_ORIGIN);
    const r = await c.request("hello", { version: PROTOCOL_VERSION });
    if (!r.ok) throw new Error(`hello 失败：${r.error.code}`);
    return c;
  };
  return { dir, outside, logs, port: gw.port, connect };
}

/** 断言回包失败并返回错误码。 */
export function codeOf(r: Reply): string {
  if (r.ok) throw new Error(`本该失败，却成功了：${JSON.stringify(r.result)}`);
  return r.error.code;
}

export function resultOf<T = Record<string, unknown>>(r: Reply): T {
  if (!r.ok) throw new Error(`本该成功，却失败了：${r.error.code} ${r.error.message}`);
  return r.result as T;
}
