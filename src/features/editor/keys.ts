/** 命令表里的键怎么接到应用上：编辑器里由插件截，编辑器外由 keymap 绑；两条路走同一个出口。 */
import { keymap } from "nsh";
import { showWindow } from "../../platform";
import { installAppMenu } from "./app-menu";
import { type AppCommand, type CommandContext, COMMANDS, isViewCommand } from "./commands";
import { keyOf } from "./keybindings";

/** 现在有键、但不是纯编辑器命令的那些：要 JS 来处理。键取现在的设置，所以每次现算。 */
const jsCommands = () => COMMANDS.filter((c) => keyOf(c) && !c.rich);

/** 交给编辑器插件截下来的键（ProseMirror 写法）。 */
export const capturedKeys = () => jsCommands().map((c) => keyOf(c) as string);

export const commandForKey = (key: string): AppCommand | undefined => jsCommands().find((c) => keyOf(c) === key);

/** ProseMirror 的键名（`Mod-Shift-p`、`Mod--`）换成 keymap 的写法（`mod+shift+p`、`mod+-`）。 */
export function toKeymapName(key: string): string {
  const minus = key.endsWith("--");
  const parts = (minus ? key.slice(0, -2) : key).split("-");
  return [...parts, ...(minus ? ["-"] : [])].map((p) => p.toLowerCase()).join("+");
}

/**
 * 同一次按键两条路都报上来时只算一次（按命令和时间去重）。
 * web host 实测不会重复（编辑器有焦点时 keymap 收不到 Cmd 组合键）；macOS host 没法验证，留着这道保险。
 * 40ms 比系统最快的按键重复间隔短，不会吞掉连按。
 */
const SAME_KEY_WINDOW = 40;

export function once(run: (c: AppCommand) => void): (c: AppCommand) => void {
  let lastId = "";
  let lastAt = 0;
  return (c) => {
    const now = Date.now();
    if (c.id === lastId && now - lastAt < SAME_KEY_WINDOW) return;
    lastId = c.id;
    lastAt = now;
    run(c);
  };
}

/**
 * 焦点不在所见即所得编辑器里时（源码视图、查找框、页面空白处）也要生效的键。在组件渲染时调用，随组件卸载解绑。macOS 的菜单栏也在这时按现在的键重建。
 * macOS 关窗后窗口只是藏着，这些键照样收得到（无头测试里是这样，真窗口里由菜单栏接，见 platform 的 `setMenuBar`）：先把窗口显示出来再做。
 */
export function bindViewKeys(run: (c: AppCommand) => void, ctx: CommandContext) {
  installAppMenu(run, ctx);
  for (const c of jsCommands().filter(isViewCommand)) {
    try {
      keymap.bind(
        toKeymapName(keyOf(c) as string),
        () => {
          showWindow();
          run(c);
        },
        { when: "always" },
      );
    } catch (e) {
      // 平台不让绑的键（或设置里混进来的坏键名）只丢这一条，不能让整个编辑页渲染不出来
      console.error("shortcut not bound", c.id, keyOf(c), e);
    }
  }
}
