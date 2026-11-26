import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { LEGACY_DOC_KEY } from "../src/store/kv";
import { SETTINGS_KEY } from "../src/store/settings";
import { base64, RED_PNG } from "./fixtures/images";

const WEB = { platform: "web" as const, width: 1280, height: 860 };
/** 仓库里现成的一张 PNG，当成剪贴板上的截图粘贴。 */
const ICON = "assets/icon/icon.png";
const HOST = { url: "https://up.example.com/api", field: "file", urlPath: "", headerNames: ["Authorization"] };
const GITHUB = { kind: "github", repo: "me/pics", branch: "main", dir: "images", hasToken: true };
/** 假网关认的令牌（fixtures/fake-gateway.ts 的 goodToken）。 */
const GOOD_TOKEN = "github_pat_good";

/** 连着假网关打开应用（`params` 设假网关，见 fixtures/gateway-socket.ts），等正文出来。 */
async function openOnGateway(params: Record<string, unknown> = {}, storage: Record<string, string> = {}) {
  const app = await open("./fixtures/gateway-app.tsx", { ...WEB, storage, host: { params: { docs: { "a.md": "# A\n\nbody\n" }, ...params } } });
  await app.waitFor("text:body");
  return app;
}
type App = Awaited<ReturnType<typeof openOnGateway>>;

async function pasteImage(app: App) {
  await app.press("text:body");
  await app.keyboard.press("end");
  await app.paste("label:正文", { files: [ICON] });
}

/** 设置了图床时粘贴：确认框里点「上传」。 */
async function pasteAndUpload(app: App) {
  await pasteImage(app);
  await app.waitFor("id:image-upload-ask");
  await app.press("id:image-upload-yes");
}

/** 选过「上传，以后不再问」。 */
const AUTO_UPLOAD = { [SETTINGS_KEY]: JSON.stringify({ autoUploadImages: true }) };

/** 整篇的 Markdown（「复制为 Markdown」，网页里是 Ctrl+Alt+M），等到它符合 `pattern`。 */
async function markdownMatching(app: App, pattern: RegExp) {
  await app.keyboard.press("ctrl+alt+m");
  await app.waitUntil(() => pattern.test(app.clipboard() ?? ""), { timeout: 3000 });
  return app.clipboard() ?? "";
}

const receiptSays = (app: App, words: string) => app.texts().some((t) => t.includes(words));
/** 设置页「当前图床」里的一项（名字和值分两列，读屏连起来读「名字：值」）。 */
const fieldSays = (app: App, line: string) => app.shows(`label:${line}`);

async function openStorageSettings(app: App) {
  await app.press("id:open-settings");
  await app.press("id:settings-tab-image-host");
  await app.waitFor("id:image-host");
}

test("with an image host set, a pasted image is uploaded and the text gets the image host's address", async () => {
  const app = await openOnGateway({ imageHost: HOST });
  await pasteAndUpload(app);
  expect(await markdownMatching(app, /img\.example/)).toBe("# A\n\nbody![](https://img.example.com/up1.png)\n");
  expect(app.shows("id:image-host-ask")).toBe(false);
});

test("without an image host, pasting asks to set one; saving it uploads this image", async () => {
  const app = await openOnGateway();
  await pasteImage(app);
  await app.waitFor("id:image-host-ask");
  await app.type("label:上传地址", "ftp://up.example.com");
  await app.press("id:image-host-save");
  await app.waitFor("id:image-host-problem");
  expect(receiptSays(app, "上传地址要是 http:// 或 https:// 开头")).toBe(true);
  await app.clear("label:上传地址");
  await app.type("label:上传地址", "https://up.example.com/api");
  await app.type("label:请求头", "Authorization: Bearer secret");
  await app.press("id:image-host-save");
  await app.waitUntil(() => !app.shows("id:image-host-ask"), { timeout: 3000 });
  expect(await markdownMatching(app, /img\.example/)).toBe("# A\n\nbody![](https://img.example.com/up1.png)\n");
  await openStorageSettings(app);
  await app.waitFor("id:image-host-current");
  expect(fieldSays(app, "上传地址：https://up.example.com/api")).toBe(true);
  expect(app.shows("id:image-host-current >> text:https://up.example.com/api")).toBe(true);
  expect(fieldSays(app, "请求头：Authorization（值不显示）")).toBe(true);
  expect(app.texts().some((t) => t.includes("secret"))).toBe(false);
});

