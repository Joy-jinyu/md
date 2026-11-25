import { expect, open, test } from "nsh/test";
import { LEGACY_DOC_KEY } from "../src/store/kv";
import { SETTINGS_KEY } from "../src/store/settings";
import { base64, RED_PNG } from "./fixtures/images";

const WEB = { platform: "web" as const, width: 1280, height: 860 };
/** 仓库里现成的一张 PNG，当成剪贴板上的截图粘贴。 */
const ICON = "assets/icon/icon.png";
const HOST = { url: "https://up.example.com/api", field: "file", urlPath: "", headerNames: ["Authorization"] };

/** 连着假网关打开应用（`params` 设假网关，见 fixtures/gateway-socket.ts），等正文出来。 */
async function openOnGateway(params: Record<string, unknown> = {}) {
  const app = await open("./fixtures/gateway-app.tsx", { ...WEB, host: { params: { docs: { "a.md": "# A\n\nbody\n" }, ...params } } });
  await app.waitFor("text:body");
  return app;
}
type App = Awaited<ReturnType<typeof openOnGateway>>;

async function pasteImage(app: App) {
  await app.press("text:body");
  await app.keyboard.press("end");
  await app.paste("label:正文", { files: [ICON] });
}

/** 整篇的 Markdown（「复制为 Markdown」，网页里是 Ctrl+Alt+M），等到它符合 `pattern`。 */
async function markdownMatching(app: App, pattern: RegExp) {
  await app.keyboard.press("ctrl+alt+m");
  await app.waitUntil(() => pattern.test(app.clipboard() ?? ""), { timeout: 3000 });
  return app.clipboard() ?? "";
}

const receiptSays = (app: App, words: string) => app.texts().some((t) => t.includes(words));

async function openStorageSettings(app: App) {
  await app.press("id:open-settings");
  await app.press("id:settings-tab-storage");
  await app.waitFor("id:image-host");
}

test("with an image host set, a pasted image is uploaded and the text gets the image host's address", async () => {
  const app = await openOnGateway({ imageHost: HOST });
  await pasteImage(app);
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
  expect(receiptSays(app, "上传地址：https://up.example.com/api")).toBe(true);
  expect(receiptSays(app, "请求头：Authorization（值不显示）")).toBe(true);
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
  await pasteImage(app);
  await app.waitFor("id:receipt");
  await app.waitUntil(() => receiptSays(app, "1 张没传上图床，先存在本地：「"), { timeout: 3000 });
  expect(receiptSays(app, "图床没传成")).toBe(true);
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

test("data: images pasted from a web page go to the image host when one is set, and are stored locally without asking when not", async () => {
  const html = `<p><img src="data:image/png;base64,${base64(RED_PNG)}"></p>`;
  const withHost = await openOnGateway({ imageHost: HOST });
  await withHost.press("text:body");
  await withHost.paste("label:正文", { html, text: "" });
  expect(await markdownMatching(withHost, /img\.example/)).toContain("![](https://img.example.com/up1.png)");
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
  expect(receiptSays(app, "文件字段名：file")).toBe(true);
  expect(receiptSays(app, "图片地址的位置：自动找")).toBe(true);
  await app.press("id:image-host-edit");
  await app.waitFor("id:image-host-header-names");
  await app.clear("label:文件字段名");
  await app.type("label:文件字段名", "image");
  await app.press("id:image-host-save");
  await app.waitFor("text:文件字段名：image");
  expect(receiptSays(app, "请求头：Authorization（值不显示）")).toBe(true);
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
  await app.press("id:settings-tab-storage");
  expect(receiptSays(app, "图床要连着本机网关才能用")).toBe(true);
  expect(app.shows("id:image-host")).toBe(false);
});
