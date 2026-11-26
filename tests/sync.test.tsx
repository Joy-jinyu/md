import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { historyKey } from "../src/store/history";
import { LAST_OPENED_KEY } from "../src/store/library";
import { SETTINGS_KEY } from "../src/store/settings";
import { bodyKey } from "../src/store/local-store";
import { syncRecordKey } from "../src/store/sync-store";
import { seedLibrary } from "./fixtures/library";
import { TEST_WORKER } from "./fixtures/sync-config";

const WEB = { platform: "web" as const, width: 1280, height: 860 };
const API = "https://api.github.com";
const TOKEN = "test-token-secret-sync";
const AUTH = { "md.sync.auth": JSON.stringify({ token: TOKEN, login: "joy" }) };
const SYNCED_APP = "./fixtures/sync-app.tsx";

const DOC = { id: "da", name: "周报", text: "# 周报\n\n共同的一段\n\n本机改的\n" };
const BASE = "# 周报\n\n共同的一段\n";
const REMOTE = "# 周报\n\n共同的一段\n\nGitHub 上改的\n";

const library = (text = DOC.text) => ({ ...seedLibrary([{ ...DOC, text }]), [LAST_OPENED_KEY]: DOC.id });
const linked = (base: string, version = "v1") => ({
  [syncRecordKey(DOC.id)]: JSON.stringify({ link: { gistId: "g1", fileName: "周报.md", base, version, login: "joy", syncedAt: 1 } }),
});
const gistBody = (text: string, version: string) => ({
  id: "g1",
  description: "[Pairdown] 周报",
  updated_at: "2026-11-25T00:00:00Z",
  history: [{ version }],
  files: { "周报.md": { filename: "周报.md", content: text, truncated: false } },
});
/** 刚留过一个版本：之后几分钟内的小改动不会自动再留，被放弃的那一边进没进历史只看同步自己有没有存。 */
const recentSnapshot = () => ({ [historyKey(DOC.id)]: JSON.stringify([{ at: Date.now(), text: "更早的一版" }]) });
const noGists = { [`GET ${API}/gists?per_page=100&page=1&fresh=*`]: { body: [] } };

/** 存储里还有没有 token 的影子（任何一个键的值里）。 */
const leaksToken = (storage: Record<string, string>) => Object.values(storage).some((v) => v.includes(TOKEN));

async function openSyncPanel(app: Awaited<ReturnType<typeof open>>) {
  await app.press("id:sync-status");
  await app.waitFor("id:sync");
}

test("without an OAuth App configured, the settings sync tab says so, sign-in is disabled, and the top bar has no sync entry", async () => {
  const app = await open("./fixtures/sync-unconfigured-app.tsx", { ...WEB, storage: library() });
  await app.waitFor("text:本机改的");
  expect(app.shows("id:sync-status")).toBe(false);
  await app.press("id:open-settings");
  await app.press("id:settings-tab-sync");
  await app.waitFor("id:sync-not-configured");
  expect(app.texts()).toContain("同步还没配置");
  await expect(app.press("id:sign-in")).rejects.toMatchObject({ code: "ERR_NSH_TEST_DISABLED" });
  expect(app.texts().some((t) => t.includes("图片不同步"))).toBe(true);
});

const VERIFIER = "v".repeat(43);
const oauthState = (state: string) => ({ "md.sync.oauthState": JSON.stringify({ state, at: Date.now(), verifier: VERIFIER, redirectUri: "https://markdown.pairwise.site/" }) });