test("choosing to store this one locally keeps the image next to the document, and the next paste asks again", async () => {
  const app = await openOnGateway();
  await pasteImage(app);
  await app.waitFor("id:image-host-ask");
  await app.press("id:image-host-local");
  expect(await markdownMatching(app, /assets\//)).toBe("# A\n\nbody![](assets/img1.png)\n");
  await app.paste("label:正文", { files: [ICON] });
  await app.waitFor("id:image-host-ask");
});

test("choosing not to use an image host stores locally and stops asking; the settings can turn the question back on", async () => {
  const app = await openOnGateway();
  await pasteImage(app);
  await app.waitFor("id:image-host-ask");
  await app.press("id:image-host-never");
  await markdownMatching(app, /assets\//);
  expect(JSON.parse(app.storage()[SETTINGS_KEY] ?? "{}").skipImageHost).toBe(true);
  await app.paste("label:正文", { files: [ICON] });
  expect(await markdownMatching(app, /\.png\)!\[\]/)).toBe("# A\n\nbody![](assets/img1.png)![](assets/img1.png)\n");
  expect(app.shows("id:image-host-ask")).toBe(false);
  await openStorageSettings(app);
  await app.waitFor("text:你选过「不用图床」，粘贴图片时不再询问。");
  await app.press("id:image-host-ask-again");
  await app.waitUntil(() => !app.shows("id:image-host-ask-again"), { timeout: 3000 });
  expect(JSON.parse(app.storage()[SETTINGS_KEY] ?? "{}").skipImageHost).toBe(false);
});

test("an image the image host does not take is stored locally and the receipt says why", async () => {
  const app = await openOnGateway({ imageHost: HOST, uploadFails: "upload-failed" });
  await pasteAndUpload(app);
  await app.waitFor("id:receipt");
  await app.waitUntil(() => receiptSays(app, "1 张没传上图床，先存在本地：「"), { timeout: 3000 });
  expect(receiptSays(app, "图床回了 HTTP 500")).toBe(true);
  expect(await markdownMatching(app, /assets\//)).toBe("# A\n\nbody![](assets/img1.png)\n");
});

test("a gateway too old for image hosts does not ask: the image is stored locally, and the settings say to update it", async () => {
  const app = await openOnGateway({ noImageHostOps: true });
  await pasteImage(app);
  expect(await markdownMatching(app, /assets\//)).toBe("# A\n\nbody![](assets/img1.png)\n");
  expect(app.shows("id:image-host-ask")).toBe(false);
  await openStorageSettings(app);
  await app.waitFor("text:本机网关版本太旧，不支持图床。更新网关后再试");
});

test("data: images pasted from a web page go to the image host only when uploads need no confirming, and are stored locally without asking otherwise", async () => {
  const html = `<p><img src="data:image/png;base64,${base64(RED_PNG)}"></p>`;
  const withHost = await openOnGateway({ imageHost: HOST }, AUTO_UPLOAD);
  await withHost.press("text:body");
  await withHost.paste("label:正文", { html, text: "" });
  expect(await markdownMatching(withHost, /img\.example/)).toContain("![](https://img.example.com/up1.png)");
  const unconfirmed = await openOnGateway({ imageHost: HOST });
  await unconfirmed.press("text:body");
  await unconfirmed.paste("label:正文", { html, text: "" });
  expect(await markdownMatching(unconfirmed, /assets\//)).toContain("![](assets/img1.png)");
  expect(unconfirmed.shows("id:image-upload-ask")).toBe(false);
  const without = await openOnGateway();
  await without.press("text:body");
  await without.paste("label:正文", { html, text: "" });
  expect(await markdownMatching(without, /assets\//)).toContain("![](assets/img1.png)");
  expect(without.shows("id:image-host-ask")).toBe(false);
});

test("the storage settings show the image host, and it can be changed and cleared", async () => {
  const app = await openOnGateway({ imageHost: HOST });
  await openStorageSettings(app);
  await app.waitFor("id:image-host-current");
  expect(fieldSays(app, "文件字段名：file")).toBe(true);
  expect(fieldSays(app, "图片地址的位置：自动找")).toBe(true);
  await app.press("id:image-host-edit");
  await app.waitFor("id:image-host-header-names");
  await app.clear("label:文件字段名");
  await app.type("label:文件字段名", "image");
  await app.press("id:image-host-save");
  await app.waitFor("label:文件字段名：image");
  expect(fieldSays(app, "请求头：Authorization（值不显示）")).toBe(true);
  await app.press("id:image-host-stop");
  await app.waitFor("text:没有设置图床，图片存在文档旁边的 assets/ 里。");
  await app.press("id:settings-done");
  await pasteImage(app);
  expect(await markdownMatching(app, /assets\//)).toBe("# A\n\nbody![](assets/img1.png)\n");
  expect(app.shows("id:image-host-ask")).toBe(false);
});

test("without the gateway, the storage page says image hosts need it", async () => {
  const app = await open("../App.tsx", { ...WEB, storage: { [LEGACY_DOC_KEY]: "# T\n\nbody\n" } });
  await app.waitFor("text:body");
  await app.press("id:open-settings");
  await app.press("id:settings-tab-image-host");
  expect(receiptSays(app, "图床要连着本机网关才能用")).toBe(true);
  expect(app.shows("id:image-host")).toBe(false);
});

test("GitHub repository: picking it in the dialog checks the repository and asks for a token, then the pasted image gets the raw address", async () => {
  const app = await openOnGateway();
  await pasteImage(app);
  await app.waitFor("id:image-host-ask");
  await app.press("id:image-host-kind-github");
  expect(app.shows("label:GitHub 仓库（当前）")).toBe(true);
  await app.type("label:仓库", "not a repo");
  await app.press("id:image-host-save");
  await app.waitFor("id:image-host-problem");
  expect(receiptSays(app, "仓库要写成「用户/仓库」")).toBe(true);
  await app.clear("label:仓库");
  await app.type("label:仓库", "me/pics");
  await app.press("id:image-host-save");
  await app.waitFor("text:要填令牌（GitHub 的 personal access token）");
  await app.type("label:令牌", GOOD_TOKEN);
  await app.press("id:image-host-save");
  await app.waitUntil(() => !app.shows("id:image-host-ask"), { timeout: 3000 });
  expect(await markdownMatching(app, /raw\.githubusercontent/)).toBe("# A\n\nbody![](https://raw.githubusercontent.com/me/pics/main/images/up1.png)\n");
  await openStorageSettings(app);
  await app.waitFor("label:GitHub 仓库：me/pics");
  for (const line of ["分支：main", "目录：images", "令牌：已设置（值不显示）"]) expect(fieldSays(app, line)).toBe(true);
  expect(receiptSays(app, GOOD_TOKEN)).toBe(false);
});

test("GitHub repository: changing the branch with the token left empty keeps the saved token", async () => {
  const app = await openOnGateway({ imageHost: GITHUB, githubToken: GOOD_TOKEN });
  await openStorageSettings(app);
  await app.waitFor("label:GitHub 仓库：me/pics");
  await app.press("id:image-host-edit");
  expect(app.shows("label:GitHub 仓库（当前）")).toBe(true);
  await app.clear("label:分支");
  await app.type("label:分支", "pages");
  await app.press("id:image-host-save");
  await app.waitFor("label:分支：pages");
  await app.press("id:settings-done");
  await pasteAndUpload(app);
  expect(await markdownMatching(app, /raw\.githubusercontent/)).toBe("# A\n\nbody![](https://raw.githubusercontent.com/me/pics/pages/images/up1.png)\n");
});

test("GitHub repository: when GitHub refuses the upload, the receipt gives the gateway's reason and the image is stored locally", async () => {
  const app = await openOnGateway({ imageHost: GITHUB, githubToken: "github_pat_expired" });
  await pasteAndUpload(app);
  await app.waitUntil(() => receiptSays(app, "GitHub 不认这个令牌（401）：令牌不对或者过期了"), { timeout: 3000 });
  expect(receiptSays(app, "1 张没传上图床，先存在本地")).toBe(true);
  expect(await markdownMatching(app, /assets\//)).toBe("# A\n\nbody![](assets/img1.png)\n");
});

test("with an image host set, pasting first asks; the upload is announced at once and again when done", async () => {
  const app = await openOnGateway({ imageHost: GITHUB, githubToken: GOOD_TOKEN, uploadDelay: 400 });
  await pasteImage(app);
  await app.waitFor("id:image-upload-ask");
  expect(receiptSays(app, "把 1 张图片传到图床？")).toBe(true);
  expect(receiptSays(app, "会传到 GitHub 仓库 me/pics")).toBe(true);
  await app.press("id:image-upload-yes");
  await app.waitUntil(() => receiptSays(app, "正在把 1 张图片传到图床…"), { timeout: 3000 });
  await app.waitUntil(() => receiptSays(app, "1 张图片已传到图床"), { timeout: 3000 });
  expect(await markdownMatching(app, /raw\.githubusercontent/)).toContain("https://raw.githubusercontent.com/me/pics/main/images/up1.png");
});

/** 正文里已经有图了（那一行不再只是「body」）：光标还在原处，直接再贴。 */
const again = (app: App) => app.paste("label:正文", { files: [ICON] });

test("declining the upload stores the image locally and asks again next time; choosing not to be asked uploads from then on", async () => {
  const app = await openOnGateway({ imageHost: HOST });
  await pasteImage(app);
  await app.waitFor("id:image-upload-ask");
  await app.press("id:image-upload-local");
  expect(await markdownMatching(app, /assets\//)).toBe("# A\n\nbody![](assets/img1.png)\n");
  await again(app);
  await app.waitFor("id:image-upload-ask");
  await app.press("id:image-upload-always");
  await markdownMatching(app, /img\.example/);
  expect(JSON.parse(app.storage()[SETTINGS_KEY] ?? "{}").autoUploadImages).toBe(true);
  await again(app);
  expect((await markdownMatching(app, /up2\.png/)).match(/img\.example/g)?.length).toBe(2);
  expect(app.shows("id:image-upload-ask")).toBe(false);
  // 设置页能改回「先问」
  await openStorageSettings(app);
  await app.waitFor("text:插入图片时直接上传，不先问。");
  await app.press("id:image-host-auto-toggle");
  await app.waitFor("text:插入图片时先问要不要上传。");
  expect(JSON.parse(app.storage()[SETTINGS_KEY] ?? "{}").autoUploadImages).toBe(false);
});
