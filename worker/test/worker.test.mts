import assert from "node:assert/strict";
import { test } from "node:test";
import { type Env, handle } from "../src/worker.mts";

const ENV: Env = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "shh-secret", ALLOWED_DOMAINS: "https://markdown.pairwise.site, http://127.0.0.1:8811" };
const SITE = "https://markdown.pairwise.site";

const post = (body: unknown, origin: string | null = SITE, path = "/token") =>
  new Request(`https://auth.example.workers.dev${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** 假的 GitHub：记下收到了什么，按 `reply` 回。 */
function fakeGitHub(reply: () => Response | Promise<Response>) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return reply();
  };
  return { calls, fetchFn };
}

const ok = () => Response.json({ access_token: "test-token-abc", token_type: "bearer", scope: "gist" });
const VERIFIER = "dBjftJeZ4CVP-mJ92K1jfgbLlFx4pX8kDiiw7AEdcGQ";
/** 页面发来的合规请求体；`extra` 换掉或加上字段。 */
const req = (extra: Record<string, unknown> = {}) => ({ code: "c0de", state: "abcdef", code_verifier: VERIFIER, redirect_uri: `${SITE}/`, ...extra });

test("an allowed origin gets the token; code, PKCE verifier, redirect and client credentials go to GitHub", async () => {
  const gh = fakeGitHub(ok);
  const res = await handle(post(req()), ENV, gh.fetchFn);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await res.json(), { access_token: "test-token-abc", token_type: "bearer", scope: "gist" });
  assert.equal(gh.calls.length, 1);
  assert.equal(gh.calls[0].url, "https://github.com/login/oauth/access_token");
  assert.deepEqual(gh.calls[0].body, { client_id: "cid", client_secret: "shh-secret", code: "c0de", code_verifier: VERIFIER, redirect_uri: `${SITE}/` });
});

test("a body over the size limit is refused before it is read in full, by its Content-Length or while reading it", async () => {
  const gh = fakeGitHub(ok);
  const declared = new Request("https://w.example/token", { method: "POST", headers: { Origin: SITE, "Content-Type": "application/json", "Content-Length": "20000000" }, body: "{}" });
  assert.equal((await handle(declared, ENV, gh.fetchFn)).status, 413);
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(1024).fill(32));
    },
  });
  const streamed = new Request("https://w.example/token", { method: "POST", headers: { Origin: SITE, "Content-Type": "application/json" }, body: endless, duplex: "half" } as RequestInit);
  assert.equal((await handle(streamed, ENV, gh.fetchFn)).status, 413);
  assert.ok(pulled < 10, `read ${pulled} chunks`);
  assert.equal(gh.calls.length, 0);
});

test("only text comes back for token_type and scope, whatever GitHub sends", async () => {
  const odd = fakeGitHub(() => Response.json({ access_token: "t", token_type: { x: 1 }, scope: ["gist", "repo"] }));
  assert.deepEqual(await (await handle(post(req()), ENV, odd.fetchFn)).json(), { access_token: "t", token_type: "bearer", scope: "" });
});

test("an origin not in ALLOWED_DOMAINS (or none) is refused without calling GitHub", async () => {
  for (const origin of ["https://evil.example", "https://markdown.pairwise.site.evil.example", null]) {
    const gh = fakeGitHub(ok);
    const res = await handle(post(req(), origin), ENV, gh.fetchFn);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(gh.calls.length, 0);
  }
});

test("the preflight from an allowed origin is answered for POST only", async () => {
  const res = await handle(new Request("https://w.example/token", { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:8811" } }), ENV);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8811");
  assert.equal(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
});

test("bodies with extra fields, missing fields, odd characters, a bad verifier, a redirect elsewhere or bad JSON are refused", async () => {
  const bad = [
    { code: "c" },
    { code: "c", state: "s" },
    req({ client_id: "x" }),
    req({ redirect_uri: "https://evil.example/" }),
    req({ redirect_uri: "not a url" }),
    req({ code_verifier: "short" }),
    req({ code_verifier: `${VERIFIER}!` }),
    req({ code: "c d" }),
    req({ state: 1 }),
    "not json",
    req({ code: "x".repeat(300) }),
  ];
  for (const body of bad) {
    const gh = fakeGitHub(ok);
    const res = await handle(post(body), ENV, gh.fetchFn);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(gh.calls.length, 0);
  }
});

test("wrong path and wrong method are refused", async () => {
  assert.equal((await handle(post(req(), SITE, "/other"), ENV, fakeGitHub(ok).fetchFn)).status, 404);
  const get = new Request("https://w.example/token", { headers: { Origin: SITE } });
  assert.equal((await handle(get, ENV, fakeGitHub(ok).fetchFn)).status, 405);
});

test("GitHub's error code is passed on, never the secret; GitHub down is a 502", async () => {
  const refused = await handle(post(req()), ENV, fakeGitHub(() => Response.json({ error: "bad_verification_code", error_description: "The code passed is incorrect" })).fetchFn);
  assert.equal(refused.status, 400);
  const text = await refused.text();
  assert.deepEqual(JSON.parse(text), { error: "bad_verification_code" });
  assert.equal(text.includes("shh-secret"), false);
  const down = await handle(
    post(req()),
    ENV,
    fakeGitHub(() => Promise.reject(new Error("offline"))).fetchFn,
  );
  assert.equal(down.status, 502);
});

test("a Worker without its secret says it is not configured", async () => {
  const res = await handle(post(req()), { ...ENV, GITHUB_CLIENT_SECRET: "" }, fakeGitHub(ok).fetchFn);
  assert.equal(res.status, 500);
});

test("nothing is logged", async () => {
  const seen: unknown[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = console.warn = console.error = console.info = (...args: unknown[]) => seen.push(args);
  try {
    await handle(post(req()), ENV, fakeGitHub(ok).fetchFn);
    await handle(post(req(), "https://evil.example"), ENV, fakeGitHub(ok).fetchFn);
    await handle(post(req()), ENV, fakeGitHub(() => Promise.reject(new Error("x"))).fetchFn);
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(seen, []);
});