test("web sign-in: back from GitHub with the saved state, the code is exchanged at the worker with the PKCE verifier, the address is cleaned and the account shows", async () => {
  let workerBody: unknown = null;
  const addresses: string[] = [];
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...library(), ...oauthState("st4te") },
    modules: { nsh: { "UrlScheme.url": "https://markdown.pairwise.site/?code=c0de&state=st4te", "UrlScheme.setUrl": (url: string) => void addresses.push(url) } },
    network: {
      [`POST ${TEST_WORKER}/token`]: (req) => {
        workerBody = JSON.parse(req.body ?? "null");
        return { body: { access_token: TOKEN, token_type: "bearer", scope: "gist" } };
      },
      [`GET ${API}/user?fresh=*`]: { body: { login: "joy" } },
      [`GET ${API}/gists?per_page=100&page=1&fresh=*`]: { body: [{ id: "old", description: "[Pairdown] 旧笔记", updated_at: "", files: { "旧笔记.md": {} } }] },
    },
  });
  await app.waitFor("text:已登录：@joy");
  expect(workerBody).toEqual({ code: "c0de", state: "st4te", code_verifier: VERIFIER, redirect_uri: "https://markdown.pairwise.site/" });
  expect(addresses).toEqual(["https://markdown.pairwise.site/"]);
  // 登录后列出 GitHub 上有、这台设备没有的
  await app.waitFor("id:sync-issue-remote:old");
  expect(app.storage()["md.sync.oauthState"]).toBe(undefined);
  expect(app.texts().some((t) => t.includes(TOKEN))).toBe(false);
});

test("web sign-in with a state that does not match is refused, nothing is stored, and the sign-in started here is not used up", async () => {
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...library(), ...oauthState("mine") },
    modules: { nsh: { "UrlScheme.url": "https://markdown.pairwise.site/?code=c0de&state=forged", "UrlScheme.setUrl": () => undefined } },
    network: { [`POST ${TEST_WORKER}/token`]: { body: { access_token: TOKEN } } },
  });
  await app.waitFor("text:登录回来的校验码对不上，没有登录。重新点「用 GitHub 登录」。");
  expect(app.storage()["md.sync.auth"]).toBe(undefined);
  await app.waitFor("text:未登录");
  expect(JSON.parse(app.storage()["md.sync.oauthState"]).state).toBe("mine");
});

async function pressWebSignIn(pageAddress: string) {
  const app = await open(SYNCED_APP, { ...WEB, storage: library(), modules: { nsh: { "UrlScheme.url": pageAddress, "UrlScheme.setUrl": () => undefined } } });
  await app.waitFor("text:本机改的");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-sync");
  await app.press("id:sign-in");
  return app;
}

test("web sign-in from a page other than the registered one says where it works and does not go to GitHub", async () => {
  const app = await pressWebSignIn("http://127.0.0.1:8811/");
  await app.waitFor("text:网页登录只在 markdown.pairwise.site 可用：GitHub 只把登录送回那里登记的地址。");
  expect(app.openedUrls()).toEqual([]);
  expect(app.storage()["md.sync.oauthState"]).toBe(undefined);
});

test("web sign-in from the registered page opens GitHub's authorize page", async () => {
  const app = await pressWebSignIn("https://markdown.pairwise.site/");
  await app.waitUntil(() => app.openedUrls().length === 1);
  expect(app.openedUrls()[0].startsWith("https://github.com/login/oauth/authorize?")).toBe(true);
  expect(JSON.parse(app.storage()["md.sync.oauthState"]).redirectUri).toBe("https://markdown.pairwise.site/");
});

test("web sign-in always sends GitHub the registered callback as redirect_uri, whatever else is on the page address", async () => {
  const pages = ["https://markdown.pairwise.site/?iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth", "https://markdown.pairwise.site/index.html", "https://markdown.pairwise.site/?foo=1#bar"];
  for (const page of pages) {
    const app = await pressWebSignIn(page);
    await app.waitUntil(() => app.openedUrls().length === 1);
    const url = new URL(app.openedUrls()[0]);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect([...url.searchParams.keys()]).toEqual(["client_id", "scope", "state", "redirect_uri", "allow_signup", "code_challenge", "code_challenge_method"]);
    expect(url.searchParams.get("redirect_uri")).toBe("https://markdown.pairwise.site/");
    expect(url.search.includes("redirect_uri=https%3A%2F%2Fmarkdown.pairwise.site%2F&")).toBe(true);
    expect(JSON.parse(app.storage()["md.sync.oauthState"]).redirectUri).toBe("https://markdown.pairwise.site/");
  }
});

