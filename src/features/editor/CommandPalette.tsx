/** 命令面板（Cmd+Shift+P）：所有现在能用的命令，加上跳到某个标题。 */
import { Text, untracked, View } from "nsh";
import { Command, type CommandItem, Dialog } from "nsh/base";
import { type AppCommand, available, type CommandContext, COMMANDS } from "./commands";
import { keyOf } from "./keybindings";
import { toKeymapName } from "./keys";
import type { HeadingEntry } from "./outline";

const HEADING_PREFIX = "heading:";

function items(ctx: CommandContext, headings: HeadingEntry[]): CommandItem[] {
  const commands = COMMANDS.filter((c) => c.id !== "view.palette" && available(c, ctx)).map((c) => ({
    id: c.id,
    label: c.label,
    keywords: c.keywords,
    group: c.group,
    shortcut: keyOf(c) ? toKeymapName(keyOf(c) as string) : null,
  }));
  const jumps = headings.map((h, i) => ({ id: `${HEADING_PREFIX}${i}`, label: h.text || "（空标题）", group: "标题" }));
  return [...commands, ...jumps];
}

/**
 * `headings` 在面板打开时取一次。关面板的每条路都走 `close`：先关，下一轮再执行选中的命令或者把焦点还回去。
 * 不等 Dialog 的 onClose：测试宿主里它不来（2026-11-24 实测）。
 */
export function CommandPalette(props: {
  ctx: CommandContext;
  headings: () => HeadingEntry[];
  run: (c: AppCommand) => void;
  onJump: (h: HeadingEntry) => void;
  onClose: () => void;
}) {
  const open = props.ctx.ui.paletteOpen;
  const close = (then: () => void = props.onClose) => {
    if (!open()) return;
    open.set(false);
    setTimeout(then, 0);
  };
  let headings: HeadingEntry[] = [];
  const list = () => {
    if (!open()) return [];
    headings = untracked(props.headings);
    return items(props.ctx, headings);
  };
  const select = (id: string) => {
    if (id.startsWith(HEADING_PREFIX)) {
      const h = headings[Number(id.slice(HEADING_PREFIX.length))];
      close(() => h && props.onJump(h));
    } else {
      const c = COMMANDS.find((x) => x.id === id);
      close(() => c && props.run(c));
    }
  };
  return (
    <Dialog
      testID="palette"
      open={open()}
      animation="fade"
      accessibilityLabel="命令面板"
      closeOnEscape
      closeOnBackdropPress
      onOpenChange={({ open: next }) => !next && close()}
      backdropClass="bg-scrim"
      class="mx-auto mt-24 w-full max-w-[520px] px-4"
    >
      <View class="overflow-hidden rounded-(--radius) border border-border bg-popover">
        <Command
          items={list()}
          autoFocus
          placeholder="输入命令或标题…"
          accessibilityLabel="命令"
          onSelect={({ id }) => select(id)}
          onCancel={() => close()}
          searchBarClass="border-b border-border px-3"
          searchClass="h-10 text-[14px] text-foreground placeholder:text-faint"
          listClass="max-h-[360px] p-1"
          itemClass="h-[30px] flex-row items-center justify-between rounded-(--radius-sm) px-2 hover:bg-hover focus:bg-hover"
          groupClass="px-2 pb-1 pt-2 text-[11px] text-faint"
          separatorClass="my-1 h-px bg-border"
          // 快捷键没法靠右：宿主把 renderItem 包在按内容定宽的盒子里，撑不满整行（web host 2026-11-24 实测）
          renderItem={(entry) => (
            <View class="flex-row items-center gap-3">
              <Text class="text-[13px] text-popover-foreground">{entry.label}</Text>
              <If when={entry.shortcutLabel}>{(label) => <Text class="text-[11px] text-faint">{label()}</Text>}</If>
            </View>
          )}
          empty={<Text class="px-3 py-4 text-xs text-faint">没有匹配的命令</Text>}
        />
      </View>
    </Dialog>
  );
}
