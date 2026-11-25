import { expect, open, test } from "nsh/test";
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
  const entries = (title: string) => (menu.find((m) => m.label === title)?.submenu ?? []).map((i) => (i.type === "separator" ? "—" : `${i.label ?? i.role}${i.shortcut ? ` ${i.shortcut}` : ""}`));
  return { app, entries };
}

test("the macOS menu bar has File, Edit and View menus with the commands' current keys", async () => {
  const { entries } = await openWithMenu({ [SETTINGS_KEY]: JSON.stringify({ shortcuts: { "view.focus": "Mod-Alt-j" } }) });
  expect(entries("文件")).toEqual(["新建文档 mod+alt+n", "打开文件… mod+o", "另存为… mod+shift+s", "导出为 HTML…", "快速打开… mod+shift+o"]);
  expect(entries("编辑")).toEqual(["undo", "redo", "—", "cut", "copy", "paste", "selectAll"]);
  expect(entries("视图")).toEqual(["源码视图 mod+alt+/", "专注模式 mod+alt+j", "打字机模式 f9", "大纲 mod+shift+l", "设置（快捷键） mod+,"]);
});