test("GitHub's own error codes are explained even when the sign-in was started on another page; other errors without a matching state are refused as before", async () => {
  const cases = [
    ["redirect_uri_mismatch", "GitHub 不认这个页面的回调地址（redirect_uri_mismatch），没有登录：网页登录只在 markdown.pairwise.site 可用。"],
    ["application_suspended", "这个 GitHub OAuth App 被停用了（application_suspended），现在登录不了。"],
    ["access_denied", "在 GitHub 上取消了授权，没有登录。"],
    ["constructor", "这次登录不是从这个页面发起的（或者已经用过了），没有登录。重新点「用 GitHub 登录」。"],
  ];
  for (const [error, said] of cases) {
    const app = await open(SYNCED_APP, {
      ...WEB,
      storage: library(),
      modules: { nsh: { "UrlScheme.url": `https://markdown.pairwise.site/?error=${error}&state=st4te`, "UrlScheme.setUrl": () => undefined } },
    });
    await app.waitFor(`text:${said}`);
    expect(app.storage()["md.sync.auth"]).toBe(undefined);
  }
});

test("the settings say where the sign-in is kept and that signing out does not revoke it on GitHub", async () => {
  const app = await open(SYNCED_APP, { ...WEB, storage: { ...library(), ...AUTH } });
  await app.waitFor("text:本机改的");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-sync");
  const said = app.texts().find((t) => t.startsWith("登录凭证存在这个浏览器里")) ?? "";
  expect(said.includes("只有 Gist 权限，退出登录会删除")).toBe(true);
  expect(said.includes("退出登录不会撤销 GitHub 上的授权")).toBe(true);
});

test("another tab switched the account: coming back clears the old account's choices, and a choice left on screen is not carried out", async () => {
  const kept = new Map(Object.entries({ ...library(), ...linked(BASE), ...AUTH, [SETTINGS_KEY]: JSON.stringify({ locale: "zh-CN" }) }));
  const storage = {
    "Storage.getItem": (key: string) => kept.get(key) ?? null,
    "Storage.setItem": (key: string, value: string) => void kept.set(key, value),
    "Storage.removeItem": (key: string) => void kept.delete(key),
    "Storage.keys": () => [...kept.keys()],
    "Storage.clear": () => kept.clear(),
  };
  const app = await open(SYNCED_APP, { ...WEB, modules: { nsh: storage }, network: { ...noGists, [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(REMOTE, "v2") } } as never });
  const conflictShown = async () => {
    await app.press("id:sync-now");
    await app.waitFor("id:sync-issue-conflict:da");
  };
  const switchTo = (login: string) => kept.set("md.sync.auth", JSON.stringify({ token: `test-token-${login}`, login }));
  await app.waitFor("text:本机改的");
  await openSyncPanel(app);
  await conflictShown();
  switchTo("other");
  await app.setLifecycle("background");
  await app.setLifecycle("active");
  await app.waitUntil(() => !app.shows("id:sync-issue-conflict:da"));
  await app.waitFor("text:已登录：@other");
  // 换回来再同步一次；这次没回到前台就换了账号，留在屏幕上的选择不照着旧账号的判定去做
  switchTo("joy");
  await conflictShown();
  switchTo("other");
  await app.press("id:sync-compare");
  await app.press("id:conflict-take-remote");
  await app.waitUntil(() => app.texts().some((t) => t.includes("登录的账号换成了 @other")));
  expect(kept.get(bodyKey(DOC.id))).toBe(DOC.text);
  expect(app.shows("id:sync-issue-conflict:da")).toBe(false);
});

