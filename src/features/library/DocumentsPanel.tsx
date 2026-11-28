/**
 * 侧栏的「文档」页：上面排序和新建；下面是文档列表，或者（侧栏顶部的搜索框有搜索词时）搜索结果。
 * macOS 从右键或「⋯」弹出系统菜单，网页用「⋯」展开行内操作。有鼠标时悬停这一行才出现（键盘移到它上面、展开着时也在）；
 * 触屏没有悬停，一直显示。
 */
import { t } from "../../i18n";
import { computed, effect, Scroll, Text, View } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { IS_MACOS } from "../../platform";
import { allDocs, displayName } from "../../store/library";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/icon-button";
import { tip } from "../../ui/tooltip";
import { SIDE_LIST, SIDE_PAD, SIDE_ROW, SIDE_TEXT } from "../editor/sidebar-style";
import { macFolders, macLibraryView, refreshMacFolders, restoreMacLibraryView, showMacLibraryMenu } from "./mac-library";
import { DocCards, LibraryTree, type ListActions, RIGHT_INSET } from "./LibraryRows";
import { openSearch, panel, sidebarToolsHidden } from "./panel-state";
import { requestLibrary } from "./requests";
import type { SearchResult } from "./search";

/** 排序按钮：图标 + 现在的排法，和工具行右边的「+」一样 28 高；图标落在内容线上（左内边距 8）。 */
function SortButton() {
  const byTime = () => panel.sort() === "time";
  const spoken = () => (byTime() ? t("现在按改动时间排，改成按名字排", "Sorted by last edit. Switch to sorting by name.") : t("现在按名字排，改成按改动时间排", "Sorted by name. Switch to sorting by last edit."));
  return (
    <BaseButton
      testID="doc-sort"
      accessibilityLabel={spoken()}
      tooltip={tip(spoken())}
      onPress={() => panel.sort.set(byTime() ? "name" : "time")}
      class="h-7 flex-row items-center gap-1 rounded-(--radius-sm) px-2 transition duration-180 ease-settle hover:bg-hover active:scale-[0.97] active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <Icon name="arrowUpDown" size={14} color="muted-foreground" />
      <Text class="text-xs font-medium text-foreground">{byTime() ? t("按改动时间", "Last edited") : t("按名字", "Name")}</Text>
    </BaseButton>
  );
}

/** `onPicked`：选了一篇（或一个搜索结果），盖在正文上的侧栏这时该收起。 */
export function DocumentsPanel(props: { onPicked: () => void }) {
  const focusSearch = openSearch;
  if (IS_MACOS) {
    restoreMacLibraryView();
    // 自动保存也会换掉 allDocs（改动时间、开头变了）；文件夹只在文档增删改名时才可能变，按 id 集合比
    const ids = computed(() => allDocs().map((doc) => doc.id).join("\n"));
    effect(() => {
      if (macLibraryView() !== "tree") return;
      ids();
      void refreshMacFolders();
    });
  }
  const searching = () => panel.query().trim() !== "";
  return (
    <View testID="documents" accessibilityLabel={t("文档", "Documents")} class="flex-1">
      <View class={`gap-1 pb-1 pt-1 ${SIDE_PAD}`}>
        <View
          class="flex-row items-center justify-between"
          onContextMenu={IS_MACOS ? ({ pagePosition }) => void showMacLibraryMenu({ folder: "", focusSearch }, pagePosition) : undefined}
        >
          <SortButton />
          <View
            testID="library-row-actions"
            class="flex-row items-center transition-opacity duration-180 ease-settle motion-reduce:transition-none"
            classList={{ "opacity-0": sidebarToolsHidden() }}
            focusWithinStyle={{ opacity: 1 }}
          >
            <If when={IS_MACOS}>
              <IconButton testID="library-actions" icon="ellipsis" label={t("文库操作", "Library actions")} compact onPress={() => void showMacLibraryMenu({ folder: "", focusSearch })} />
            </If>
            <IconButton testID="doc-new" icon="plus" label={t("新建文档", "New document")} compact class={RIGHT_INSET} onPress={() => requestLibrary({ kind: "create" })} />
          </View>
        </View>
      </View>
      <If when={searching()} else={<DocList onPicked={props.onPicked} focusSearch={focusSearch} />}>
        <SearchResults onPicked={props.onPicked} />
      </If>
    </View>
  );
}

function DocList(props: ListActions) {
  return (
    <Scroll class="flex-1">
      <If when={allDocs().length > 0 || (IS_MACOS && macFolders().length > 0)} else={<Text class={`pt-1 ${SIDE_TEXT}`}>{t("还没有文档。点「+」新建一篇。", "No documents yet. Select + to create one.")}</Text>}>
        <View class={SIDE_LIST}>
          <If when={IS_MACOS && macLibraryView() === "tree"} else={<DocCards {...props} />}>
            <LibraryTree {...props} />
          </If>
        </View>
      </If>
    </Scroll>
  );
}

function summary(found: { query: string; result: SearchResult } | null): string {
  if (!found) return t("正在搜索…", "Searching…");
  const { query, result } = found;
  if (result.hits.length === 0) return t(`没有找到「${query}」`, `No results for “${query}”`);
  return t(`${result.docs} 篇文档里找到${result.capped ? "（只列出前 100 处）" : ""}`, `Found in ${result.docs} ${result.docs === 1 ? "document" : "documents"}${result.capped ? " (showing the first 100 matches)" : ""}`);
}

function SearchResults(props: { onPicked: () => void }) {
  const titleOf = (id: string) => {
    const doc = allDocs().find((d) => d.id === id);
    return doc ? displayName(doc) || t("未命名", "Untitled") : t("（已删除）", "(Deleted)");
  };
  const done = () => {
    const s = panel.search();
    return s.kind === "done" ? s : null;
  };
  return (
    <View class="flex-1">
      <Text testID="search-status" class={`pt-1 ${SIDE_TEXT}`}>
        {summary(done())}
      </Text>
      <If when={done()}>
        {(found) => (
          <Scroll class="flex-1">
            <View class={SIDE_LIST}>
              <Each of={found().result.hits} key="index">
                {(hit, index) => (
                  <View
                    testID={`hit-${index()}`}
                    role="button"
                    accessibilityLabel={t(`${titleOf(hit().id)}：${hit().snippet}`, `${titleOf(hit().id)}: ${hit().snippet}`)}
                    onPress={() => {
                      requestLibrary({ kind: "open", id: hit().id, find: found().query });
                      props.onPicked();
                    }}
                    class={`gap-0.5 py-1.5 hover:bg-hover ${SIDE_ROW}`}
                  >
                    <Text style={{ numberOfLines: 1 }} class="text-[12px] font-medium leading-4 text-foreground">
                      {titleOf(hit().id)}
                    </Text>
                    <Text style={{ numberOfLines: 2 }} class="text-[12px] leading-4 text-subtle">
                      {hit().snippet}
                    </Text>
                  </View>
                )}
              </Each>
            </View>
          </Scroll>
        )}
      </If>
    </View>
  );
}
