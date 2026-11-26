import { expect, test } from "nsh/test";
import { createGitHub, gistDocName, gistTitle, SyncError } from "../src/sync/github";

const TOKEN = "test-token-not-real-123";

interface Call {
  method: string;
  url: string;
  auth: string | null;
  body: unknown;
  cache: RequestInit["cache"];
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | "offline";

/** 读请求为了躲开 HTTP 缓存加在最后的 `fresh` 参数：按路由找回复时不看它。 */
const routeOf = (url: string) => url.replace(/[?&]fresh=[^&]*$/, "");

/** 假的 fetch：按「方法 地址」回，记下每次请求。 */
function fakeFetch(routes: Record<string, Reply | ((call: Call) => Reply)>) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const call = { method, url, auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null, cache: init?.cache };
    calls.push(call);
    const route = routes[`${method} ${routeOf(url)}`];
    const reply = typeof route === "function" ? route(call) : route;
    if (!reply) return new Response("not routed", { status: 599 });
    if (reply === "offline") throw new TypeError("Network request failed");
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body ?? {});
    return new Response(body, { status: reply.status ?? 200, headers: reply.headers });
  };
  return { calls, fetchFn };
}

const API = "https://api.github.com";
const gist = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  description: "[Pairdown] 周报",
  updated_at: "2026-11-25T01:00:00Z",
  history: [{ version: `${id}-v2` }, { version: `${id}-v1` }],
  files: { "周报.md": { filename: "周报.md", content: text, truncated: false, raw_url: `https://gist.githubusercontent.com/u/${id}/raw/x/周报.md` } },
  ...extra,
});

async function failure(p: Promise<unknown>): Promise<SyncError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof SyncError) return e;
    throw e;
  }
  throw new Error("expected a SyncError");
}

test("reading a gist gives its markdown file, and its latest history version as the version; the token only goes in the header", async () => {
  const f = fakeFetch({ [`GET ${API}/gists/g1`]: { body: gist("g1", "# 周报\n") } });
  const got = await createGitHub(TOKEN, f.fetchFn, () => undefined).getGist("g1");
  expect(got).toEqual({ id: "g1", description: "[Pairdown] 周报", fileName: "周报.md", text: "# 周报\n", version: "g1-v2" });
  expect(f.calls[0].auth).toBe(`Bearer ${TOKEN}`);
  expect(f.calls[0].url.includes(TOKEN)).toBe(false);
});

test("without history the version falls back to updated_at", async () => {
  const f = fakeFetch({ [`GET ${API}/gists/g1`]: { body: gist("g1", "x", { history: undefined }) } });
  expect((await createGitHub(TOKEN, f.fetchFn, () => undefined).getGist("g1"))?.version).toBe("2026-11-25T01:00:00Z");
});

test("a truncated file is read in full from raw_url, without the token", async () => {
  const big = "a".repeat(10);
  const f = fakeFetch({
    [`GET ${API}/gists/g1`]: { body: gist("g1", "a", { files: { "周报.md": { content: "a", truncated: true, raw_url: "https://gist.githubusercontent.com/u/g1/raw/x/周报.md" } } }) },
    "GET https://gist.githubusercontent.com/u/g1/raw/x/周报.md": { body: big },
  });
  expect((await createGitHub(TOKEN, f.fetchFn, () => undefined).getGist("g1"))?.text).toBe(big);
  expect(f.calls[1].auth).toBe(null);
});

test("a gist deleted on GitHub (404) reads as null, and an update to it also gives null", async () => {
  const f = fakeFetch({ [`GET ${API}/gists/gone`]: { status: 404 }, [`PATCH ${API}/gists/gone`]: { status: 404 } });
  const gh = createGitHub(TOKEN, f.fetchFn, () => undefined);
  expect(await gh.getGist("gone")).toBe(null);
  expect(await gh.updateGist("gone", "a.md", "a", "A", "text")).toBe(null);
});

test("401 signs out (the callback runs) and says to sign in again, without the token in the message", async () => {
  let unauthorized = 0;
  const f = fakeFetch({ [`GET ${API}/gists/g1`]: { status: 401, body: { message: "Bad credentials" } } });
  const e = await failure(createGitHub(TOKEN, f.fetchFn, () => unauthorized++).getGist("g1"));
  expect(e.kind).toBe("auth");
  expect(unauthorized).toBe(1);
  expect(e.message.includes("Sign in again")).toBe(true);
  expect(e.message.includes(TOKEN)).toBe(false);
});

