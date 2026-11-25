/** 斜杠菜单：在正文里打 `/` 弹出，接着打字过滤，上下键选，回车或 Tab 确定。 */
import { keymap, signal, Text, View, windowSize } from "nsh";
import { deleteRange, type RichEditorSession, setSuggestionOpen } from "nsh/base";
import { type AppCommand, filterCommands, SLASH_COMMANDS } from "./commands";
import { keyOf } from "./keybindings";
import { toKeymapName } from "./keys";
import { SLASH_KEY } from "./rich-session";

/** 菜单宽度。 */
const MENU_WIDTH = 240;

/** 一次最多显示几行，多的跟着选中项滚。 */
const VISIBLE_ROWS = 8;

/** `/` 前面紧挨着这些字符时不弹：网址（`http://`）、路径（`a/b`）、分数（`1/2`）里的斜杠不是在叫菜单。 */
const NOT_A_TRIGGER = /[A-Za-z0-9/:.]/;

function blocked(session: RichEditorSession, from: number): boolean {
  if (session.isActive("codeBlock")) return true;
  return from > 0 && NOT_A_TRIGGER.test(session.textBetween(from - 1, from, "\n"));
}

/** 斜杠菜单的状态。`sync` 在编辑器每次修订后调；`pick` 是选定一条命令后（`/xxx` 已删掉）要做的事。 */
export function createSlash(session: RichEditorSession, pick: (c: AppCommand) => void) {
  const items = signal<AppCommand[]>([]);
  const index = signal(0);
  let seenId: string | null | undefined;
  let seenQuery = "";
  let seenKeys = 0;

  const hide = () => {
    if (items().length > 0) items.set([]);
  };
  const choose = (c: AppCommand) => {
    const s = session.suggestion(SLASH_KEY);
    if (s?.active) session.run(deleteRange(s.range));
    hide();
    pick(c);
  };
  const sync = () => {
    const s = session.suggestion(SLASH_KEY);
    if (!s?.active) return hide();
    const query = s.query ?? "";
    const list = blocked(session, s.range.from) ? [] : filterCommands(SLASH_COMMANDS, query);
    if (list.length === 0) {
      // 没有可选的就把键还给编辑器，回车照常换行
      if (s.open) session.run(setSuggestionOpen(false, SLASH_KEY));
      return hide();
    }
    const fresh = s.decorationId !== seenId;
    let next = fresh || query !== seenQuery ? 0 : Math.min(index(), list.length - 1);
    if (fresh) seenKeys = s.keyCount;
    seenId = s.decorationId;
    seenQuery = query;
    if (s.keyCount !== seenKeys) {
      seenKeys = s.keyCount;
      if (s.lastKey === "ArrowDown") next = (next + 1) % list.length;
      else if (s.lastKey === "ArrowUp") next = (next - 1 + list.length) % list.length;
      else return choose(list[next]);
    }
    items.set(list);
    index.set(next);
  };
  return { items, index, sync, choose, isOpen: () => items().length > 0 };
}

export type SlashState = ReturnType<typeof createSlash>;

export function SlashMenu(props: { slash: SlashState }) {
  const s = props.slash;
  const start = () => Math.max(0, Math.min(s.index() - 3, s.items().length - VISIBLE_ROWS));
  const rows = () => s.items().slice(start(), start() + VISIBLE_ROWS);
  // 浮层按自己的中点对齐光标；外面套一个两倍宽、不接点击的空盒子，菜单靠右，左边就正好落在光标处。
  // 窗口放不下两倍宽时不套（宿主把浮层挪进窗口，菜单就贴着窗口左边），不然菜单右半截出了窗口
  const roomy = () => windowSize().width >= MENU_WIDTH * 2 + 32;
  return (
    <View style={{ pointerEvents: "box-none", width: roomy() ? MENU_WIDTH * 2 : MENU_WIDTH }} class="items-end">
      <View testID="slash-menu" accessibilityLabel="插入" style={{ width: MENU_WIDTH }} class="rounded-(--radius) border border-border bg-popover p-1 shadow-md">
        <Each of={rows()} key={(c) => c.id}>
          {(c) => (
            <View
              testID={`slash-${c().id}`}
              role="button"
              accessibilityLabel={c().label}
              onPress={() => s.choose(c())}
              class="h-[32px] flex-row items-center gap-2 rounded-(--radius-sm) px-2 hover:bg-hover"
              classList={{ "bg-hover": s.items()[s.index()]?.id === c().id }}
            >
              <View class="size-6 items-center justify-center rounded-(--radius-sm) bg-muted">
                <Text class="text-[11px] font-medium text-muted-foreground">{c().glyph ?? ""}</Text>
              </View>
              <Text class="flex-1 text-[13px] text-foreground">{c().label}</Text>
              <If when={keyOf(c())}>{(key) => <Text class="text-[11px] text-faint">{keymap.label(toKeymapName(key()))}</Text>}</If>
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}
