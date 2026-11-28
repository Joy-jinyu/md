import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { syncRecordKey } from "../src/store/sync-store";
import { memoryFs } from "./fixtures/memory-fs";

/**
 * macOS 的登录（Device Flow）。和网页的同步测试分两个文件：放在同一个文件里排在网页用例后面时，
 * 内存文件系统读出的文库文件被应用当成「不是 UTF-8」（2026-11-25 实测，单独跑就正常，原因没查）。
 */
const SYNCED_APP = "./fixtures/sync-app.tsx";
const API = "https://api.github.com";
const TOKEN = "test-token-secret-mac";
const MAC_DOC = "# Notes\n\nmac doc\n";
const noGists = { [`GET ${API}/gists?per_page=100&page=1&fresh=*`]: { body: [] } };

test("macOS sign-in uses the device flow: shows the code, copies it and opens GitHub, then signs in", async () => {
  const disk = memoryFs({ "Notes.md": MAC_DOC });
  let approved = false;
  const app = await open(SYNCED_APP, {
    platform: "macos",
    width: 1280,
    height: 860,
    modules: disk.modules,
    network: {
      "POST https://github.com/login/device/code": { body: { device_code: "dev", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 } },
      // 用户在 GitHub 上授权之前一直是 pending；测试看完用户码再放行
      "POST https://github.com/login/oauth/access_token": () => (approved ? { body: { access_token: TOKEN, token_type: "bearer", scope: "gist" } } : { body: { error: "authorization_pending" }, delay: 50 }),
      [`GET ${API}/user?fresh=*`]: { body: { login: "mac-joy" } },
      ...noGists,
    },
  });
  await app.waitFor("text:mac doc");
  await app.keyboard.press("mod+,");
  await app.press("id:settings-tab-sync");
  await app.press("id:sign-in");
  await app.waitFor("text:WDJB-MJHT");
  await app.press("id:device-open");
  expect(app.clipboard()).toBe("WDJB-MJHT");
  expect(app.openedUrls()).toContain("https://github.com/login/device");
  approved = true;
  await app.waitFor("text:已登录：@mac-joy");
  expect(JSON.parse(app.storage()["md.sync.auth"]).login).toBe("mac-joy");
});

test("macOS device flow: when the code cannot be copied, the receipt says to type it in by hand", async () => {
  const disk = memoryFs({ "Notes.md": MAC_DOC });
  const app = await open(SYNCED_APP, {
    platform: "macos",
    width: 1280,
    height: 860,
    modules: { ...disk.modules, nsh: { "Clipboard.writeText": () => "failed" } },
    network: {
      "POST https://github.com/login/device/code": { body: { device_code: "dev", user_code: "CCCC-DDDD", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 } },
      "POST https://github.com/login/oauth/access_token": { body: { error: "authorization_pending" }, delay: 50 },
    },
  });
  await app.waitFor("text:mac doc");
  await app.keyboard.press("mod+,");
  await app.press("id:settings-tab-sync");
  await app.press("id:sign-in");
  await app.waitFor("text:CCCC-DDDD");
  await app.press("id:device-open");
  expect(app.openedUrls()).toContain("https://github.com/login/device");
  await app.waitUntil(() => app.texts().includes("验证码没复制上，请在 GitHub 的页面里手动输入上面的验证码。"));
});

test("macOS device flow: a cancel on GitHub shows the reason and offers to sign in again", async () => {
  const disk = memoryFs({ "Notes.md": MAC_DOC });
  const app = await open(SYNCED_APP, {
    platform: "macos",
    width: 1280,
    height: 860,
    modules: disk.modules,
    network: {
      "POST https://github.com/login/device/code": { body: { device_code: "dev", user_code: "AAAA-BBBB", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 } },
      "POST https://github.com/login/oauth/access_token": { body: { error: "access_denied" } },
    },
  });
  await app.waitFor("text:mac doc");
  await app.keyboard.press("mod+,");
  await app.press("id:settings-tab-sync");
  await app.press("id:sign-in");
  await app.waitFor("text:在 GitHub 上取消了授权，没有登录。");
  expect(app.storage()["md.sync.auth"]).toBe(undefined);
});

test("macOS device flow: closing the settings stops asking GitHub for the token", async () => {
  const disk = memoryFs({ "Notes.md": MAC_DOC });
  let polls = 0;
  const app = await open(SYNCED_APP, {
    platform: "macos",
    width: 1280,
    height: 860,
    modules: disk.modules,
    network: {
      "POST https://github.com/login/device/code": { body: { device_code: "dev", user_code: "CCCC-DDDD", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 } },
      "POST https://github.com/login/oauth/access_token": () => {
        polls++;
        return { body: { error: "authorization_pending" }, delay: 20 };
      },
    },
  });
  await app.waitFor("text:mac doc");
  await app.keyboard.press("mod+,");
  await app.press("id:settings-tab-sync");
  await app.press("id:sign-in");
  await app.waitFor("text:CCCC-DDDD");
  await app.waitUntil(() => polls > 1);
  await app.press("id:settings-done");
  const after = polls;
  await app.wait(300);
  expect(polls - after <= 1).toBe(true);
});