test("403 with no rate left is a rate limit with the reset time; other 403s say to sign in again", async () => {
  const reset = Math.floor(new Date(2026, 10, 25, 15, 7).getTime() / 1000);
  const limited = fakeFetch({ [`GET ${API}/gists/g1`]: { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } } });
  const e = await failure(createGitHub(TOKEN, limited.fetchFn, () => undefined).getGist("g1"));
  expect(e.kind).toBe("rate");
  expect(e.message.includes("15:07")).toBe(true);
  const forbidden = fakeFetch({ [`GET ${API}/gists/g1`]: { status: 403 } });
  expect((await failure(createGitHub(TOKEN, forbidden.fetchFn, () => undefined).getGist("g1"))).kind).toBe("forbidden");
});

test("no network is a network error that says to check the connection", async () => {
  const f = fakeFetch({ [`GET ${API}/gists/g1`]: "offline" });
  const e = await failure(createGitHub(TOKEN, f.fetchFn, () => undefined).getGist("g1"));
  expect(e.kind).toBe("network");
  expect(e.message.includes("Check your connection")).toBe(true);
});

test("creating makes a secret gist named after the document with the Pairdown mark; renaming moves the file", async () => {
  const f = fakeFetch({
    [`POST ${API}/gists`]: (c) => ({ status: 201, body: gist("g9", (c.body as { files: Record<string, { content: string }> }).files["周报.md"].content) }),
    [`PATCH ${API}/gists/g9`]: { body: gist("g9", "new") },
  });
  const gh = createGitHub(TOKEN, f.fetchFn, () => undefined);
  const created = await gh.createGist("周报", "第 47 周", "# 周报\n");
  expect(created.id).toBe("g9");
  expect(f.calls[0].body).toEqual({ description: "[Pairdown] 第 47 周", public: false, files: { "周报.md": { content: "# 周报\n" } } });
  await gh.updateGist("g9", "周报.md", "月报/草稿", "月报", "new");
  expect(f.calls[1].body).toEqual({ description: "[Pairdown] 月报", files: { "周报.md": { filename: "月报 草稿.md", content: "new" } } });
});

test("listing pages through all gists and keeps only Pairdown ones", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, description: i === 3 ? "[Pairdown] 甲" : "other", updated_at: "", files: { "a.md": {} } }));
  const page2 = [{ id: "y", description: "[Pairdown] 乙", updated_at: "t", files: { "乙.md": {} } }];
  const f = fakeFetch({ [`GET ${API}/gists?per_page=100&page=1`]: { body: page1 }, [`GET ${API}/gists?per_page=100&page=2`]: { body: page2 } });
  const list = await createGitHub(TOKEN, f.fetchFn, () => undefined).listPairdownGists();
  expect(list.map((g) => [g.id, gistTitle(g), gistDocName(g.fileName)])).toEqual([
    ["x3", "甲", "a"],
    ["y", "乙", "乙"],
  ]);
});

test("a gist with several files reads the file the link names, and a gist it cannot tell apart is refused instead of guessed", async () => {
  const files = {
    "README.md": { content: "readme", truncated: false },
    "周报.md": { content: "# 周报\n", truncated: false },
    "data.json": { content: "{}", truncated: false },
  };
  const f = fakeFetch({ [`GET ${API}/gists/g1`]: { body: gist("g1", "", { files }) } });
  const gh = createGitHub(TOKEN, f.fetchFn, () => undefined);
  expect((await gh.getGist("g1", "周报.md"))?.text).toBe("# 周报\n");
  const e = await failure(gh.getGist("g1", "gone.md"));
  expect([e.kind, e.message.includes("multiple files")]).toEqual(["invalid", true]);
  const single = fakeFetch({ [`GET ${API}/gists/g2`]: { body: gist("g2", "", { files: { "notes.md": { content: "n" }, "data.json": { content: "{}" } } }) } });
  expect((await createGitHub(TOKEN, single.fetchFn, () => undefined).getGist("g2", "renamed.md"))?.fileName).toBe("notes.md");
});

test("an update names the file by what GitHub has now, so a rename made on GitHub does not leave a second file", async () => {
  const f = fakeFetch({ [`PATCH ${API}/gists/g1`]: { body: gist("g1", "", { files: { "周报.md": { content: "mine" } } }) } });
  const got = await createGitHub(TOKEN, f.fetchFn, () => undefined).updateGist("g1", "weekly.md", "周报", "周报", "mine");
  expect(f.calls[0].body).toEqual({ description: "[Pairdown] 周报", files: { "weekly.md": { filename: "周报.md", content: "mine" } } });
  expect(got?.fileName).toBe("周报.md");
});

