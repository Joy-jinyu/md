import { expect, open, test } from "nsh/test";
import { LAST_OPENED_KEY } from "../src/store/library";
import { bodyKey, metaKey } from "../src/store/local-store";
import { syncRecordKey } from "../src/store/sync-store";
import { seedLibrary } from "./fixtures/library";

/** 同步的判定和各种边角（审查 m5 找出的问题）：网页，假 GitHub。基本流程在 sync.test.tsx。 */
const WEB = { platform: "web" as const, width: 1280, height: 860 };
const API = "https://api.github.com";
const TOKEN = "test-token-engine";
const AUTH = { "md.sync.auth": JSON.stringify({ token: TOKEN, login: "joy" }) };
const SYNCED_APP = "./fixtures/sync-app.tsx";
const LIST = `GET ${API}/gists?per_page=100&page=1&fresh=*`;
const noGists = { [LIST]: { body: [] } };

const DOC = { id: "da", name: "周报", text: "# 周报\n\n共同的一段\n\n本机改的\n" };
const BASE = "# 周报\n\n共同的一段\n";
const REMOTE = "# 周报\n\n共同的一段\n\nGitHub 上改的\n";

type App = Awaited<ReturnType<typeof open>>;
type Network = Record<string, unknown>;

const library = (text = DOC.text) => ({ ...seedLibrary([{ ...DOC, text }]), [LAST_OPENED_KEY]: DOC.id });
const link = (base: string, extra: Record<string, unknown> = {}) => JSON.stringify({ link: { gistId: "g1", fileName: "周报.md", base, version: "v1", login: "joy", syncedAt: 1, ...extra } });
const linked = (base: string, extra: Record<string, unknown> = {}) => ({ [syncRecordKey(DOC.id)]: link(base, extra) });
const gistBody = (text: string, version: string | null, extra: Record<string, unknown> = {}) => ({
  id: "g1",
  description: "[Pairdown] 周报",
  updated_at: "2026-11-25T00:00:00Z",
  ...(version === null ? {} : { history: [{ version }] }),
  files: { "周报.md": { filename: "周报.md", content: text, truncated: false } },
  ...extra,
});
const summary = (id: string, fileName: string) => ({ id, description: "[Pairdown] x", updated_at: "", files: { [fileName]: {} } });

async function start(storage: Record<string, string>, network: Network, options: Record<string, unknown> = {}) {
  const app = await open(SYNCED_APP, { ...WEB, storage: { ...AUTH, ...storage }, network: network as never, ...options });
  await app.waitFor("id:sync-status");
  return app;
}

async function sync(app: App) {
  await app.press("id:sync-status");
  await app.waitFor("id:sync");
  await app.press("id:sync-now");
  await app.waitUntil(() => app.shows("id:sync-result") || app.shows("id:sync-error"));
}

const sent = (app: App, method: string) => app.requests().filter((r) => r.method === method);

test("a record kept for another storage (the gateway library) is neither used for the browser's document of the same id nor treated as deleted", async () => {
  const other = "gateway:Notes";
  const app = await start(
    {
      ...library(),
      "md.lastBackend": other,
      [syncRecordKey(DOC.id, other)]: JSON.stringify({ link: { gistId: "g9", fileName: "别的.md", base: "库里那篇\n", version: "v1", login: "joy", syncedAt: 1 } }),
      [syncRecordKey("notes/a.md", other)]: JSON.stringify({ link: { gistId: "g8", fileName: "a.md", base: "a\n", version: "v1", login: "joy", syncedAt: 1 } }),
    },
    {
      [LIST]: { body: [summary("g9", "别的.md"), summary("g8", "a.md")] },
      [`POST ${API}/gists`]: { status: 201, body: gistBody(DOC.text, "v1") },
    },
  );
  await sync(app);
  await app.waitFor("id:sync-upload");
  await app.press("id:sync-upload-confirm");
  await app.waitFor("text:已上传 1 篇（私密 Gist）。");
  expect(sent(app, "PATCH")).toEqual([]);
  expect(app.requests().some((r) => r.url.includes("/gists/g8") || r.url.includes("/gists/g9"))).toBe(false);
  expect(app.shows("text:本机删了，GitHub 上还在。")).toBe(false);
  expect(app.shows("id:sync-issue-remote:g8")).toBe(false);
  const storage = app.storage();
  expect(JSON.parse(storage[syncRecordKey(DOC.id)]).link.gistId).toBe("g1");
  expect(JSON.parse(storage[syncRecordKey(DOC.id, other)]).link.gistId).toBe("g9");
  expect(JSON.parse(storage[syncRecordKey("notes/a.md", other)]).link.gistId).toBe("g8");
});

