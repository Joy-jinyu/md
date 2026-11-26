import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allowedOrigins, checkHost, checkUpgrade, isOrigin } from "../src/auth.mts";
import { parseCli } from "../src/cli.mts";
import { DEFAULT_PORT } from "../src/protocol.ts";
import { isRepo, readInstall } from "../src/update.mts";

const SITE = "https://pairdown.example";

test("parseCli：--library 必填，--origin 可以写多次，端口默认", () => {
  assert.deepEqual(parseCli(["--library", "/lib", "--origin", "http://127.0.0.1:8811", "--origin", "https://a.example"]), {
    kind: "run",
    options: { library: "/lib", port: DEFAULT_PORT, origins: ["http://127.0.0.1:8811", "https://a.example"] },
  });
  assert.equal(parseCli([]).kind, "error");
  assert.equal(parseCli(["--library"]).kind, "error");
});

test("parseCli：改监听地址的参数、打错的参数、不合法的来源和端口都报错", () => {
  for (const args of [
    ["--library", "/lib", "--host", "0.0.0.0"],
    ["--library", "/lib", "--listen", "0.0.0.0"],
    ["--library", "/lib", "--bind", "0.0.0.0"],
    ["--library", "/lib", "--prot", "1"],
    ["--library", "/lib", "--port", "0"],
    ["--library", "/lib", "--port", "70000"],
    ["--library", "/lib", "--origin", "*"],
    ["--library", "/lib", "--origin", "http://a.example/"],
    ["--library", "/lib", "extra"],
  ]) {
    assert.equal(parseCli(args).kind, "error", args.join(" "));
  }
});

test("白名单：只有装网关的站点加上显式给的；没有 Origin、相近写法都不放行", () => {
  const allowed = allowedOrigins(SITE, ["http://127.0.0.1:8811"]);
  assert.deepEqual(allowed, [SITE, "http://127.0.0.1:8811"]);
  assert.equal(checkUpgrade(SITE, allowed), true);
  for (const o of [undefined, "", "null", "http://pairdown.example", "https://pairdown.example/", "https://pairdown.example:443", "http://127.0.0.1:8812", "http://localhost:8811"]) {
    assert.equal(checkUpgrade(o, allowed), false, String(o));
  }
  assert.equal(isOrigin(SITE), true);
  assert.equal(isOrigin(`${SITE}/app`), false);
});

test("白名单：从源码跑（没有记下的站点）时只有显式给的", () => {
  assert.deepEqual(allowedOrigins(undefined, ["http://127.0.0.1:8811"]), ["http://127.0.0.1:8811"]);
  assert.deepEqual(allowedOrigins(undefined), []);
});

test("checkHost：只认 127.0.0.1 / localhost 加本端口", () => {
  assert.equal(checkHost("127.0.0.1:7341", 7341), true);
  assert.equal(checkHost("localhost:7341", 7341), true);
  for (const h of [undefined, "127.0.0.1", "evil.example:7341", "127.0.0.1:7342", "0.0.0.0:7341"]) assert.equal(checkHost(h, 7341), false, String(h));
});

test("安装配置：仓库只认 用户/仓库，挡住 .. 和多段路径；写法不对的站点、仓库当没有", async () => {
  for (const ok of ["someone/thing", "a-b/c.d_e"]) assert.equal(isRepo(ok), true, ok);
  for (const bad of ["../x", "a/..", "a/.x", "a b/c", "a/b/c", "a/", "/a"]) assert.equal(isRepo(bad), false, bad);
  const root = await mkdtemp(join(tmpdir(), "pairdown-install-"));
  await writeFile(join(root, "config.json"), JSON.stringify({ site: SITE, repo: "someone/thing", autoUpdate: false }));
  assert.deepEqual(await readInstall(root), { site: SITE, repo: "someone/thing", autoUpdate: false });
  await writeFile(join(root, "config.json"), JSON.stringify({ site: `${SITE}/`, repo: "../x" }));
  assert.deepEqual(await readInstall(root), { site: undefined, repo: undefined, autoUpdate: true });
});
