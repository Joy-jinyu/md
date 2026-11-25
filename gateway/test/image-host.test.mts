import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { codeOf, PNG, resultOf, setup } from "./helpers.mts";

/** 本地 http 服务当图床：记下收到的请求，按 `reply` 回。 */
async function fakeHost(t: TestContext, reply: (path: string) => { status?: number; body: string }) {
  const seen: { path: string; auth: string | undefined; body: string }[] = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", auth: req.headers.authorization, body: Buffer.concat(chunks).toString("latin1") });
      const r = reply(req.url ?? "");
      res.writeHead(r.status ?? 200, { "content-type": "application/json" }).end(r.body);
    });
  });
  await new Promise<void>((done) => srv.listen(0, "127.0.0.1", done));
  t.after(() => srv.close());
  return { seen, base: `http://127.0.0.1:${(srv.address() as { port: number }).port}` };
}

const data = PNG.toString("base64");

/** 起一个带 config.json 的网关（放在文库外面的临时目录里），连上。 */
async function gateway(t: TestContext, uploadFetch?: typeof fetch) {
  const home = await mkdtemp(join(tmpdir(), "pairdown-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const configPath = join(home, "config.json");
  await writeFile(configPath, JSON.stringify({ library: "kept" }));
  const { connect } = await setup(t, { configPath, uploadFetch });
  return { client: await connect(), configPath };
}

test("图床：没设置时查是 null、上传回 no-image-host；设置后上传带上请求头，返回图床给的地址", async (t) => {
  const host = await fakeHost(t, () => ({ body: JSON.stringify({ data: { url: "https://img.example/a.png" } }) }));
  const { client, configPath } = await gateway(t);
  assert.deepEqual(resultOf(await client.request("imageHost")), { host: null });
  assert.equal(codeOf(await client.request("uploadImage", { data })), "no-image-host");

  resultOf(await client.request("setImageHost", { host: { url: `${host.base}/upload`, field: "image", urlPath: "", headers: { Authorization: "Bearer secret" } } }));
  assert.deepEqual(resultOf(await client.request("imageHost")), { host: { url: `${host.base}/upload`, field: "image", urlPath: "", headerNames: ["Authorization"] } });
  assert.deepEqual(resultOf(await client.request("uploadImage", { data })), { url: "https://img.example/a.png" });
  assert.equal(host.seen[0].auth, "Bearer secret");
  assert.match(host.seen[0].body, /name="image"; filename="[0-9a-f]{16}\.png"/);

  // 改别的项不给 headers：原来的请求头还在；config.json 里别的项不动
  resultOf(await client.request("setImageHost", { host: { url: `${host.base}/v2`, field: "file", urlPath: "data.url" } }));
  resultOf(await client.request("uploadImage", { data }));
  assert.equal(host.seen[1].path, "/v2");
  assert.equal(host.seen[1].auth, "Bearer secret");
  assert.equal(JSON.parse(await readFile(configPath, "utf8")).library, "kept");

  resultOf(await client.request("setImageHost", { host: null }));
  assert.deepEqual(resultOf(await client.request("imageHost")), { host: null });
});

test("图床拒绝：地址不是 http(s)、不是图片、图床回错、返回里没有地址或地址不是 http(s)", async (t) => {
  const host = await fakeHost(t, (path) => (path === "/500" ? { status: 500, body: "{}" } : path === "/js" ? { body: JSON.stringify({ url: "javascript:alert(1)" }) } : { body: "{}" }));
  const { client } = await gateway(t);
  assert.equal(codeOf(await client.request("setImageHost", { host: { url: "file:///etc/passwd", field: "file", urlPath: "" } })), "bad-url");
  assert.equal(codeOf(await client.request("setImageHost", { host: { url: host.base, field: "file", urlPath: "", headers: { "X\r\nY": "1" } } })), "bad-request");
  for (const path of ["/500", "/js", "/empty"]) {
    resultOf(await client.request("setImageHost", { host: { url: `${host.base}${path}`, field: "file", urlPath: "" } }));
    assert.equal(codeOf(await client.request("uploadImage", { data })), "upload-failed", path);
  }
  assert.equal(codeOf(await client.request("uploadImage", { data: Buffer.from("<svg/>").toString("base64") })), "bad-type");
});

test("GitHub 仓库当图床：提交到仓库的分支和目录下，带令牌，返回 raw 地址；令牌不回给页面，改别的项时保留", async (t) => {
  const calls: { url: string; auth: string; body: { branch: string; content: string } }[] = [];
  let status = 201;
  const { client } = await gateway(t, (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status });
  }) as typeof fetch);
  const github = { kind: "github", repo: "joy/pics", branch: "", dir: "/shots/2026/" };
  assert.equal(codeOf(await client.request("setImageHost", { host: github })), "bad-request", "没有令牌");
  assert.equal(codeOf(await client.request("setImageHost", { host: { ...github, repo: "joy", token: "github_pat_0123456789" } })), "bad-request");
  assert.equal(codeOf(await client.request("setImageHost", { host: { ...github, dir: "a/../b", token: "github_pat_0123456789" } })), "bad-request");

  resultOf(await client.request("setImageHost", { host: { ...github, token: "github_pat_0123456789" } }));
  assert.deepEqual(resultOf(await client.request("imageHost")), { host: { kind: "github", repo: "joy/pics", branch: "main", dir: "shots/2026", hasToken: true } });
  const { url } = resultOf<{ url: string }>(await client.request("uploadImage", { data }));
  assert.match(url, /^https:\/\/raw\.githubusercontent\.com\/joy\/pics\/main\/shots\/2026\/[0-9a-f]{16}\.png$/);
  assert.equal(calls[0].url, `https://api.github.com/repos/joy/pics/contents/${url.split("/main/")[1]}`);
  assert.equal(calls[0].auth, "Bearer github_pat_0123456789");
  assert.deepEqual([calls[0].body.branch, calls[0].body.content], ["main", data]);

  // 同一张图已经在仓库里（422）也算传好；令牌不对说得出原因
  status = 422;
  assert.equal(resultOf<{ url: string }>(await client.request("uploadImage", { data })).url, url);
  status = 401;
  const refused = await client.request("uploadImage", { data });
  assert.equal(codeOf(refused), "upload-failed");
  assert.match(refused.ok ? "" : refused.error.message, /令牌/);

  status = 201;
  resultOf(await client.request("setImageHost", { host: { kind: "github", repo: "joy/pics", branch: "img", dir: "a" } }));
  resultOf(await client.request("uploadImage", { data }));
  assert.equal(calls.at(-1)?.auth, "Bearer github_pat_0123456789");
  // 换成上传接口再换回来：令牌不跟着回来
  resultOf(await client.request("setImageHost", { host: { url: "https://img.example/up", field: "file", urlPath: "" } }));
  assert.equal(codeOf(await client.request("setImageHost", { host: { kind: "github", repo: "joy/pics", branch: "img", dir: "a" } })), "bad-request");
});
