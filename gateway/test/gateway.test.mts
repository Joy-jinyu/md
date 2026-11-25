import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { connect as tcpConnect } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLOSE_NO_HELLO, CLOSE_ORIGIN, CLOSE_VERSION, OFFICIAL_ORIGIN, PROTOCOL_VERSION } from "../src/protocol.ts";
import { codeOf, PNG, rawClient, resultOf, setup, until } from "./helpers.mts";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

test("hello 回协议版本和文库名；list 只列 .md，不含 assets/、隐藏文件和别的文件", async (t) => {
  const { dir, port } = await setup(t);
  await mkdir(join(dir, "notes", "assets"), { recursive: true });
  await writeFile(join(dir, "a.md"), "A");
  await writeFile(join(dir, "notes", "b.md"), "BB");
  await writeFile(join(dir, "notes", "assets", "c.md"), "x");
  await writeFile(join(dir, ".hidden.md"), "x");
  await writeFile(join(dir, "readme.txt"), "x");
  const c = rawClient(t, port, OFFICIAL_ORIGIN);
  const hello = resultOf<{ version: number; library: string }>(await c.request("hello", { version: PROTOCOL_VERSION }));
  assert.equal(hello.version, PROTOCOL_VERSION);
  assert.ok(dir.endsWith(hello.library));
  const { docs } = resultOf<{ docs: { path: string; size: number }[] }>(await c.request("list"));
  assert.deepEqual(docs.map((d) => [d.path, d.size]), [["a.md", 1], ["notes/b.md", 2]]);
});

test("读写：带对的 baseVersion 能写，版本是内容的 SHA-256；不留临时文件", async (t) => {
  const { dir, connect } = await setup(t);
  const c = await connect();
  const created = resultOf<{ version: string }>(await c.request("create", { path: "a.md", text: "第一版" }));
  assert.equal(created.version, sha("第一版"));
  const w = resultOf<{ version: string }>(await c.request("write", { path: "a.md", text: "第二版", baseVersion: created.version }));
  assert.equal(w.version, sha("第二版"));
  assert.deepEqual(resultOf(await c.request("read", { path: "a.md" })), { text: "第二版", version: w.version });
  assert.equal(await readFile(join(dir, "a.md"), "utf8"), "第二版");
  assert.deepEqual(await readdir(dir), ["a.md"]);
});

test("版本冲突：外面改过（大小不变）后用旧版本写，拒绝并返回当前版本，不覆盖", async (t) => {
  const { dir, connect } = await setup(t);
  const c = await connect();
  const { version } = resultOf<{ version: string }>(await c.request("create", { path: "a.md", text: "abc" }));
  await writeFile(join(dir, "a.md"), "xyz");
  const r = await c.request("write", { path: "a.md", text: "mine", baseVersion: version });
  assert.equal(codeOf(r), "conflict");
  assert.equal(!r.ok && r.error.version, sha("xyz"));
  assert.equal(await readFile(join(dir, "a.md"), "utf8"), "xyz");
  assert.equal(codeOf(await c.request("remove", { path: "a.md", baseVersion: version })), "conflict");
  assert.equal(await readFile(join(dir, "a.md"), "utf8"), "xyz");
});

test("create / rename 不覆盖已有文件；改名、删除生效", async (t) => {
  const { dir, connect } = await setup(t);
  const c = await connect();
  resultOf(await c.request("create", { path: "a.md", text: "A" }));
  resultOf(await c.request("create", { path: "sub/b.md", text: "B" }));
  assert.equal(codeOf(await c.request("create", { path: "a.md", text: "new" })), "exists");
  assert.equal(codeOf(await c.request("rename", { path: "a.md", to: "sub/b.md" })), "exists");
  assert.equal(await readFile(join(dir, "a.md"), "utf8"), "A");
  assert.equal(await readFile(join(dir, "sub", "b.md"), "utf8"), "B");
  resultOf(await c.request("rename", { path: "a.md", to: "c.md" }));
  assert.equal(codeOf(await c.request("read", { path: "a.md" })), "not-found");
  assert.equal(resultOf<{ text: string }>(await c.request("read", { path: "c.md" })).text, "A");
  resultOf(await c.request("remove", { path: "c.md" }));
  assert.equal(codeOf(await c.request("read", { path: "c.md" })), "not-found");
});