const FILES = "files";
const record = (gistId: string, fileName: string, base: string) => JSON.stringify({ link: { gistId, fileName, base, version: "v1", login: "mac-joy", syncedAt: 1 } });
const MAC_AUTH = { "md.sync.auth": JSON.stringify({ token: TOKEN, login: "mac-joy" }) };
const gistOf = (id: string, fileName: string, text: string) => ({ id, description: "[Pairdown] x", history: [{ version: "v1" }], files: { [fileName]: { filename: fileName, content: text } } });

test("a library file that cannot be opened is skipped and said so, never taken as deleted here", async () => {
  const disk = memoryFs({ "Notes.md": MAC_DOC, "Bad.md": new Uint8Array([0x6f, 0x6b, 0xc4, 0xe3, 0x0a]) });
  const app = await open(SYNCED_APP, {
    platform: "macos",
    width: 1280,
    height: 860,
    modules: disk.modules,
    storage: { ...MAC_AUTH, [syncRecordKey("Notes.md", FILES)]: record("g1", "Notes.md", MAC_DOC), [syncRecordKey("Bad.md", FILES)]: record("g7", "Bad.md", "ok\n") },
    network: { ...noGists, [`GET ${API}/gists/g1?fresh=*`]: { body: gistOf("g1", "Notes.md", MAC_DOC) } },
  });
  await app.waitFor("text:mac doc");
  await app.press("id:sync-status");
  await app.press("id:sync-now");
  await app.waitFor("id:sync-issue-failed:Bad.md");
  expect(app.texts().some((t) => t.startsWith("跳过：打不开"))).toBe(true);
  expect(app.shows("text:本机删了，GitHub 上还在。")).toBe(false);
  expect(app.requests().some((r) => r.url.includes("/gists/g7"))).toBe(false);
  expect(JSON.parse(app.storage()[syncRecordKey("Bad.md", FILES)]).link.gistId).toBe("g7");
});

test("renaming a document onto a name an old record still sits on takes its own record there, so it is never pushed into that other gist; the other gist is listed to choose", async () => {
  const disk = memoryFs({ "Alpha.md": MAC_DOC });
  let patchedG1: unknown = null;
  const app = await open(SYNCED_APP, {
    platform: "macos",
    width: 1280,
    height: 860,
    modules: disk.modules,
    storage: { ...MAC_AUTH, [syncRecordKey("Alpha.md", FILES)]: record("g1", "Alpha.md", MAC_DOC), [syncRecordKey("Beta.md", FILES)]: record("g9", "Beta.md", "old beta\n") },
    network: {
      ...noGists,
      [`GET ${API}/gists/g1?fresh=*`]: { body: gistOf("g1", "Alpha.md", MAC_DOC) },
      [`GET ${API}/gists/g9?fresh=*`]: { body: gistOf("g9", "Beta.md", "old beta\n") },
      [`PATCH ${API}/gists/g1`]: (req: { body?: string | null }) => {
        patchedG1 = JSON.parse(req.body ?? "{}");
        return { body: gistOf("g1", "Beta.md", MAC_DOC) };
      },
    } as never,
  });
  await app.waitFor("text:mac doc");
  await app.press("id:toggle-sidebar");
  await app.press("id:doc-more-Alpha.md");
  await app.chooseMenuItem("改文库名…");
  await app.clear("id:rename-input");
  await app.type("id:rename-input", "Beta");
  await app.keyboard.press("enter");
  await app.waitUntil(() => Object.keys(disk.library()).includes("Beta.md"));
  await app.waitUntil(() => app.storage()[syncRecordKey("Alpha.md", FILES)] === undefined);
  expect(JSON.parse(app.storage()[syncRecordKey("Beta.md", FILES)]).link.gistId).toBe("g1");
  await app.press("id:sync-status");
  await app.press("id:sync-now");
  await app.waitFor("text:推上去 1 篇。1 件事要你选。");
  expect(patchedG1).toEqual({ description: "[Pairdown] Beta", files: { "Alpha.md": { filename: "Beta.md", content: MAC_DOC } } });
  expect(app.requests().some((r) => r.url.includes("/gists/g9") && r.method !== "GET")).toBe(false);
  expect(app.shows("id:sync-issue-local-deleted:g9")).toBe(true);
});