test("GitHub changed and this side changed within the minute GitHub says to cache its reply: still a conflict, nothing pushed over GitHub's", async () => {
  // 像浏览器的 HTTP 缓存：同一个地址 60 秒内给存着的旧回包（GitHub 回 Cache-Control: private, max-age=60）
  const cache = new Map<string, { at: number; reply: unknown }>();
  let remote = { text: BASE, version: "v1" };
  const patched: unknown[] = [];
  const app = await start({ ...library(BASE), ...linked(BASE) }, {
    ...noGists,
    [`GET ${API}/gists/g1*`]: (req: { url: string }) => {
      const hit = cache.get(req.url);
      if (hit && Date.now() - hit.at < 60_000) return hit.reply;
      const reply = { body: gistBody(remote.text, remote.version) };
      cache.set(req.url, { at: Date.now(), reply });
      return reply;
    },
    [`PATCH ${API}/gists/g1`]: (req: { body?: string | null }) => {
      patched.push(req.body);
      return { body: gistBody(DOC.text, "v3") };
    },
  });
  await sync(app);
  await app.waitFor("text:都是最新的。");
  // 别处改了 GitHub 上的，这边也改了另一处，一分钟之内再同步
  remote = { text: REMOTE, version: "v2" };
  await app.press("id:sync-close");
  await app.press("text:共同的一段");
  await app.keyboard.press("end");
  await app.type("label:正文", "本机加的");
  await app.waitFor("text:已保存", { timeout: 3000 });
  await sync(app);
  await app.waitFor("id:sync-issue-conflict:da");
  expect(patched).toEqual([]);
  expect(app.texts()).toContain("1 件事要你选。");
});

test("renamed on GitHub and edited here: the push names the file GitHub has now, so no second file appears", async () => {
  let patched: { files: Record<string, unknown> } | null = null;
  const renamed = gistBody(BASE, "v2", { files: { "weekly.md": { filename: "weekly.md", content: BASE } } });
  const app = await start({ ...library(), ...linked(BASE) }, {
    ...noGists,
    [`GET ${API}/gists/g1?fresh=*`]: { body: renamed },
    [`PATCH ${API}/gists/g1`]: (req: { body?: string | null }) => {
      patched = JSON.parse(req.body ?? "{}");
      return { body: gistBody(DOC.text, "v3") };
    },
  });
  await sync(app);
  await app.waitFor("text:推上去 1 篇。");
  expect(patched).toEqual({ description: "[Pairdown] 周报", files: { "weekly.md": { filename: "周报.md", content: DOC.text } } });
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link).toMatchObject({ fileName: "周报.md", version: "v3", base: DOC.text });
});

test("a gist read without a history (version falls back to the second-level updated_at) that changed in the same second is a conflict, never pushed over", async () => {
  const at = "2026-11-25T00:00:00Z";
  const app = await start({ ...library(), ...linked(BASE, { version: at }) }, {
    ...noGists,
    [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(REMOTE, null, { updated_at: at }) },
  });
  await sync(app);
  await app.waitFor("id:sync-issue-conflict:da");
  expect(sent(app, "PATCH")).toEqual([]);
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
});

test("both sides changed to the same text except for line endings and trailing blank lines: not a conflict, neither side is rewritten", async () => {
  const crlf = `${DOC.text.replace(/\n/g, "\r\n")}\r\n\r\n`;
  const app = await start({ ...library(), ...linked(BASE) }, { ...noGists, [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(crlf, "v2") } });
  await sync(app);
  await app.waitFor("text:都是最新的。");
  expect(sent(app, "PATCH")).toEqual([]);
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link.version).toBe("v2");
  await sync(app);
  await app.waitFor("text:都是最新的。");
  expect(sent(app, "PATCH")).toEqual([]);
});

test("a document whose record was lost after its gist was made (same name, same text on GitHub) is linked to that gist instead of making another", async () => {
  const app = await start(library(), {
    [LIST]: { body: [summary("g5", "周报.md")] },
    [`GET ${API}/gists/g5?fresh=*`]: { body: gistBody(DOC.text, "v1", { id: "g5" }) },
  });
  await sync(app);
  await app.waitFor("text:都是最新的。");
  expect(sent(app, "POST")).toEqual([]);
  expect(app.shows("id:sync-issue-remote:g5")).toBe(false);
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link.gistId).toBe("g5");
});

const sameNameOther = {
  [LIST]: { body: [summary("g5", "周报.md")] },
  [`GET ${API}/gists/g5?fresh=*`]: { body: gistBody(REMOTE, "v1", { id: "g5" }) },
};

