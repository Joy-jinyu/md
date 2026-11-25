import { expect, open, test } from "nsh/test";
import { historyKey } from "../src/store/history";
import { syncRecordKey } from "../src/store/sync-store";
import { memoryFs } from "./fixtures/memory-fs";

/**
 * macOS 文库里 id 是文件路径：删掉一篇连着 Gist 的文档、再建一篇同名的，新的那篇落在同一个 id 上。
 * 它不能接着旧文档的版本历史，也不能被推进旧文档的 Gist（强制规则 3：同步不能静默覆盖）。
 */
const API = "https://api.github.com";
const FILES = "files";
const OLD = "# 旧文档\n\n很重要的旧内容\n";
const OLDER = "# 旧文档\n\n更旧的一版\n";
const AUTH = { "md.sync.auth": JSON.stringify({ token: "t", login: "joy" }) };

const gist = (id: string, fileName: string, text: string, version = "v1") => ({
  id,
  description: `[Pairdown] ${fileName.replace(/\.md$/, "")}`,
  updated_at: "2026-11-25T00:00:00Z",
  history: [{ version }],
  files: { [fileName]: { filename: fileName, content: text, truncated: false } },
});

test("deleting a synced document and making a new one with the same name: the old Gist is left alone, the deletion is listed to choose, and the new one has no history", async () => {
  const disk = memoryFs({ "未命名.md": OLD, "Other.md": "# Other\n\nother doc\n" });
  const posted: string[] = [];
  let created = 0;
  const app = await open("./fixtures/sync-app.tsx", {
    platform: "macos",
    width: 1280,
    height: 860,
    modules: disk.modules,
    storage: {
      ...AUTH,
      "md.lastOpened": "未命名.md",
      [historyKey("未命名.md", FILES)]: JSON.stringify([{ at: 5, text: OLDER }]),
      [syncRecordKey("未命名.md", FILES)]: JSON.stringify({ link: { gistId: "g1", fileName: "未命名.md", base: OLD, version: "v1", login: "joy", syncedAt: 1 } }),
    },
    network: {
      [`GET ${API}/user?fresh=*`]: { body: { login: "joy" } },
      [`GET ${API}/gists?per_page=100&page=1&fresh=*`]: { body: [gist("g1", "未命名.md", OLD)] },
      [`GET ${API}/gists/g1?fresh=*`]: { body: gist("g1", "未命名.md", OLD) },
      [`POST ${API}/gists`]: (req: { body?: string | null }) => {
        const body = req.body ?? "";
        posted.push(body);
        const [fileName, file] = Object.entries((JSON.parse(body) as { files: Record<string, { content: string }> }).files)[0];
        return { status: 201, body: gist(`new${++created}`, fileName, file.content) };
      },
    } as never,
  });
  await app.waitFor("text:很重要的旧内容");
  await app.press("id:toggle-sidebar");
  await app.waitFor("id:documents");
  await app.press("id:doc-more-未命名.md");
  await app.press("id:doc-delete");
  await app.press("id:delete-now");
  await app.waitFor("text:已删除「未命名」。");
  await app.press("id:doc-new");
  await app.waitUntil(() => Object.keys(disk.library()).includes("未命名.md"), { timeout: 5000 });
  await app.type("label:正文", "brand new unrelated");
  await app.waitUntil(() => String(disk.library()["未命名.md"]).includes("brand new"), { timeout: 5000 });

  await app.press("id:doc-more-未命名.md");
  await app.press("id:doc-history");
  await app.waitFor("id:history");
  expect(app.shows("id:history-empty")).toBe(true);
  expect(app.shows("text:更旧的一版")).toBe(false);
  await app.keyboard.press("escape");

  await app.press("id:sync-status");
  await app.waitFor("id:sync");
  await app.press("id:sync-now");
  await app.waitFor("text:2 篇还没上传过，勾选确认后才上传。1 件事要你选。");
  expect(posted).toEqual([]);
  await app.press("id:sync-upload-confirm");
  await app.waitFor("text:已上传 2 篇（私密 Gist）。");
  expect(app.requests().some((r) => r.method === "PATCH")).toBe(false);
  expect(posted.some((b) => b.includes("brand new unrelated"))).toBe(true);
  expect(app.shows("id:sync-issue-local-deleted:g1")).toBe(true);
  expect(app.shows("text:本机删了，GitHub 上还在。")).toBe(true);

  // 拉回本机：旧内容存成一篇新文档，连回原来的 Gist；以后不再问
  await app.press("id:sync-pull-back");
  await app.waitFor("text:已把「未命名 2」从 GitHub 拉回本机。");
  expect(disk.library()["未命名 2.md"]).toBe(OLD);
  expect(app.shows("id:sync-issue-local-deleted:g1")).toBe(false);
});
