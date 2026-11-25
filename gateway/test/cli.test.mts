import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedOrigins, checkHost, checkUpgrade, isOrigin } from "../src/auth.mts";
import { parseCli } from "../src/cli.mts";
import { DEFAULT_PORT, OFFICIAL_ORIGIN } from "../src/protocol.ts";

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

test("白名单：只有线上来源加上显式给的；没有 Origin、相近写法都不放行", () => {
  const allowed = allowedOrigins(["http://127.0.0.1:8811"]);
  assert.deepEqual(allowed, [OFFICIAL_ORIGIN, "http://127.0.0.1:8811"]);
  assert.equal(checkUpgrade(OFFICIAL_ORIGIN, allowed), true);
  for (const o of [undefined, "", "null", "http://markdown.pairwise.site", "https://markdown.pairwise.site/", "https://markdown.pairwise.site:443", "http://127.0.0.1:8812", "http://localhost:8811"]) {
    assert.equal(checkUpgrade(o, allowed), false, String(o));
  }
  assert.equal(isOrigin("https://markdown.pairwise.site"), true);
  assert.equal(isOrigin("https://markdown.pairwise.site/app"), false);
});

test("checkHost：只认 127.0.0.1 / localhost 加本端口", () => {
  assert.equal(checkHost("127.0.0.1:7341", 7341), true);
  assert.equal(checkHost("localhost:7341", 7341), true);
  for (const h of [undefined, "127.0.0.1", "evil.example:7341", "127.0.0.1:7342", "0.0.0.0:7341"]) assert.equal(checkHost(h, 7341), false, String(h));
});