test("a never-synced document with a same-named, different gist on GitHub asks; linking compares the two sides without changing either", async () => {
  const app = await start(library(), sameNameOther);
  await sync(app);
  await app.waitFor("id:sync-issue-name-match:da");
  expect(app.shows("text:这篇还没同步过，GitHub 上有一篇同名的，内容不一样。")).toBe(true);
  expect(app.shows("id:sync-issue-remote:g5")).toBe(false);
  expect(sent(app, "POST")).toEqual([]);
  await app.press("id:sync-link-match");
  await app.waitFor("id:conflict-view");
  expect(app.shows("id:conflict-remote >> text:GitHub 上改的")).toBe(true);
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
  expect(sent(app, "PATCH")).toEqual([]);
  // 先不选：下次同步还是冲突，不会自动推或拉
  await app.press("id:conflict-later");
  await app.press("id:sync-now");
  await app.waitFor("id:sync-issue-conflict:da");
  expect(sent(app, "PATCH")).toEqual([]);
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
});

test("choosing to make a separate gist for a same-named document uploads it as a new one and leaves the other alone", async () => {
  const app = await start(library(), { ...sameNameOther, [`POST ${API}/gists`]: { status: 201, body: gistBody(DOC.text, "v1", { id: "g6" }) } });
  await sync(app);
  await app.press("id:sync-create-separate");
  await app.waitFor("text:已把「周报」另建成一个新的 Gist。");
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link.gistId).toBe("g6");
  expect(sent(app, "PATCH")).toEqual([]);
});

test("keeping the local side of a conflict does not push an empty document over GitHub's", async () => {
  const app = await start({ ...library(""), ...linked(BASE) }, { ...noGists, [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(REMOTE, "v2") } });
  await sync(app);
  await app.press("id:sync-compare");
  await app.press("id:conflict-keep-local");
  await app.waitUntil(() => app.texts().some((t) => t.includes("这篇是空的")));
  expect(sent(app, "PATCH")).toEqual([]);
});

test("re-uploading a gist deleted on GitHub does not upload an empty document, and the top bar counts what is left to choose", async () => {
  const app = await start({ ...library(""), ...linked(BASE) }, { ...noGists, [`GET ${API}/gists/g1?fresh=*`]: { status: 404 } });
  await sync(app);
  await app.waitFor("id:sync-reupload");
  await app.press("id:sync-reupload");
  await app.waitUntil(() => app.texts().some((t) => t.includes("这篇是空的")));
  expect(sent(app, "POST")).toEqual([]);
  await app.press("id:sync-close");
  expect(app.shows("id:sync-status >> text:1 件事要选")).toBe(true);
  expect(app.texts().some((t) => t.startsWith("上次同步"))).toBe(false);
});

test("while a choice is being carried out, 「立即同步」cannot be pressed", async () => {
  let release: () => void = () => undefined;
  const app = await start({ ...library(), ...linked(BASE) }, {
    ...noGists,
    [`GET ${API}/gists/g1?fresh=*`]: { status: 404 },
    [`POST ${API}/gists`]: () => new Promise((resolve) => (release = () => resolve({ status: 201, body: gistBody(DOC.text, "v1", { id: "g7" }) }))),
  });
  await sync(app);
  await app.waitFor("id:sync-reupload");
  const pressing = app.press("id:sync-reupload");
  await app.waitUntil(() => !app.enabled("id:sync-now"));
  release();
  await pressing;
  await app.waitFor("text:已把「周报」重新上传到 GitHub。");
  expect(app.enabled("id:sync-now")).toBe(true);
});

test("pulling stops if the document was typed in while GitHub was being asked: the typing is kept and nothing is replaced", async () => {
  const app = await start({ ...library(BASE), ...linked(BASE) }, {
    ...noGists,
    [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(REMOTE, "v2"), delay: 600 },
  });
  await app.press("id:sync-status");
  await app.waitFor("id:sync");
  await app.waitFor("id:sync-now");
  const syncing = app.press("id:sync-now");
  await app.press("id:sync-close");
  await app.press("text:共同的一段");
  await app.keyboard.press("end");
  await app.type("label:正文", "又打的字");
  await syncing;
  await app.waitUntil(() => (app.storage()[bodyKey(DOC.id)] ?? "").includes("又打的字"), { timeout: 4000 });
  await app.press("id:sync-status");
  await app.waitFor("text:同步时这篇又改了，没有换。再同步一次。");
  expect(app.storage()[bodyKey(DOC.id)].includes("GitHub 上改的")).toBe(false);
  expect(app.shows("text:GitHub 上改的")).toBe(false);
});

test("when the history is full the local version cannot be kept, so GitHub's is not pulled over it", async () => {
  const QUOTA = 5 * 1024 * 1024;
  const big = `${BASE}\n${"字".repeat(1_000_000)}\n`;
  const seeded: Record<string, string> = { ...AUTH, ...library(big), [syncRecordKey(DOC.id)]: link(big) };
  const used = Object.entries(seeded).reduce((n, [k, v]) => n + k.length + v.length, 0);
  const app = await start({ ...seeded, filler: "x".repeat(QUOTA - used - "filler".length - 300_000) }, {
    ...noGists,
    [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(`${big}GitHub 上改的\n`, "v2") },
  });
  await sync(app);
  await app.waitUntil(() => app.texts().some((t) => t.includes("本机存储已满")));
  expect(app.storage()[bodyKey(DOC.id)]).toBe(big);
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link.version).toBe("v1");
});

