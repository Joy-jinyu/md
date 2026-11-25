import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Library } from "../src/library.mts";
import * as P from "../src/protocol.ts";
import { codeOf, PNG, resultOf, setup, until } from "./helpers.mts";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
type Docs = { docs: { path: string; problem?: string }[] };

test("非 UTF-8 文档：read 回 not-utf8，list 标出来，write 不覆盖", async (t) => {
  const { dir, connect } = await setup(t);
  const gbk = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  await writeFile(join(dir, "gbk.md"), gbk);
  await writeFile(join(dir, "ok.md"), "好");
  const c = await connect();
  assert.equal(codeOf(await c.request("read", { path: "gbk.md" })), "not-utf8");
  const { docs } = resultOf<Docs>(await c.request("list"));
  assert.deepEqual(docs.map((d) => [d.path, d.problem]), [["gbk.md", "not-utf8"], ["ok.md", undefined]]);
  assert.equal(codeOf(await c.request("write", { path: "gbk.md", text: "坏", baseVersion: sha(gbk) })), "not-utf8");
  assert.ok((await readFile(join(dir, "gbk.md"))).equals(gbk));
});

test("文档太大：read / write / create 回 too-large，list 标出来", async (t) => {
  const { dir, connect } = await setup(t);
  await writeFile(join(dir, "big.md"), Buffer.alloc(P.MAX_DOC_BYTES + 1, 0x61));
  const c = await connect();
  assert.equal(codeOf(await c.request("read", { path: "big.md" })), "too-large");
  assert.deepEqual(resultOf<Docs>(await c.request("list")).docs.map((d) => d.problem), ["too-large"]);
  const { version } = resultOf<{ version: string }>(await c.request("create", { path: "a.md", text: "a" }));
  const text = "a".repeat(P.MAX_DOC_BYTES + 1);
  assert.equal(codeOf(await c.request("write", { path: "a.md", text, baseVersion: version })), "too-large");
  assert.equal(codeOf(await c.request("create", { path: "b.md", text })), "too-large");
  assert.equal(await readFile(join(dir, "a.md"), "utf8"), "a");
});

test("文库内的符号链接指向隐藏文件 / 非 .md / assets 外：read、getAsset 都拒绝", async (t) => {
  const { dir, connect } = await setup(t);
  await mkdir(join(dir, ".git"));
  await writeFile(join(dir, ".git", "config"), "secret");
  await writeFile(join(dir, ".git", "x.md"), "secret");
  await writeFile(join(dir, "notes.txt"), "secret");
  await mkdir(join(dir, "assets"));
  await symlink(join(dir, ".git", "config"), join(dir, "leak.md"));
  await symlink(join(dir, "notes.txt"), join(dir, "txt.md"));
  await symlink(join(dir, ".git"), join(dir, "g"));
  await symlink(join(dir, ".git", "config"), join(dir, "assets", "x.png"));
  await writeFile(join(dir, "img.png"), PNG);
  await symlink(join(dir, "img.png"), join(dir, "assets", "y.png"));
  const c = await connect();
  for (const path of ["leak.md", "txt.md", "g/x.md"]) assert.equal(codeOf(await c.request("read", { path })), "bad-path", path);
  for (const src of ["assets/x.png", "assets/y.png"]) assert.equal(codeOf(await c.request("getAsset", { src })), "bad-path", src);
});

test("写符号链接文档：写到链接指向的文件，链接本身不变", async (t) => {
  const { dir, connect } = await setup(t);
  await writeFile(join(dir, "a.md"), "A");
  await symlink(join(dir, "a.md"), join(dir, "alias.md"));
  const c = await connect();
  const { version } = resultOf<{ version: string }>(await c.request("read", { path: "alias.md" }));
  resultOf(await c.request("write", { path: "alias.md", text: "B", baseVersion: version }));
  assert.ok((await lstat(join(dir, "alias.md"))).isSymbolicLink());
  assert.equal(await readFile(join(dir, "a.md"), "utf8"), "B");
  assert.deepEqual((await readdir(dir)).sort(), ["a.md", "alias.md"]);
});