test("syncing a document never synced lists it first; once confirmed it is uploaded as a secret gist and said so", async () => {
  let created: Record<string, unknown> | null = null;
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...library(), ...AUTH },
    network: {
      ...noGists,
      [`POST ${API}/gists`]: (req) => {
        created = JSON.parse(req.body ?? "{}");
        return { status: 201, body: gistBody(DOC.text, "v1") };
      },
    },
  });
  await app.waitFor("text:本机改的");
  // 登录了、没同步过：读屏名说状态，不读成「同步：同步」
  expect(app.shows("label:同步：还没同步过，打开同步面板")).toBe(true);
  await openSyncPanel(app);
  await app.press("id:sync-now");
  await app.waitFor("id:sync-upload");
  expect(app.texts()).toContain("1 篇还没上传过，勾选确认后才上传。");
  expect(created).toBe(null);
  await app.press("id:sync-upload-confirm");
  await app.waitFor("text:已上传 1 篇（私密 Gist）。");
  // 面板里的结果句说上传了几篇，不笼统说「都处理完了」
  await app.waitFor("text:上传了 1 篇。");
  expect(app.texts()).not.toContain("要你选的事都处理完了。");
  expect(created).toEqual({ description: "[Pairdown] 周报", public: false, files: { "周报.md": { content: DOC.text } } });
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link.gistId).toBe("g1");
  expect(app.shows("id:sync-upload")).toBe(false);
  await app.press("id:sync-close");
  await app.waitUntil(() => app.texts().some((t) => t.startsWith("上次同步 ")));
  expect(app.shows("label:同步：" + app.texts().find((t) => t.startsWith("上次同步 ")) + "，打开同步面板")).toBe(true);
});

const DIARY = { id: "dp", name: "日记", text: "# 日记\n\n私事\n" };

/** 库里两篇都没同步过：周报、日记。 */
async function openTwoNew() {
  const posted: string[] = [];
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...seedLibrary([DOC, DIARY]), [LAST_OPENED_KEY]: DOC.id, ...AUTH },
    network: {
      ...noGists,
      [`POST ${API}/gists`]: (req) => {
        posted.push(req.body ?? "");
        return { status: 201, body: gistBody(DOC.text, "v1") };
      },
      [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(DOC.text, "v1") },
    },
  });
  await app.waitFor("text:本机改的");
  await openSyncPanel(app);
  await app.press("id:sync-now");
  await app.waitFor("id:sync-upload");
  expect(app.shows("id:sync-upload >> text:周报")).toBe(true);
  expect(app.shows("id:sync-upload >> text:日记")).toBe(true);
  expect(app.shows("text:上传这 2 篇")).toBe(true);
  expect(posted).toEqual([]);
  return { app, posted };
}

test("the documents a sync would upload are listed to tick; only the ticked one is uploaded and the other is marked not to sync", async () => {
  const { app, posted } = await openTwoNew();
  await app.press(`id:sync-upload-pick-${DIARY.id}`);
  await app.waitFor("text:上传这 1 篇");
  await app.press("id:sync-upload-confirm");
  await app.waitFor("text:已上传 1 篇（私密 Gist）。没勾的 1 篇以后不同步，打开那篇在同步面板里点「恢复同步」可以改回。");
  await app.waitFor("text:上传了 1 篇。没勾的 1 篇标成了不同步。");
  expect(posted.length).toBe(1);
  expect(posted[0].includes("周报") && !posted[0].includes("私事")).toBe(true);
  const storage = app.storage();
  expect(JSON.parse(storage[syncRecordKey(DOC.id)]).link.gistId).toBe("g1");
  expect(JSON.parse(storage[syncRecordKey(DIARY.id)])).toEqual({ excluded: true });
  // 再同步：日记不同步了、周报已连上，什么都不用确认
  await app.press("id:sync-now");
  await app.waitFor("text:都是最新的。");
  expect(app.shows("id:sync-upload")).toBe(false);
  expect(posted.length).toBe(1);
});

