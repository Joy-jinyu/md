/** 快速打开（Cmd+Shift+O）：按名字或标题模糊找一篇文档，回车打开。样子和命令面板一样。 */
import { signal, Text, View } from "nsh";
import { Command, Dialog } from "nsh/base";
import { allDocs, currentDocId, displayName, knownTitle } from "../../store/library";
import { registerTransient, returnFocusToEditor } from "../editor/ui-state";
import { rankDocs } from "./fuzzy";
import { timeLabel } from "./panel-state";
import { quickOpenOpen, requestLibrary } from "./requests";

export function QuickOpen() {
  const query = signal("");
  /** 先关，下一轮再打开选中的那篇（同命令面板：不等 Dialog 的 onClose，测试宿主里它不来）；没选就把焦点还给正文。 */
  const close = (then?: () => void) => {
    if (!quickOpenOpen()) return;
    quickOpenOpen.set(false);
    query.set("");
    if (then) setTimeout(then, 0);
    else returnFocusToEditor();
  };
  registerTransient(() => {
    const was = quickOpenOpen();
    if (was) {
      quickOpenOpen.set(false);
      query.set("");
    }
    return was;
  });
  const ranked = () => (quickOpenOpen() ? rankDocs(allDocs(), query(), currentDocId()) : []);
  const items = () => ranked().map((d) => ({ id: d.id, label: displayName(d) || "未命名", keywords: [d.name] }));
  const subtitle = (id: string) => {
    const doc = allDocs().find((d) => d.id === id);
    if (!doc) return "";
    const when = id === currentDocId() ? "正开着" : timeLabel(doc.updatedAt);
    // 名字和标题里不是大字显示的那个写在小字里：按它搜中了也看得出为什么
    const label = displayName(doc);
    const other = label === doc.name ? knownTitle(doc) : doc.name;
    return other && other !== label ? `${other} · ${when}` : when;
  };
  return (
    <Dialog
      testID="quick-open"
      open={quickOpenOpen()}
      animation="fade"
      accessibilityLabel="快速打开"
      closeOnEscape
      closeOnBackdropPress
      onOpenChange={({ open }) => !open && close()}
      backdropClass="bg-scrim"
      class="mx-auto mt-24 w-full max-w-[520px] px-4"
    >
      <View class="overflow-hidden rounded-(--radius) border border-border bg-popover">
        <Command
          items={items()}
          query={query()}
          onQueryChange={({ query: next }) => query.set(next)}
          filterable={false}
          autoFocus
          placeholder="按名字或标题找文档…"
          accessibilityLabel="文档"
          onSelect={({ id }) => close(() => requestLibrary({ kind: "open", id }))}
          onCancel={() => close()}
          searchBarClass="border-b border-border px-3"
          searchClass="h-10 text-[14px] text-foreground placeholder:text-faint"
          listClass="max-h-[360px] p-1"
          itemClass="min-h-[38px] flex-row items-center rounded-(--radius-sm) px-2 py-1 hover:bg-hover focus:bg-hover"
          renderItem={(entry) => (
            <View class="gap-0.5">
              <Text style={{ numberOfLines: 1 }} class="text-[13px] text-popover-foreground">
                {entry.label}
              </Text>
              <Text style={{ numberOfLines: 1 }} class="text-[11px] text-faint">
                {subtitle(entry.id)}
              </Text>
            </View>
          )}
          empty={<Text class="px-3 py-4 text-xs text-faint">没有匹配的文档</Text>}
        />
      </View>
    </Dialog>
  );
}