test("Origin：白名单外、没有 Origin、相近的写法一律 4003；线上来源能连", async (t) => {
  const { port } = await setup(t);
  const bad = ["https://evil.example", "http://markdown.pairwise.site", "https://markdown.pairwise.site.evil.example", `http://127.0.0.1:${port}`, "null", undefined];
  for (const origin of bad) {
    const c = rawClient(t, port, origin);
    assert.equal(await c.closed, CLOSE_ORIGIN, String(origin));
  }
  const ok = rawClient(t, port, OFFICIAL_ORIGIN);
  assert.equal((await ok.request("hello", { version: PROTOCOL_VERSION })).ok, true);
});

test("Host 头不是 127.0.0.1 / localhost（DNS rebinding）→ 不握手", async (t) => {
  const { port } = await setup(t);
  const c = rawClient(t, port, OFFICIAL_ORIGIN, `evil.example:${port}`);
  const status = await new Promise<number>((r) => c.ws.on("unexpected-response", (_req, res) => r(res.statusCode ?? 0)));
  assert.equal(status, 421);
});

test("没 hello 先发别的 → 4000；协议版本不同 → version-mismatch 后 4002", async (t) => {
  const { port } = await setup(t);
  const a = rawClient(t, port, OFFICIAL_ORIGIN);
  void a.request("list");
  assert.equal(await a.closed, CLOSE_NO_HELLO);
  const b = rawClient(t, port, OFFICIAL_ORIGIN);
  assert.equal(codeOf(await b.request("hello", { version: PROTOCOL_VERSION + 1 })), "version-mismatch");
  assert.equal(await b.closed, CLOSE_VERSION);
});

test("路径穿越：..、绝对路径、隐藏文件、非 .md 都拒绝", async (t) => {
  const { outside, connect } = await setup(t);
  await writeFile(join(outside, "secret.md"), "secret");
  const c = await connect();
  const paths = ["../secret.md", "a/../../secret.md", "sub/../a.md", "./a.md", join(outside, "secret.md"), "/etc/passwd", "C:/x.md", "a\\..\\b.md", ".git/config.md", "a.txt", "assets/x.md", "", "a//b.md"];
  for (const path of paths) {
    assert.equal(codeOf(await c.request("read", { path })), "bad-path", path);
    assert.equal(codeOf(await c.request("create", { path, text: "x" })), "bad-path", path);
  }
  assert.equal(codeOf(await c.request("read", { path: 42 })), "bad-request");
  assert.deepEqual(await readdir(outside), ["secret.md"]);
});

test("符号链接跳出文库：读、写、建、改名、删都拒绝；指向文库内的链接照常读", async (t) => {
  const { dir, outside, connect } = await setup(t);
  await writeFile(join(outside, "secret.md"), "secret");
  await symlink(outside, join(dir, "link"));
  await symlink(join(outside, "secret.md"), join(dir, "evil.md"));
  await writeFile(join(dir, "a.md"), "A");
  await symlink(join(dir, "a.md"), join(dir, "alias.md"));
  const c = await connect();
  const v = sha("secret");
  for (const [op, params] of [
    ["read", { path: "link/secret.md" }],
    ["read", { path: "evil.md" }],
    ["write", { path: "evil.md", text: "pwned", baseVersion: v }],
    ["write", { path: "link/secret.md", text: "pwned", baseVersion: v }],
    ["create", { path: "link/new.md", text: "x" }],
    ["rename", { path: "a.md", to: "link/a.md" }],
    ["rename", { path: "evil.md", to: "mine.md" }],
    ["remove", { path: "evil.md" }],
  ] as const) {
    assert.equal(codeOf(await c.request(op, params)), "bad-path", `${op} ${JSON.stringify(params)}`);
  }
  assert.deepEqual((await readdir(outside)).sort(), ["secret.md"]);
  assert.equal(await readFile(join(outside, "secret.md"), "utf8"), "secret");
  assert.equal(resultOf<{ text: string }>(await c.request("read", { path: "alias.md" })).text, "A");
});