test("启动时清掉残留的临时文件，别的隐藏文件不动", async (t) => {
  const { dir } = await setup(t);
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, ".pairdown-0123456789ab.tmp"), "x");
  await writeFile(join(dir, "sub", ".pairdown-ba9876543210.tmp"), "x");
  await writeFile(join(dir, ".keep"), "x");
  await Library.open(dir, () => undefined);
  assert.deepEqual(await readdir(dir), [".keep", "sub"]);
  assert.deepEqual(await readdir(join(dir, "sub")), []);
});

test("list：读不了的子目录跳过并记日志，别的照常列", async (t) => {
  const { dir, logs, connect } = await setup(t);
  await mkdir(join(dir, "locked"));
  await writeFile(join(dir, "locked", "x.md"), "x");
  await writeFile(join(dir, "a.md"), "a");
  await chmod(join(dir, "locked"), 0o000);
  try {
    const c = await connect();
    assert.deepEqual(resultOf<Docs>(await c.request("list")).docs.map((d) => d.path), ["a.md"]);
    assert.ok(logs.some((l) => l.includes("locked") && !l.includes(dir)), logs.join("\n"));
  } finally {
    await chmod(join(dir, "locked"), 0o755);
  }
});

test("create 的上级是文件 → bad-path，不是 exists", async (t) => {
  const { dir, connect } = await setup(t);
  await writeFile(join(dir, "x"), "x");
  const c = await connect();
  resultOf(await c.request("create", { path: "a.md", text: "a" }));
  for (const path of ["a.md/b.md", "x/b.md"]) assert.equal(codeOf(await c.request("create", { path, text: "b" })), "bad-path", path);
});

test("rename：目标是源的硬链接 → exists；只改大小写照常改", async (t) => {
  const { dir, connect } = await setup(t);
  const c = await connect();
  resultOf(await c.request("create", { path: "a.md", text: "A" }));
  await link(join(dir, "a.md"), join(dir, "b.md"));
  assert.equal(codeOf(await c.request("rename", { path: "a.md", to: "b.md" })), "exists");
  assert.deepEqual((await readdir(dir)).sort(), ["a.md", "b.md"]);
  resultOf(await c.request("create", { path: "c.md", text: "C" }));
  resultOf(await c.request("rename", { path: "c.md", to: "C.md" }));
  assert.ok((await readdir(dir)).includes("C.md"));
});

test("assets 判断不被大小写折叠绕过（aſsets）", async (t) => {
  const { dir, connect } = await setup(t);
  await mkdir(join(dir, "assets"));
  const c = await connect();
  for (const path of ["aſsets/x.md", "AſSETS/x.md", "n/aſsets/x.md"]) {
    assert.equal(codeOf(await c.request("create", { path, text: "x" })), "bad-path", path);
  }
  assert.deepEqual(await readdir(join(dir, "assets")), []);
});

test("监听：一批改动里有文件读不了，其余照常推", async (t) => {
  const { dir, connect } = await setup(t);
  await writeFile(join(dir, "a.md"), "a");
  await writeFile(join(dir, "b.md"), "b");
  const c = await connect();
  await writeFile(join(dir, "b.md"), "b2");
  await chmod(join(dir, "b.md"), 0o000);
  await writeFile(join(dir, "a.md"), "a2");
  try {
    await until(() => c.events.flatMap((e) => e.changes).find((x) => x.path === "a.md" && x.version === sha("a2")));
  } finally {
    await chmod(join(dir, "b.md"), 0o644);
  }
});

test("监听：目录改名、删除 → 推 relist", async (t) => {
  const { dir, connect } = await setup(t);
  await mkdir(join(dir, "notes"));
  await writeFile(join(dir, "notes", "a.md"), "a");
  const c = await connect();
  await rename(join(dir, "notes"), join(dir, "notes2"));
  await until(() => c.signals.find((s) => s.type === "relist"));
  c.signals.length = 0;
  await rm(join(dir, "notes2"), { recursive: true });
  await until(() => c.signals.find((s) => s.type === "relist"));
});
