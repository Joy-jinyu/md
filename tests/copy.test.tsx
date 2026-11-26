import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { LAST_OPENED_KEY } from "../src/store/library";
import { LEGACY_DOC_KEY } from "../src/store/kv";
import { seedLibrary } from "./fixtures/library";
import { memoryFs } from "./fixtures/memory-fs";

/** 面板里的字可选可复制、「复制」按钮（DESIGN.md「文字可选、可复制」）。macOS 的用例放在最前：排在网页用例后面时内存文件系统会读坏（见 sync-macos.test.tsx 开头）。 */
const SYNCED_APP = "./fixtures/sync-app.tsx";
const API = "https://api.github.com";
const WEB = { platform: "web" as const, width: 1280, height: 860 };
const DOC = { id: "da", name: "周报", text: "# 周报\n\n本机改的\n" };
const library = () => ({ ...seedLibrary([DOC]), [LAST_OPENED_KEY]: DOC.id });

test("macOS sign-in: the user code has its own copy button", async () => {
  const disk = memoryFs({ "Notes.md": "# Notes\n\nmac doc\n" });
  const app = await open(SYNCED_APP, {
    platform: "macos",
    width: 1280,
    height: 860,
    modules: disk.modules,
    network: {
      "POST https://github.com/login/device/code": { body: { device_code: "dev", user_code: "WDJB-MJHT", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 } },
      "POST https://github.com/login/oauth/access_token": { body: { error: "authorization_pending" }, delay: 50 },
    },
  });
  await app.waitFor("text:mac doc");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-sync");
  await app.press("id:sign-in");
  await app.waitFor("text:WDJB-MJHT");
  await app.press("label:复制验证码");
  expect(app.clipboard()).toBe("WDJB-MJHT");
  await app.waitFor("text:已复制");
  expect(app.openedUrls()).toEqual([]);
});

/** 无头测试的输入框不实现系统的编辑键（空白应用里实测也一样），这里只断言应用没把这些键拿去做别的事：对话框还开着、字没变、剪贴板没被写、正文没被撤销。 */
const EDIT_KEYS = ["mod+a", "mod+c", "mod+x", "mod+v", "mod+z", "mod+shift+z"];

test("macOS: the edit keys in a dialog's input are left to the system, not taken by the app", async () => {
  const disk = memoryFs({ "Notes.md": "# Notes\n\nmac doc\n" });
  const app = await open("../App.tsx", { platform: "macos", width: 1280, height: 860, modules: disk.modules, clipboard: "原来的" });
  await app.waitFor("text:mac doc");
  await app.press("id:open-settings");
  await app.type("id:shortcut-search", "粗体");
  for (const keys of EDIT_KEYS) await app.keyboard.press(keys);
  expect(app.shows("id:settings")).toBe(true);
  expect(app.value("id:shortcut-search")).toBe("粗体");
  expect(app.clipboard()).toBe("原来的");
  expect(app.texts()).toContain("mac doc");
});

test("web: the edit keys in a dialog's input reach neither the editor nor the app's commands", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [LEGACY_DOC_KEY]: "# T\n\nbody\n" }, clipboard: "原来的" });
  await app.waitFor("text:body");
  await app.type("label:正文", "x");
  await app.press("id:open-settings");
  await app.type("id:shortcut-search", "粗体");
  for (const keys of EDIT_KEYS) await app.keyboard.press(keys);
  expect(app.shows("id:settings")).toBe(true);
  expect(app.value("id:shortcut-search")).toBe("粗体");
  expect(app.clipboard()).toBe("原来的");
  await app.press("id:settings-done");
  await app.setLifecycle("background");
  expect(app.storage()[LEGACY_DOC_KEY]).toContain("x");
});

test("settings, gateway page: the gateway's one-line start command copies with one press", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [LEGACY_DOC_KEY]: "# T\n\nbody\n" } });
  await app.waitFor("text:body");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-gateway");
  await app.press("label:复制启动命令");
  expect(app.clipboard()).toBe("curl -fsSL https://markdown.pairwise.site/gateway.sh | sh");
  await app.waitFor("text:已复制");
});

test("a copy button the system refuses says it did not copy", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [LEGACY_DOC_KEY]: "# T\n\nbody\n" }, modules: { nsh: { "Clipboard.writeText": () => "failed" } } });
  await app.waitFor("text:body");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-gateway");
  await app.press("label:复制启动命令");
  await app.waitFor("text:没能复制");
  expect(app.shows("text:已复制")).toBe(false);
});

test("an error receipt at the top can be copied as it reads", async () => {
  const app = await open(SYNCED_APP, { ...WEB, storage: library(), modules: { nsh: { "UrlScheme.url": "http://127.0.0.1:8811/", "UrlScheme.setUrl": () => undefined } } });
  await app.waitFor("text:本机改的");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-sync");
  await app.press("id:sign-in");
  const reason = "网页登录只在 markdown.pairwise.site 可用：GitHub 只把登录送回那里登记的地址。";
  await app.waitFor(`text:${reason}`);
  await app.press("id:settings-done");
  await app.press("id:receipt-copy");
  expect(app.clipboard()).toBe(reason);
});

test("a failed sync's reason has a copy button", async () => {
  const auth = { "md.sync.auth": JSON.stringify({ token: "test-token-copy", login: "joy" }) };
  const app = await open(SYNCED_APP, { ...WEB, storage: { ...library(), ...auth }, network: { [`GET ${API}/gists?per_page=100&page=1&fresh=*`]: { status: 500 } } });
  await app.waitFor("text:本机改的");
  await app.press("id:sync-status");
  await app.waitFor("id:sync");
  await app.press("id:sync-now");
  await app.waitFor("id:sync-error");
  await app.press("id:copy-sync-error");
  const copied = app.clipboard() ?? "";
  expect(copied.length > 0).toBe(true);
  expect(app.texts().some((t) => t === `没能同步：${copied}`)).toBe(true);
});