test("putAsset：同一张图只存一份，存在文档旁边的 assets/；getAsset 取回字节", async (t) => {
  const { dir, connect } = await setup(t);
  const c = await connect();
  const data = PNG.toString("base64");
  const first = resultOf<{ path: string; src: string; existed: boolean }>(await c.request("putAsset", { doc: "notes/a.md", data }));
  const name = `${sha(PNG).slice(0, 16)}.png`;
  assert.deepEqual(first, { path: `notes/assets/${name}`, src: `assets/${name}`, existed: false });
  const again = resultOf<{ existed: boolean; path: string }>(await c.request("putAsset", { doc: "notes/a.md", data }));
  assert.deepEqual([again.path, again.existed], [first.path, true]);
  assert.deepEqual(await readdir(join(dir, "notes", "assets")), [name]);
  const got = resultOf<{ mime: string; data: string }>(await c.request("getAsset", { doc: "notes/a.md", src: first.src }));
  assert.deepEqual([got.mime, Buffer.from(got.data, "base64").equals(PNG)], ["image/png", true]);
  const root = resultOf<{ path: string; src: string }>(await c.request("putAsset", { data }));
  assert.deepEqual(root, { path: `assets/${name}`, src: `assets/${name}`, existed: false });
});

test("putAsset / getAsset 的拒绝：不是图片、超过 10 MiB、跳出文库、SVG", async (t) => {
  const { dir, outside, connect } = await setup(t);
  const c = await connect();
  assert.equal(codeOf(await c.request("putAsset", { data: Buffer.from("<html>").toString("base64") })), "bad-type");
  assert.equal(codeOf(await c.request("putAsset", { data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString("base64") })), "bad-type");
  const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);
  assert.equal(codeOf(await c.request("putAsset", { data: big.toString("base64") })), "too-large");
  assert.equal(codeOf(await c.request("putAsset", { doc: "../x.md", data: PNG.toString("base64") })), "bad-path");
  await writeFile(join(outside, "x.png"), PNG);
  await symlink(outside, join(dir, "assets"));
  for (const src of ["../outside/x.png", "assets/../../x.png", "/etc/x.png", "file:///etc/x.png", "assets/x.svg", "assets/x.png", "x.png"]) {
    assert.equal(codeOf(await c.request("getAsset", { src })), "bad-path", src);
  }
  assert.equal(codeOf(await c.request("putAsset", { data: PNG.toString("base64") })), "bad-path");
  assert.deepEqual(await readdir(outside), ["x.png"]);
});

test("外部改文件 → 推 changed，带新内容的版本；删掉 → version 为 null", async (t) => {
  const { dir, connect } = await setup(t);
  await writeFile(join(dir, "a.md"), "old");
  const c = await connect();
  await writeFile(join(dir, "a.md"), "changed outside");
  const hit = await until(() => c.events.flatMap((e) => e.changes).find((x) => x.path === "a.md" && x.version === sha("changed outside")));
  assert.ok(hit);
  await unlink(join(dir, "a.md"));
  await until(() => c.events.flatMap((e) => e.changes).find((x) => x.path === "a.md" && x.version === null));
});

test("只听 127.0.0.1：本机别的网卡地址连不上", async (t) => {
  const { port } = await setup(t);
  const addr = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  if (!addr) return t.skip("本机没有非回环的 IPv4 地址");
  const err = await new Promise<string>((r) => {
    const s = tcpConnect(port, addr, () => (s.destroy(), r("connected")));
    s.on("error", (e: NodeJS.ErrnoException) => r(e.code ?? "error"));
  });
  assert.equal(err, "ECONNREFUSED");
});
