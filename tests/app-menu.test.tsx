import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { SETTINGS_KEY } from "../src/store/settings";
import { LIBRARY, memoryFs } from "./fixtures/memory-fs";

type Item = { type?: string; label?: string; role?: string; shortcut?: string; checked?: boolean; disabled?: boolean; onSelect?: () => void; submenu?: Item[] };

/** 应用交给菜单栏的菜单：换掉 nsh/desktop 的 Menu.setApplicationMenu，记下最后一次给的。 */
async function openWithMenu(storage: Record<string, string> = {}, doc = "# Alpha\n\nfirst doc\n") {
  let menu: Item[] = [];
  const disk = memoryFs({ "Alpha.md": doc });
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1280,
    height: 860,
    storage,
    modules: { ...disk.modules, "nsh/desktop": { "Menu.setApplicationMenu": (items: Item[]) => void (menu = items) } },
  });
  await app.waitFor("text:first doc");
  const titles = () => menu.map((m) => m.label);
  const submenu = (title: string) => menu.find((m) => m.label === title)?.submenu ?? [];
  const show = (i: Item) => (i.type === "separator" ? "—" : `${i.label ?? i.role}${i.shortcut ? ` ${i.shortcut}` : ""}${i.submenu ? " ▸" : ""}`);
  const entries = (title: string) => submenu(title).map(show);
  const roles = (title: string) => submenu(title).flatMap((item) => item.role ?? []);
  /** 按「菜单 > 子菜单 > 项」找一项。 */
  const item = (path: string) => {
    const [first, ...rest] = path.split(" > ");
    let list = submenu(first);
    let found: Item | undefined;
    for (const label of rest) {
      found = list.find((i) => i.label === label);
      list = found?.submenu ?? [];
    }
    if (!found) throw new Error(`no menu item ${path}`);
    return found;
  };
  /** 菜单的 onSelect 过不了测试桥（函数会丢），按菜单项上写的快捷键或命令面板走同一条命令。 */
  const press = async (keys: string) => {
    await app.keyboard.press(keys);
    await app.wait(100);
  };
  const palette = async (query: string) => {
    await app.keyboard.press("mod+shift+p");
    await app.waitFor("id:palette");
    await app.type("label:命令", query);
    await app.keyboard.press("enter");
    await app.waitUntil(() => !app.shows("id:palette"), { timeout: 3000 });
    await app.wait(100);
  };
  return { app, disk, titles, entries, roles, item, press, palette };
}

test("the macOS menu bar follows Typora's menus and updates language without changing shortcuts or editing roles", async () => {
  const { app, titles, entries, roles } = await openWithMenu({ [SETTINGS_KEY]: JSON.stringify({ shortcuts: { "view.focus": "Mod-Alt-j" } }) });
  expect(titles()).toEqual(["Pairdown", "文件", "编辑", "段落", "格式", "视图", "主题", "窗口", "帮助"]);
  expect(entries("Pairdown")).toEqual(["关于 Pairdown", "—", "设置… mod+,", "—", "隐藏 Pairdown", "隐藏其他", "全部显示", "—", "退出 Pairdown"]);
  expect(entries("文件")).toEqual([
    "新建文档 mod+alt+n",
    "在新窗口打开当前文档",
    "—",
    "打开文件… mod+o",
    "快速打开… mod+shift+o",
    "—",
    "将副本存到下载文件夹 mod+shift+s",
    "版本历史…",
    "—",
    "将 HTML 导出到下载文件夹",
    "—",
    "在访达中显示",
    "同步…",
    "—",
    "关闭窗口",
  ]);
  expect(roles("文件")).toEqual(["close"]);
  expect(entries("编辑")).toEqual(["撤销", "重做", "—", "剪切", "复制", "粘贴", "粘贴为纯文本 mod+shift+v", "复制为 Markdown mod+shift+c", "全选", "—", "选择 ▸", "查找 ▸", "—", "跳到文首", "跳到文末"]);
  expect(roles("编辑")).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
  expect(entries("段落").slice(0, 12)).toEqual(["标题 1 mod+1", "标题 2 mod+2", "标题 3 mod+3", "标题 4 mod+4", "标题 5 mod+5", "标题 6 mod+6", "—", "正文 mod+0", "—", "标题升一级 mod+plus", "标题降一级 mod+minus", "—"]);
  expect(entries("段落")).toContain("任务列表 mod+alt+x");
  expect(entries("段落")).toContain("分隔线 mod+alt+minus");
  expect(entries("段落")).toContain("脚注 mod+alt+r");
  expect(entries("段落")).toContain("YAML Front Matter");
  expect(entries("格式")).toEqual(["粗体 mod+b", "斜体 mod+i", "下划线 mod+u", "行内代码 mod+shift+`", "删除线 ctrl+shift+`", "高亮 mod+shift+h", "—", "行内公式", "链接 mod+k", "图片 ▸", "—", "清除格式 mod+\\"]);
  expect(entries("视图")).toEqual(["源码视图 mod+alt+/", "—", "侧栏", "大纲 mod+shift+l", "文章 ctrl+mod+2", "文件树 ctrl+mod+3", "搜索全部文档 mod+shift+f", "—", "专注模式 mod+alt+j", "打字机模式 f9", "—", "命令面板 mod+shift+p"]);
  expect(entries("主题")).toEqual(["跟随系统", "浅色", "深色"]);
  expect(roles("窗口")).toEqual(["minimize", "zoom", "toggleFullScreen"]);
  expect(entries("帮助")).toEqual(["Markdown 参考", "—", "Pairdown 网站", "更新日志", "反馈问题…", "—", "键盘快捷键"]);

  await app.keyboard.press("mod+,");
  await app.press("id:settings-tab-language");
  await app.press("id:language-en");
  await app.waitFor("text:Choose the display language for the editor.");
  expect(titles()).toEqual(["Pairdown", "File", "Edit", "Paragraph", "Format", "View", "Themes", "Window", "Help"]);
  expect(entries("Pairdown")).toContain("Settings… mod+,");
  expect(entries("Edit").slice(0, 8)).toEqual(["Undo", "Redo", "—", "Cut", "Copy", "Paste", "Paste as Plain Text mod+shift+v", "Copy as Markdown mod+shift+c"]);
  expect(roles("Edit")).toEqual(["undo", "redo", "cut", "copy", "paste", "selectAll"]);
  expect(entries("View")).toContain("Focus Mode mod+alt+j");
  expect(entries("Themes")).toEqual(["Use System Setting", "Light", "Dark"]);
});

