import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { connect as tcpConnect } from "node:net";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import * as P from "../src/protocol.ts";
import { isForbiddenAddress, type TransferDeps } from "../src/transfer.mts";
import { codeOf, PNG, rawClient, resultOf, setup, sleep, TEST_ORIGIN, until } from "./helpers.mts";

/**
 * 不经 ws 客户端，直接在 TCP 上握手并紧跟着发 frame（ws 客户端发不出非法帧）。返回收到的全部字节。
 * waitClose：等网关关掉连接；否则收到第一段回应就自己断开（不回关闭帧时网关要等 30 秒才关）。
 */
function rawUpgrade(port: number, headers: Record<string, string>, frame: Buffer, waitClose = true): Promise<string> {
  const s = tcpConnect(port, "127.0.0.1");
  const lines = [
    "GET / HTTP/1.1", "Upgrade: websocket", "Connection: Upgrade",
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13",
    ...Object.entries({ Host: `127.0.0.1:${port}`, ...headers }).map(([k, v]) => `${k}: ${v}`),
  ];
  s.write(Buffer.concat([Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "latin1"), frame]));
  const got: Buffer[] = [];
  s.on("data", (d) => {
    got.push(d);
    if (!waitClose) s.destroy();
  });
  return new Promise((r) => {
    s.on("close", () => r(Buffer.concat(got).toString("latin1")));
    s.on("error", () => undefined);
  });
}

const MASK = [1, 2, 3, 4];
/** 文本帧头，声明 32 MiB 长度（超过 16 MiB 上限），不带正文。 */
const HUGE_FRAME = Buffer.from([0x81, 0xff, 0, 0, 0, 0, 0x02, 0, 0, 0, ...MASK]);
/** 保留的 opcode 3：非法帧。 */
const BAD_OPCODE = Buffer.from([0x83, 0x80, ...MASK]);

test("超过消息上限、非法帧：只断这条连接，网关不退出（白名单内、被拒 Origin、没 hello 的连接都一样）", async (t) => {
  const { port, connect } = await setup(t);
  for (const origin of [TEST_ORIGIN, "https://evil.example"]) {
    for (const frame of [HUGE_FRAME, BAD_OPCODE]) {
      const got = await rawUpgrade(port, { Origin: origin }, frame);
      assert.match(got, /^HTTP\/1\.1 101/, `${origin} 先握手`);
    }
  }
  const c = await connect();
  c.ws.send("x".repeat(P.MAX_MESSAGE_BYTES + 1));
  assert.equal(await c.closed, P.CLOSE_MESSAGE_TOO_BIG);
  const after = await connect();
  assert.ok(Array.isArray(resultOf<{ docs: unknown[] }>(await after.request("list")).docs), "网关还活着");
});

test("putAsset 图片大小：超过 10 MiB 但消息没超限 → too-large；消息本身超限 → 1009 断开，网关不退出", async (t) => {
  const { connect } = await setup(t);
  const c = await connect();
  const mib = 1024 * 1024;
  const over = Buffer.concat([PNG, Buffer.alloc(11 * mib)]);
  assert.equal(codeOf(await c.request("putAsset", { data: over.toString("base64") })), "too-large");
  const huge = Buffer.concat([PNG, Buffer.alloc(Math.ceil(12.5 * mib))]);
  void c.request("putAsset", { data: huge.toString("base64") });
  assert.equal(await c.closed, P.CLOSE_MESSAGE_TOO_BIG);
  const after = await connect();
  assert.equal(resultOf<{ existed: boolean }>(await after.request("putAsset", { data: PNG.toString("base64") })).existed, false);
});

test("op 不走原型链：constructor、toString、__proto__ 都回 bad-request", async (t) => {
  const { connect } = await setup(t);
  const c = await connect();
  for (const op of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    assert.equal(codeOf(await c.request(op)), "bad-request", op);
  }
});

test("不发 hello 的连接超时断开；连接数到上限后新连接 4004", async (t) => {
  const { port, connect } = await setup(t, { limits: { helloTimeoutMs: 100, maxConnections: 2 } });
  const idle = rawClient(t, port, TEST_ORIGIN);
  assert.equal(await idle.closed, P.CLOSE_NO_HELLO);
  const a = await connect();
  await connect();
  assert.equal(await rawClient(t, port, TEST_ORIGIN).closed, P.CLOSE_BUSY);
  a.ws.close();
  await a.closed;
  await sleep(50);
  const again = await connect();
  assert.ok(resultOf(await again.request("list")));
});

/** 收到请求后一直不回，直到调用 release。 */
async function slowHost(t: TestContext) {
  const held: ServerResponse[] = [];
  const srv = createServer((_req, res) => void held.push(res));
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  t.after(() => new Promise<void>((r) => srv.close(() => r())));
  const release = () => held.splice(0).forEach((res) => res.writeHead(200, { "content-type": "image/png" }).end(PNG));
  return { port: (srv.address() as { port: number }).port, held, release };
}

test("transfer 并发到上限 → busy，之前的照常完成", async (t) => {
  const host = await slowHost(t);
  const transfer: Partial<TransferDeps> = { resolve: async () => ["127.0.0.1"], forbidden: () => false };
  const { connect } = await setup(t, { transfer, limits: { maxTransfers: 1 } });
  const c = await connect();
  const url = `http://pub.test:${host.port}/a.png`;
  const first = c.request("transfer", { direction: "download", url });
  await until(() => (host.held.length > 0 ? true : undefined));
  assert.equal(codeOf(await c.request("transfer", { direction: "download", url })), "busy");
  host.release();
  assert.ok(resultOf<{ path: string }>(await first).path.startsWith("assets/"));
  const third = c.request("transfer", { direction: "download", url });
  await until(() => (host.held.length > 0 ? true : undefined));
  host.release();
  assert.ok(resultOf(await third));
});

test("isForbiddenAddress：6to4、本地 NAT64、IPv4 兼容地址也挡", () => {
  for (const a of ["2002:a00:1::1", "2002:7f00:1::", "64:ff9b:1::a00:1", "::a00:1", "::7f00:1"]) assert.equal(isForbiddenAddress(a), true, a);
  for (const a of ["2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(isForbiddenAddress(a), false, a);
});

test("日志：Host / Origin 截断并去掉控制字符；文件错误不带绝对路径", async (t) => {
  const { dir, port, logs, connect } = await setup(t);
  await rawUpgrade(port, { Host: `evil${"h".repeat(5000)}`, Origin: TEST_ORIGIN }, Buffer.alloc(0), false);
  await rawUpgrade(port, { Origin: `https://evil${"o".repeat(5000)}` }, Buffer.alloc(0), false);
  await rawUpgrade(port, { Origin: "https://evil\x1b[31m.example" }, Buffer.alloc(0), false);
  await writeFile(join(dir, "locked.md"), "x");
  await chmod(join(dir, "locked.md"), 0o000);
  const c = await connect();
  assert.equal(codeOf(await c.request("read", { path: "locked.md" })), "internal");
  await chmod(join(dir, "locked.md"), 0o644);
  assert.ok(logs.length >= 3, logs.join("\n"));
  for (const l of logs) {
    assert.ok(l.length <= 400, `日志太长：${l.length}`);
    assert.doesNotMatch(l, /[\x00-\x1f\x7f]/, "日志里有控制字符");
    assert.ok(!l.includes(dir), `日志带了绝对路径：${l}`);
  }
});
