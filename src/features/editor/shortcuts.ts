/** 格式类快捷键（实施计划 4.4，和 Typora 的 macOS 键位一致）。 */
import { defineExtension, markRule, type RichCommand, setMeta } from "nsh/base";
import { COMMANDS } from "./commands";
import { keyOf, shadowedDefaults } from "./keybindings";

/** 只靠编辑器命令就能完成的键，取自命令表和设置里改过的键；要 JS 处理的键见 `keys.ts`。 */
function bindings(): Record<string, RichCommand> {
  const own = COMMANDS.flatMap((c): [string, RichCommand][] => {
    const key = keyOf(c);
    return key && c.rich ? [[key, c.rich]] : [];
  });
  // 改走了的自带键绑一条什么都不做、但算「处理过了」的命令，后面 StarterKit 的绑定就轮不到
  const shadows = shadowedDefaults().map((key): [string, RichCommand] => [key, setMeta("mdKeyUnbound", true)]);
  return Object.fromEntries([...shadows, ...own]);
}

/**
 * StarterKit 自带的行内规则要求记号前面是行首或空格（nsh 0.6.0 实测），中文正文里词之间没有空格，
 * `中文**粗体**` 不会变粗。这里补一组不要求空格的规则。
 * 斜体不补：规则没法只看前一个字符而不吃掉它（Rust 正则没有后行断言），`*x*` 前面没空格时用 Mod-i。
 */
const INLINE_RULES = [
  markRule("\\*\\*([^*\\s](?:[^*]*[^*\\s])?)\\*\\*$", "bold"),
  markRule("~~([^~\\s](?:[^~]*[^~\\s])?)~~$", "strike"),
  markRule("==([^=\\s](?:[^=]*[^=\\s])?)==$", "highlight"),
];

/** 快捷键和补充输入规则的扩展：优先级高于 StarterKit，同一个键以这里为准。每建一个会话调一次，键表取当时的设置。 */
export function shortcutsExtension() {
  return defineExtension({
    name: "mdShortcuts",
    priority: 1000,
    addKeyboardShortcuts: bindings,
    addInputRules: () => INLINE_RULES,
  });
}
