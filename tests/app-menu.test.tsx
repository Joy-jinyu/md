import { expect, test } from "nsh/test";
import { open } from "./fixtures/chinese-open";
import { SETTINGS_KEY } from "../src/store/settings";
import { memoryFs } from "./fixtures/memory-fs";

type Item = { type?: string; label?: string; role?: string; shortcut?: string; submenu?: Item[] };

/** 应用交给菜单栏的菜单：换掉 nsh/desktop 的 Menu.setApplicationMenu，记下最后一次给的。 */
async function openWithMenu(storage: Record<string, string> = {}) {
  let menu: Item[] = [];
  const disk = memoryFs({ "Alpha.md": "# Alpha\n\nfirst doc\n" });
  const app = await open("../App.tsx", {
    platform: "macos",
    width: 1280,
    height: 860,
    storage,
    modules: { ...disk.modules, "nsh/desktop": { "Menu.setApplicationMenu": (items: Item[]) => void (menu = items) } },
  });
  await app.waitFor("text:first doc");
  const submenu = (title: string) => menu.find((m) => m.label === title)?.submenu ?? [];
  const entries = (title: string) => submenu(title).map((i) => (i.type === "separator" ? "—" : `${i.label ?? i.role}${i.shortcut ? ` ${i.shortcut}` : ""}`));
  const roles = (title: string) => submenu(title).flatMap((item) => item.role ?? []);
  return { app, entries, roles };
}

test("the macOS menu bar updates language without changing shortcuts or editing roles", async () => {
  const { app, entries, roles } = await openWithMenu({ [SETTINGS_KEY]: JSON.stringify({ shortcuts: { "view.focus": "Mod-Alt-j" } }) });
  expect(entries("文件")).toEqual(["新建文档 mod+alt+n", "打开文件… mod+o", "另存为… mod+shift+s", "导出为 HTML…", "快速打开… mod+shift+o"]);
  const editRoles = ["undo", "redo", "cut", "copy", "paste", "selectAll"];
  expect(entries("编辑")).toEqual(["撤销", "重做", "—", "剪切", "复制", "粘贴", "全选"]);
  expect(roles("编辑")).toEqual(editRoles);
  expect(entries("视图")).toEqual(["源码视图 mod+alt+/", "专注模式 mod+alt+j", "打字机模式 f9", "大纲 mod+shift+l", "设置（快捷键） mod+,"]);

  await app.press("id:open-settings");
  await app.press("id:settings-tab-language");
  await app.press("id:language-en");
  await app.waitFor("text:Choose the display language for the editor.");
  expect(entries("File")).toEqual(["New Document mod+alt+n", "Open File… mod+o", "Save As… mod+shift+s", "Export as HTML…", "Quick Open… mod+shift+o"]);
  expect(entries("Edit")).toEqual(["Undo", "Redo", "—", "Cut", "Copy", "Paste", "Select All"]);
  expect(roles("Edit")).toEqual(editRoles);
  expect(entries("View")).toEqual(["Source View mod+alt+/", "Focus Mode mod+alt+j", "Typewriter Mode f9", "Outline mod+shift+l", "Settings (Shortcuts) mod+,"]);
});
