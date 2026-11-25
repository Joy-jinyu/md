/** emoji 补全：在行首或空白后打 `:` 再打两个以上字母时弹出，上下键选，回车或 Tab 插入 emoji 字符本身。 */
import { signal, Text, View, windowSize } from "nsh";
import { chain, deleteRange, insertText, type RichEditorSession, setSuggestionOpen } from "nsh/base";
import { type EmojiItem, matchEmoji } from "./emoji";
import { EMOJI_KEY } from "./rich-session";

/** 短名里能有的字符；至少两个才弹。 */
const QUERY = /^[a-z0-9_+-]{2,}$/i;

/**
 * `:` 只有在行首或空白后面才算在叫补全：时间（`10:30`）、网址（`http://`）、`a:b`、中文后面紧跟的半角冒号（`注意:ok`）都不弹。
 * 全角冒号本来就不触发。
 */
function triggerAt(session: RichEditorSession, from: number): boolean {
  if (from === 0) return true;
  const before = session.textBetween(from - 1, from, "\n");
  return before === "" || /\s/.test(before);
}

function usable(session: RichEditorSession, from: number, query: string): boolean {
  if (!QUERY.test(query)) return false;
  if (session.isActive("codeBlock") || session.isActive("code")) return false;
  return triggerAt(session, from);
}

export function createEmoji(session: RichEditorSession) {
  const items = signal<EmojiItem[]>([]);
  const index = signal(0);
  let seenId: string | null | undefined;
  let seenQuery = "";
  let seenKeys = 0;

  const hide = () => {
    if (items().length > 0) items.set([]);
  };
  const choose = (item: EmojiItem) => {
    const s = session.suggestion(EMOJI_KEY);
    hide();
    if (s?.active) session.run(chain([deleteRange(s.range), insertText(item.emoji)]));
    session.focus();
  };
  /** 编辑器每次修订后调。 */
  const sync = () => {
    const s = session.suggestion(EMOJI_KEY);
    if (!s?.active) return hide();
    const query = s.query ?? "";
    const list = usable(session, s.range.from, query) ? matchEmoji(query) : [];
    if (list.length === 0) {
      // 没有可选的就把键还给编辑器，回车照常换行
      if (s.open) session.run(setSuggestionOpen(false, EMOJI_KEY));
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
    if (!s.open) session.run(setSuggestionOpen(true, EMOJI_KEY));
    items.set(list);
    index.set(next);
  };
  return { items, index, sync, choose, isOpen: () => items().length > 0 };
}

export type EmojiState = ReturnType<typeof createEmoji>;

/** 菜单宽度。 */
const MENU_WIDTH = 220;

export function EmojiMenu(props: { emoji: EmojiState }) {
  const e = props.emoji;
  // 和斜杠菜单一样：浮层按中点对齐光标，套一个两倍宽的空盒子让菜单左边落在光标处；
  // 窗口放不下两倍宽时不套（宿主把浮层挪进窗口，菜单就贴着窗口左边），不然菜单右半截出了窗口
  const roomy = () => windowSize().width >= MENU_WIDTH * 2 + 32;
  return (
    <View style={{ pointerEvents: "box-none", width: roomy() ? MENU_WIDTH * 2 : MENU_WIDTH }} class="items-end">
      <View testID="emoji-menu" accessibilityLabel="插入 emoji" style={{ width: MENU_WIDTH }} class="rounded-(--radius) border border-border bg-popover p-1 shadow-md">
        <Each of={e.items()} key={(item) => item.name}>
          {(item) => (
            <View
              testID={`emoji-${item().name}`}
              role="button"
              accessibilityLabel={`${item().emoji} ${item().name}`}
              onPress={() => e.choose(item())}
              class="h-[30px] flex-row items-center gap-2 rounded-(--radius-sm) px-2 hover:bg-hover"
              classList={{ "bg-hover": e.items()[e.index()]?.name === item().name }}
            >
              <Text class="w-6 text-center text-[16px]">{item().emoji}</Text>
              <Text style={{ numberOfLines: 1 }} class="flex-1 text-[13px] text-foreground">{`:${item().name}:`}</Text>
            </View>
          )}
        </Each>
      </View>
    </View>
  );
}