test("375 wide: the document name and save state stay; the sync entry is an icon with a short state and keeps its full spoken name", async () => {
  const at = Date.now() - 2 * 86_400_000;
  const day = new Date(at);
  const app = await start({ ...library(), ...linked(DOC.text), "md.sync.lastAt": String(at) }, noGists, { width: 375, height: 700 });
  await app.press("text:本机改的");
  await app.keyboard.press("end");
  await app.type("label:正文", "。");
  await app.waitFor("text:已保存", { timeout: 3000 });
  expect(app.shows("label:同步：上次同步 " + `${day.getMonth() + 1}月${day.getDate()}日` + "，打开同步面板")).toBe(true);
  expect(app.texts().some((t) => t.startsWith("上次同步"))).toBe(false);
  expect(app.texts()).toContain("周报");
  await app.setViewport(1280, 860);
  await app.waitUntil(() => app.texts().some((t) => t.startsWith("上次同步")));
});

/** 没在侧栏改过名的一篇：文档名还是「未命名」，正文标题「第 47 周」。 */
const UNNAMED = { id: "du", name: "未命名", text: "# 第 47 周\n\n一段\n" };
const TITLE = "第 47 周";
const titled = (doc: { id: string; name: string; text: string }) => ({
  ...seedLibrary([doc]),
  [metaKey(doc.id)]: JSON.stringify({ name: doc.name, title: TITLE, updatedAt: 1, version: 1, size: doc.text.length }),
  [LAST_OPENED_KEY]: doc.id,
});
const underTitle = (text: string, version: string, id = "g1") =>
  gistBody(text, version, { id, description: `[Pairdown] ${TITLE}`, files: { [`${TITLE}.md`]: { filename: `${TITLE}.md`, content: text, truncated: false } } });

test("a document never renamed is uploaded with its title as the file name, like the description, and the next sync leaves that name alone", async () => {
  const posted: unknown[] = [];
  const app = await start(titled(UNNAMED), {
    ...noGists,
    [`POST ${API}/gists`]: (req: { body?: string | null }) => {
      posted.push(JSON.parse(req.body ?? "{}"));
      return { status: 201, body: underTitle(UNNAMED.text, "v1") };
    },
    [`GET ${API}/gists/g1?fresh=*`]: { body: underTitle(UNNAMED.text, "v1") },
    [`PATCH ${API}/gists/g1`]: { body: underTitle(UNNAMED.text, "v2") },
  });
  await sync(app);
  await app.waitFor("id:sync-upload");
  await app.press("id:sync-upload-confirm");
  await app.waitFor("text:上传了 1 篇。");
  expect(app.texts()).not.toContain("要你选的事都处理完了。");
  expect(posted).toEqual([{ description: `[Pairdown] ${TITLE}`, public: false, files: { [`${TITLE}.md`]: { content: UNNAMED.text } } }]);
  await app.press("id:sync-now");
  await app.waitFor("text:都是最新的。");
  expect(sent(app, "PATCH")).toEqual([]);
  expect(JSON.parse(app.storage()[syncRecordKey(UNNAMED.id)]).link.fileName).toBe(`${TITLE}.md`);
});

test("a never-synced, never-renamed document finds the gist named after its title instead of uploading it again", async () => {
  const app = await start(titled(UNNAMED), {
    [LIST]: { body: [summary("g5", `${TITLE}.md`)] },
    [`GET ${API}/gists/g5?fresh=*`]: { body: underTitle(UNNAMED.text, "v1", "g5") },
  });
  await sync(app);
  await app.waitFor("text:都是最新的。");
  expect(sent(app, "POST")).toEqual([]);
  expect(JSON.parse(app.storage()[syncRecordKey(UNNAMED.id)]).link.gistId).toBe("g5");
});

test("a gist already linked under the document's name keeps that file name when the title differs; only the description follows the title", async () => {
  const doc = { ...DOC, text: `# ${TITLE}\n\n共同的一段\n\n本机改的\n` };
  let pushed: unknown = null;
  const app = await start({ ...titled(doc), ...linked(BASE) }, {
    ...noGists,
    [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(BASE, "v1") },
    [`PATCH ${API}/gists/g1`]: (req: { body?: string | null }) => {
      pushed = JSON.parse(req.body ?? "{}");
      return { body: gistBody(doc.text, "v2") };
    },
  });
  await sync(app);
  await app.waitFor("text:推上去 1 篇。");
  expect(pushed).toEqual({ description: `[Pairdown] ${TITLE}`, files: { "周报.md": { content: doc.text } } });
});