test("「先不上传」 uploads nothing and marks nothing; the next sync asks again", async () => {
  const { app, posted } = await openTwoNew();
  await app.press(`id:sync-upload-pick-${DOC.id}`);
  await app.press(`id:sync-upload-pick-${DIARY.id}`);
  await app.waitFor("text:这些都不同步");
  await app.press("id:sync-upload-later");
  await app.waitFor("text:这次没有上传。下次同步还会问。");
  expect(app.shows("id:sync-upload")).toBe(false);
  expect(posted).toEqual([]);
  expect(Object.keys(app.storage()).filter((k) => k.startsWith(syncRecordKey("")))).toEqual([]);
  await app.press("id:sync-now");
  await app.waitFor("id:sync-upload");
  expect(app.shows("text:上传这 2 篇")).toBe(true);
  expect(posted).toEqual([]);
});

test("only GitHub changed: the document is pulled into the editor and the local version goes into history", async () => {
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...library(BASE), ...linked(BASE), ...AUTH, ...recentSnapshot() },
    network: { ...noGists, [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(REMOTE, "v2") } },
  });
  await app.waitFor("text:共同的一段");
  await openSyncPanel(app);
  await app.press("id:sync-now");
  await app.waitFor("text:拉下来 1 篇。");
  await app.press("id:sync-close");
  await app.waitFor("text:GitHub 上改的");
  expect(app.storage()[bodyKey(DOC.id)]).toBe(REMOTE);
  expect(app.storage()[historyKey(DOC.id)]).toContain("共同的一段");
});

/** 两边都改了：本机「本机改的」，GitHub「GitHub 上改的」。 */
async function openConflict(network: Record<string, unknown> = {}) {
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...library(), ...linked(BASE), ...AUTH, ...recentSnapshot() },
    network: { ...noGists, [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(REMOTE, "v2") }, ...network } as never,
  });
  await app.waitFor("text:本机改的");
  await openSyncPanel(app);
  await app.press("id:sync-now");
  await app.waitFor("id:sync-issue-conflict:da");
  expect(app.texts()).toContain("1 件事要你选。");
  await app.press("id:sync-compare");
  await app.waitFor("id:conflict-view");
  expect(app.shows("id:conflict-local >> text:只在本机")).toBe(true);
  expect(app.shows("id:conflict-remote >> text:只在 GitHub")).toBe(true);
  expect(app.shows("id:conflict-remote >> text:GitHub 上改的")).toBe(true);
  return app;
}

test("a conflict is never resolved on its own: choosing GitHub's puts it in the editor and the local edit into history", async () => {
  const app = await openConflict();
  // 选之前什么都没动
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
  await app.press("id:conflict-take-remote");
  await app.waitUntil(() => app.storage()[bodyKey(DOC.id)] === REMOTE);
  expect(app.storage()[historyKey(DOC.id)]).toContain("本机改的");
  // GitHub 上那份没动，记录跟上 GitHub 的版本；回到列表结果句跟着变
  expect(app.requests().filter((r) => r.method !== "GET")).toEqual([]);
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link).toMatchObject({ base: REMOTE, version: "v2" });
  await app.waitFor("text:已换成 GitHub 上的「周报」。本机原来的内容存进了这篇的版本历史。");
  await app.waitFor("text:要你选的事都处理完了。");
  await app.press("id:sync-close");
  await app.waitFor("text:GitHub 上改的");
  expect(app.shows("text:本机改的")).toBe(false);
});

test("choosing to keep the local one pushes it and keeps GitHub's version in history", async () => {
  let pushed: Record<string, unknown> | null = null;
  const app = await openConflict({
    [`PATCH ${API}/gists/g1`]: (req: { body?: string | null }) => {
      pushed = JSON.parse(req.body ?? "{}");
      return { body: gistBody(DOC.text, "v3") };
    },
  });
  await app.press("id:conflict-keep-local");
  await app.waitUntil(() => pushed !== null);
  expect(pushed).toEqual({ description: "[Pairdown] 周报", files: { "周报.md": { content: DOC.text } } });
  await app.waitUntil(() => (app.storage()[historyKey(DOC.id)] ?? "").includes("GitHub 上改的"));
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link.version).toBe("v3");
  // 选完回到列表：结果句不再说还有一件要选
  await app.waitFor("text:要你选的事都处理完了。");
  expect(app.texts()).not.toContain("1 件事要你选。");
  expect(app.shows("id:sync-issue-conflict:da")).toBe(false);
});

