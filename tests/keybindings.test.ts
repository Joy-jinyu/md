import { expect, test } from "nsh/test";
import { COMMANDS } from "../src/features/editor/commands";
import { canonical, conflictOf, fromKeymapName, keyOf, rejectReason, sanitize, shadowedDefaults } from "../src/features/editor/keybindings";
import { toKeymapName } from "../src/features/editor/keys";

const byId = (id: string) => COMMANDS.find((c) => c.id === id)!;

test("the same combination compares equal however it is written", () => {
  expect(canonical("Shift-Mod-B")).toBe(canonical("Mod-Shift-b"));
  expect(canonical("Mod--")).toBe("Mod--");
  expect(fromKeymapName("mod+shift+b")).toBe("Mod-Shift-b");
  expect(fromKeymapName("alt+f9")).toBe("Alt-F9");
  expect(fromKeymapName(toKeymapName("Mod--"))).toBe("Mod--");
  expect(fromKeymapName(toKeymapName("Mod-Shift-Backspace"))).toBe("Mod-Shift-Backspace");
});

test("an override replaces the default key, null removes it, and conflicts are found", () => {
  const bold = byId("format.bold");
  expect(keyOf(bold, {})).toBe("Mod-b");
  expect(keyOf(bold, { "format.bold": "Mod-Shift-b" })).toBe("Mod-Shift-b");
  expect(keyOf(bold, { "format.bold": null })).toBe(undefined);
  expect(conflictOf("Mod-i", "format.bold", {})?.id).toBe("format.italic");
  expect(conflictOf("Mod-i", "format.bold", { "format.italic": null })).toBe(undefined);
});

test("keys that type, move the caret or belong to the system are refused", () => {
  expect(rejectReason("b", true)).not.toBe(null);
  expect(rejectReason("Shift-b", true)).not.toBe(null);
  expect(rejectReason("Mod-ArrowLeft", true)).not.toBe(null);
  expect(rejectReason("Mod-c", true)).not.toBe(null);
  expect(rejectReason("Mod-Alt-k", true)).toBe(null);
  // 只带 Alt 或单按功能键：编辑命令不行（编辑器内核认不出），视图命令可以
  expect(rejectReason("F9", true)).not.toBe(null);
  expect(rejectReason("Alt-b", true)).not.toBe(null);
  expect(rejectReason("F9", false)).toBe(null);
  expect(rejectReason("Mod-/", false)).not.toBe(null);
  expect(rejectReason("Mod-Foo", false)).not.toBe(null);
});

test("stored overrides are cleaned: unknown commands, refused keys and defaults are dropped, a swap is kept", () => {
  expect(sanitize({ "no.such": "Mod-j", "format.bold": "Mod-c", "format.italic": "Mod-i", "block.task": null })).toEqual({});
  expect(sanitize({ "format.bold": "Mod-i", "format.italic": "Mod-b" })).toEqual({ "format.bold": "Mod-i", "format.italic": "Mod-b" });
  // 两条抢同一个键：表里靠后的那条退回默认
  expect(sanitize({ "format.bold": "Mod-j", "format.italic": "Mod-j" })).toEqual({ "format.bold": "Mod-j" });
  // 退回默认后又撞上别人，接着退，直到没有两条命令用同一个键
  expect(sanitize({ "format.bold": "Mod-i", "format.italic": "Mod-j", "format.underline": "Mod-j" })).toEqual({ "format.bold": "Mod-i", "format.italic": "Mod-j" });
  // 斜体的改动被拒以后回到默认的 Mod-i，和粗体的改动撞上：粗体也退回默认
  expect(sanitize({ "format.bold": "Mod-i", "format.italic": "Mod-c" })).toEqual({});
  expect(sanitize({ "view.find": "Mod-Foo", "format.bold": "mod-shift-b" })).toEqual({ "format.bold": "Mod-Shift-b" });
});

test("a built-in key is blocked only when nothing else took it over", () => {
  expect(shadowedDefaults({})).toEqual([]);
  expect(shadowedDefaults({ "format.bold": "Mod-Shift-b" })).toEqual(["Mod-b"]);
  expect(shadowedDefaults({ "format.bold": "Mod-Shift-b", "block.task": "Mod-b" })).toEqual([]);
  expect(shadowedDefaults({ "block.code": "Mod-Alt-k" })).toEqual(["Mod-Alt-c"]);
  // 表格的键在表格外要落到别的绑定上，不挡
  expect(shadowedDefaults({ "table.rowAfter": "Mod-Alt-j" })).toEqual([]);
});