test("a truncated file's raw address is only fetched from GitHub's raw gist host over https", async () => {
  for (const raw of ["https://evil.example/x.md", "http://gist.githubusercontent.com/u/g1/raw/x.md", "https://gist.githubusercontent.com.evil.example/x.md", "not a url"]) {
    const f = fakeFetch({ [`GET ${API}/gists/g1`]: { body: gist("g1", "a", { files: { "周报.md": { content: "a", truncated: true, raw_url: raw } } }) } });
    const e = await failure(createGitHub(TOKEN, f.fetchFn, () => undefined).getGist("g1"));
    expect([raw, e.kind, f.calls.length]).toEqual([raw, "invalid", 1]);
  }
});

test("neither the logs nor the error messages ever carry the token", async () => {
  const seen: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const capture = (...args: unknown[]) => void seen.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  console.log = console.warn = console.error = console.info = capture;
  const messages: string[] = [];
  try {
    const replies: Reply[] = ["offline", { status: 401 }, { status: 403 }, { status: 500 }, { status: 200, body: "not json" }];
    for (const reply of replies) {
      const f = fakeFetch({ [`GET ${API}/gists/g1`]: reply, [`GET ${API}/user`]: reply });
      const gh = createGitHub(TOKEN, f.fetchFn, () => undefined);
      messages.push((await failure(gh.getGist("g1"))).message, (await failure(gh.user())).message);
    }
  } finally {
    Object.assign(console, saved);
  }
  expect(seen.length > 0).toBe(true);
  expect([...seen, ...messages].filter((t) => t.includes(TOKEN))).toEqual([]);
});

/**
 * 带 HTTP 缓存的客户端：GitHub 对 GET 回 `Cache-Control: private, max-age=60`，同一个地址 60 秒内给存着的旧回包。
 * `honorsNoStore`：浏览器认 `cache: "no-store"`；有的宿主转发请求时不带这个选项（nsh 测试宿主就是），只能靠地址不同。
 */
function cachingClient(server: (url: string) => unknown, honorsNoStore: boolean) {
  let now = 0;
  const stored = new Map<string, { at: number; body: string }>();
  const fetchFn = async (url: string, init?: RequestInit) => {
    const hit = stored.get(url);
    const bypass = honorsNoStore && init?.cache === "no-store";
    if (hit && !bypass && now - hit.at < 60_000) return new Response(hit.body);
    const body = JSON.stringify(server(routeOf(url)));
    stored.set(url, { at: now, body });
    return new Response(body);
  };
  return { fetchFn, later: (ms: number) => void (now += ms) };
}

test("reading GitHub again within the 60 seconds it says to cache still gets what is there now, with or without a host that honors no-store", async () => {
  for (const honorsNoStore of [true, false]) {
    let text = "# 周报\n\n旧的\n";
    let version = "v1";
    const server = (url: string) =>
      url.startsWith(`${API}/gists?`) ? [{ id: "g1", description: "[Pairdown] 周报", updated_at: version, files: { "周报.md": {} } }] : { ...gist("g1", text), history: [{ version }] };
    const client = cachingClient(server, honorsNoStore);
    const gh = createGitHub(TOKEN, client.fetchFn, () => undefined);
    expect((await gh.getGist("g1"))?.version).toBe("v1");
    expect((await gh.listPairdownGists())[0].updatedAt).toBe("v1");
    // 别处改了 GitHub 上的这篇，10 秒后这边再读
    text = "# 周报\n\n别处改的\n";
    version = "v2";
    client.later(10_000);
    expect([honorsNoStore, await gh.getGist("g1")]).toEqual([honorsNoStore, { id: "g1", description: "[Pairdown] 周报", fileName: "周报.md", text, version: "v2" }]);
    expect([honorsNoStore, (await gh.listPairdownGists())[0].updatedAt]).toEqual([honorsNoStore, "v2"]);
  }
});

test("every read asks past the browser's HTTP cache (no-store), and so does the raw download of a long file", async () => {
  const f = fakeFetch({
    [`GET ${API}/gists/g1`]: { body: gist("g1", "a", { files: { "周报.md": { content: "a", truncated: true, raw_url: "https://gist.githubusercontent.com/u/g1/raw/x/周报.md" } } }) },
    "GET https://gist.githubusercontent.com/u/g1/raw/x/周报.md": { body: "aaaa" },
    [`GET ${API}/gists?per_page=100&page=1`]: { body: [] },
    [`GET ${API}/user`]: { body: { login: "joy" } },
  });
  const gh = createGitHub(TOKEN, f.fetchFn, () => undefined);
  await gh.getGist("g1");
  await gh.listPairdownGists();
  await gh.user();
  expect(f.calls.map((c) => [c.method, c.cache])).toEqual([
    ["GET", "no-store"],
    ["GET", "no-store"],
    ["GET", "no-store"],
    ["GET", "no-store"],
  ]);
  // 原文直链不加参数（地址里带着内容的哈希，内容不变）
  expect(f.calls[1].url).toBe("https://gist.githubusercontent.com/u/g1/raw/x/周报.md");
});
