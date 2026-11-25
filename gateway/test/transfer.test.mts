import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { isForbiddenAddress, type TransferDeps } from "../src/transfer.mts";
import { codeOf, PNG, resultOf, setup } from "./helpers.mts";

/** 本地 http 服务当外链。 */
async function imageHost(t: TestContext) {
  const hits: string[] = [];
  const srv: Server = createServer((req, res) => {
    hits.push(req.url ?? "");
    const port = (srv.address() as { port: number }).port;
    const routes: Record<string, () => void> = {
      "/img.png": () => res.writeHead(200, { "content-type": "image/png" }).end(PNG),
      "/big.png": () => res.writeHead(200, { "content-type": "image/png" }).end(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)])),
      "/chunked.png": () => {
        res.writeHead(200, { "content-type": "image/png" });
        res.write(PNG);
        res.end(Buffer.alloc(10 * 1024 * 1024));
      },
      "/page.html": () => res.writeHead(200, { "content-type": "text/html" }).end("<html>"),
      "/x.svg": () => res.writeHead(200, { "content-type": "image/svg+xml" }).end("<svg/>"),
      "/fake.png": () => res.writeHead(200, { "content-type": "image/png" }).end("<html>"),
      "/missing.png": () => res.writeHead(404).end(),
      "/to-public": () => res.writeHead(302, { location: `http://pub.test:${port}/img.png` }).end(),
      "/to-internal": () => res.writeHead(302, { location: `http://intranet.test:${port}/img.png` }).end(),
      "/to-loopback": () => res.writeHead(302, { location: `http://127.0.0.2:${port}/img.png` }).end(),
      "/to-file": () => res.writeHead(302, { location: "file:///etc/passwd" }).end(),
    };
    (routes[req.url ?? ""] ?? (() => res.writeHead(404).end()))();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  t.after(() => new Promise<void>((r) => srv.close(() => r())));
  return { port: (srv.address() as { port: number }).port, hits };
}

/** 注入的解析器：pub.test 是「公网」（指向本地服务），intranet.test 解析到内网地址。 */
const fakeDns: Pick<TransferDeps, "resolve" | "forbidden"> = {
  resolve: async (host) => ({ "pub.test": ["127.0.0.1"], "intranet.test": ["10.0.0.7"], "mixed.test": ["127.0.0.1", "192.168.1.2"] })[host] ?? [],
  forbidden: (a) => a !== "127.0.0.1" && isForbiddenAddress(a),
};

test("isForbiddenAddress：回环、内网、链路本地、运营商 NAT、组播、IPv4 映射都挡；公网放行", () => {
  for (const a of ["127.0.0.1", "127.8.9.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "ff02::1", "not-an-ip"]) {
    assert.equal(isForbiddenAddress(a), true, a);
  }
  for (const a of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) assert.equal(isForbiddenAddress(a), false, a);
});

test("transfer download：外链图片存进 assets/，返回相对 doc 的地址", async (t) => {
  const host = await imageHost(t);
  const { dir, connect } = await setup(t, { transfer: fakeDns });
  const c = await connect();
  const r = resultOf<{ path: string; src: string }>(await c.request("transfer", { direction: "download", url: `http://pub.test:${host.port}/img.png`, doc: "a.md" }));
  const name = `${createHash("sha256").update(PNG).digest("hex").slice(0, 16)}.png`;
  assert.deepEqual(r, { path: `assets/${name}`, src: `assets/${name}` });
  assert.deepEqual(await readdir(join(dir, "assets")), [name]);
  const viaRedirect = resultOf<{ path: string }>(await c.request("transfer", { direction: "download", url: `http://pub.test:${host.port}/to-public` }));
  assert.equal(viaRedirect.path, r.path);
});

test("transfer 拒绝：非 http(s)、不是图片、SVG、文件头不对、超过 10 MiB、非 2xx", async (t) => {
  const host = await imageHost(t);
  const { dir, connect } = await setup(t, { transfer: fakeDns });
  const c = await connect();
  const base = `http://pub.test:${host.port}`;
  const cases: [string, string][] = [
    ["file:///etc/passwd", "bad-url"],
    ["javascript:alert(1)", "bad-url"],
    ["ftp://pub.test/x.png", "bad-url"],
    ["not a url", "bad-url"],
    [`${base}/page.html`, "bad-type"],
    [`${base}/x.svg`, "bad-type"],
    [`${base}/fake.png`, "bad-type"],
    [`${base}/big.png`, "too-large"],
    [`${base}/chunked.png`, "too-large"],
    [`${base}/missing.png`, "fetch-failed"],
    [`${base}/to-file`, "bad-url"],
  ];
  for (const [url, code] of cases) assert.equal(codeOf(await c.request("transfer", { direction: "download", url })), code, url);
  await assert.rejects(readdir(join(dir, "assets")), { code: "ENOENT" });
});

test("transfer 拒绝内网：解析到内网、多个地址里有一个内网、重定向到内网 / 回环，都不连", async (t) => {
  const host = await imageHost(t);
  const { connect } = await setup(t, { transfer: fakeDns });
  const c = await connect();
  const before = host.hits.length;
  for (const url of [`http://intranet.test:${host.port}/img.png`, `http://mixed.test:${host.port}/img.png`, "http://[::1]/img.png", "http://169.254.169.254/latest/meta-data"]) {
    assert.equal(codeOf(await c.request("transfer", { direction: "download", url })), "forbidden-address", url);
  }
  assert.equal(host.hits.length, before, "内网地址一次都没连");
  for (const path of ["/to-internal", "/to-loopback"]) {
    const r = await c.request("transfer", { direction: "download", url: `http://pub.test:${host.port}${path}` });
    assert.equal(codeOf(r), "forbidden-address", path);
  }
  assert.deepEqual(host.hits.slice(before), ["/to-internal", "/to-loopback"]);
});

test("默认规则下本地服务（127.0.0.1）不下载；upload 方向回 not-supported", async (t) => {
  const host = await imageHost(t);
  const { connect } = await setup(t);
  const c = await connect();
  assert.equal(codeOf(await c.request("transfer", { direction: "download", url: `http://127.0.0.1:${host.port}/img.png` })), "forbidden-address");
  assert.equal(codeOf(await c.request("transfer", { direction: "download", url: `http://localhost:${host.port}/img.png` })), "forbidden-address");
  assert.equal(host.hits.length, 0);
  assert.equal(codeOf(await c.request("transfer", { direction: "upload", url: "https://example.com/x.png" })), "not-supported");
});