test("menu items tick what is on and dim what cannot run in source view", async () => {
  const { app, item, press } = await openWithMenu();
  await app.press("text:first doc");
  expect(item("视图 > 专注模式").shortcut).toBe("f8");
  expect(item("视图 > 专注模式").checked).toBe(false);
  await press("f8");
  await app.waitUntil(() => item("视图 > 专注模式").checked === true, { timeout: 1000 });

  expect(item("视图 > 大纲").checked).toBe(false);
  await press("mod+shift+l");
  await app.waitFor("id:outline");
  expect(item("视图 > 大纲").checked).toBe(true);
  expect(item("视图 > 侧栏").checked).toBe(true);

  expect(item("视图 > 源码视图").checked).toBe(false);
  expect(item("格式 > 粗体").disabled).toBe(false);
  await press("mod+alt+/");
  await app.waitFor("id:source-editor");
  expect(item("视图 > 源码视图").checked).toBe(true);
  expect(item("格式 > 粗体").disabled).toBe(true);
  expect(item("编辑 > 查找 > 查找").disabled).toBe(false);
});

test("the Themes menu picks an appearance and ticks it", async () => {
  const { app, item, palette } = await openWithMenu();
  expect(item("主题 > 跟随系统").checked).toBe(true);
  await palette("深色");
  expect(item("主题 > 深色").checked).toBe(true);
  expect(item("主题 > 跟随系统").checked).toBe(false);
  await palette("浅色");
  expect(item("主题 > 浅色").checked).toBe(true);
});

test("Find Next and Find Previous step through the matches", async () => {
  const { app, item, press } = await openWithMenu({}, "# Alpha\n\nfirst doc\n\nfirst again\n\nfirst last\n");
  expect(item("编辑 > 查找 > 查找下一个").shortcut).toBe("mod+g");
  expect(item("编辑 > 查找 > 查找上一个").shortcut).toBe("mod+shift+g");
  await app.press("text:first doc");
  await press("mod+g");
  await app.waitFor("id:find-bar");
  await app.type("id:find-query", "first");
  await app.waitFor("text:3 处");
  // 第一下从光标处往后找，落在哪一处看光标；之后下一个、上一个各走一步
  const current = () => app.texts().find((x) => /^[123] \/ 3$/.test(x));
  await press("mod+g");
  await app.waitUntil(() => current() !== undefined, { timeout: 1000 });
  const first = current();
  await press("mod+g");
  await app.waitUntil(() => current() !== undefined && current() !== first, { timeout: 1000 });
  await press("mod+shift+g");
  await app.waitUntil(() => current() === first, { timeout: 1000 });
});

test("YAML Front Matter adds an empty block at the top once, and Footnote adds a reference and its definition", async () => {
  const { app, disk, palette, press } = await openWithMenu();
  const saved = () => String(disk.files.get(`${LIBRARY}/Alpha.md`) ?? "");
  await app.press("text:first doc");
  await palette("YAML");
  await app.waitUntil(() => saved().startsWith("---\n\n---\n\n# Alpha"), { timeout: 3000 });
  await palette("YAML");
  await app.wait(1200);
  expect(saved().match(/^---$/gm)?.length).toBe(2);

  await app.press("text:first doc");
  await app.keyboard.press("end");
  await press("mod+alt+r");
  await app.waitUntil(() => saved().includes("first doc[^1]") && saved().trimEnd().endsWith("[^1]:"), { timeout: 3000 });

  // 有选区时脚注插在选区末尾，选中的字不被替换
  await app.press(`text:first doc${String.fromCharCode(0xfffc)}`);
  await app.keyboard.press("home");
  await press("mod+d");
  await press("mod+alt+r");
  await app.waitUntil(() => saved().includes("first[^2] doc[^1]"), { timeout: 3000 });
});