test("「先不选」 goes back to the list with the conflict still there, and neither side, the history nor the record changes", async () => {
  const app = await openConflict();
  const before = app.storage();
  await app.press("id:conflict-later");
  await app.waitFor("id:sync-issue-conflict:da");
  expect(app.shows("id:conflict-view")).toBe(false);
  expect(app.texts()).toContain("1 件事要你选。");
  const after = app.storage();
  const kept = (s: Record<string, string>) => [s[bodyKey(DOC.id)], s[historyKey(DOC.id)], s[syncRecordKey(DOC.id)]];
  expect(kept(after)).toEqual(kept(before));
  expect(app.requests().filter((r) => r.method !== "GET")).toEqual([]);
});

/** GitHub 上那份删了（404）：列出来问。`posted` 收「重新上传」建的 Gist。 */
async function openRemoteDeleted() {
  const posted: unknown[] = [];
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...library(), ...linked(BASE), ...AUTH },
    network: {
      ...noGists,
      [`GET ${API}/gists/g1?fresh=*`]: { status: 404 },
      [`POST ${API}/gists`]: (req) => {
        posted.push(JSON.parse(req.body ?? "{}"));
        return { status: 201, body: { ...gistBody(DOC.text, "n1"), id: "g7" } };
      },
    },
  });
  await app.waitFor("text:本机改的");
  await openSyncPanel(app);
  await app.press("id:sync-now");
  await app.waitFor("text:GitHub 上的那份被删了，本机这篇还在。");
  return { app, posted };
}

test("a gist deleted on GitHub is not re-created or deleted locally without asking", async () => {
  const { app, posted } = await openRemoteDeleted();
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
  expect(app.shows("id:sync-reupload")).toBe(true);
  expect(posted).toEqual([]);
});

test("「重新上传」 makes a new secret gist of this document and links it; the document is unchanged", async () => {
  const { app, posted } = await openRemoteDeleted();
  await app.press("id:sync-reupload");
  await app.waitFor("text:已把「周报」重新上传到 GitHub。");
  await app.waitFor("text:上传了 1 篇。");
  expect(posted).toEqual([{ description: "[Pairdown] 周报", public: false, files: { "周报.md": { content: DOC.text } } }]);
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)]).link).toMatchObject({ gistId: "g7", base: DOC.text, version: "n1" });
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
  expect(app.shows("id:sync-issue-remote-deleted:da")).toBe(false);
});

test("「不再同步这篇」 drops the link and marks the document not to sync: nothing is uploaded, and later syncs leave it alone", async () => {
  const { app, posted } = await openRemoteDeleted();
  await app.press("id:sync-stop");
  await app.waitFor("text:「周报」以后不同步了。");
  // 开着的就是这篇：面板里这篇的开关跟着变
  await app.waitFor("text:这篇不同步");
  expect(JSON.parse(app.storage()[syncRecordKey(DOC.id)])).toEqual({ excluded: true });
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
  expect(app.shows("id:sync-issue-remote-deleted:da")).toBe(false);
  const asked = app.requests().length;
  await app.press("id:sync-now");
  await app.waitFor("text:都是最新的。");
  expect(app.requests().slice(asked).some((r) => r.url.includes("/gists/g1"))).toBe(false);
  expect(posted).toEqual([]);
});

test("an expired sign-in (401) signs out, says so, and deletes the stored token", async () => {
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...library(), ...AUTH },
    network: { [`GET ${API}/gists?per_page=100&page=1&fresh=*`]: { status: 401 } },
  });
  await app.waitFor("text:本机改的");
  await openSyncPanel(app);
  await app.press("id:sync-now");
  await app.waitFor("id:sync-error");
  await app.waitUntil(() => app.storage()["md.sync.auth"] === undefined);
  expect(leaksToken(app.storage())).toBe(false);
});

test("an expired sign-in says to sign in again and keeps every document and sync record", async () => {
  const before: Record<string, string> = { ...library(), ...linked(BASE), ...AUTH };
  const app = await open(SYNCED_APP, { ...WEB, storage: before, network: { [`GET ${API}/gists?per_page=100&page=1&fresh=*`]: { status: 401 } } });
  await app.waitFor("text:本机改的");
  await openSyncPanel(app);
  await app.press("id:sync-now");
  await app.waitFor("id:sync-error");
  expect(app.texts().some((t) => t.includes("GitHub 登录过期了") && t.includes("请重新登录") && t.includes("文档和同步记录都还在"))).toBe(true);
  await app.waitUntil(() => app.storage()["md.sync.auth"] === undefined);
  const after = app.storage();
  expect(after[syncRecordKey(DOC.id)]).toBe(before[syncRecordKey(DOC.id)]);
  expect(after[bodyKey(DOC.id)]).toBe(DOC.text);
});

test("signing out deletes the token and leaves the documents alone", async () => {
  const app = await open(SYNCED_APP, { ...WEB, storage: { ...library(), ...AUTH } });
  await app.waitFor("text:本机改的");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-sync");
  await app.waitFor("text:已登录：@joy");
  await app.press("id:sign-out");
  await app.waitFor("id:sign-in");
  expect(app.storage()["md.sync.auth"]).toBe(undefined);
  expect(leaksToken(app.storage())).toBe(false);
  expect(app.storage()[bodyKey(DOC.id)]).toBe(DOC.text);
});

test("a document marked not to sync is skipped", async () => {
  const app = await open(SYNCED_APP, { ...WEB, storage: { ...library(), ...AUTH }, network: noGists });
  await app.waitFor("text:本机改的");
  await openSyncPanel(app);
  await app.press("id:sync-toggle-doc");
  await app.waitFor("text:这篇不同步");
  await app.press("id:sync-now");
  await app.waitFor("text:都是最新的。");
});

test("deleted here but still on GitHub: asks, and pulling it back makes a new document linked to the same gist", async () => {
  const gone = { [syncRecordKey("old-id")]: JSON.stringify({ link: { gistId: "g1", fileName: "周报.md", base: BASE, version: "v1", login: "joy", syncedAt: 1 } }) };
  const app = await open(SYNCED_APP, {
    ...WEB,
    storage: { ...seedLibrary([{ id: "db", name: "其他", text: "其他\n" }]), [LAST_OPENED_KEY]: "db", ...gone, ...AUTH, [syncRecordKey("db")]: JSON.stringify({ excluded: true }) },
    network: { [`GET ${API}/gists?per_page=100&page=1&fresh=*`]: { body: [gistBody(BASE, "v1")] }, [`GET ${API}/gists/g1?fresh=*`]: { body: gistBody(BASE, "v1") } },
  });
  await app.waitFor("text:其他");
  await openSyncPanel(app);
  await app.press("id:sync-now");
  await app.waitFor("text:本机删了，GitHub 上还在。");
  // GitHub 上那篇已经连着（本机删了的那篇），不当成「这台设备上没有」的再列一次
  expect(app.shows("id:sync-issue-remote:g1")).toBe(false);
  await app.press("id:sync-pull-back");
  await app.waitFor("text:已把「周报」从 GitHub 拉回本机。");
  const storage = app.storage();
  expect(storage[syncRecordKey("old-id")]).toBe(undefined);
  const pulled = Object.keys(storage).filter((k) => k.startsWith(syncRecordKey("")) && k !== syncRecordKey("db"));
  expect(pulled.length).toBe(1);
  const id = pulled[0].slice(syncRecordKey("").length);
  expect(storage[bodyKey(id)]).toBe(BASE);
});
