/**
 * 左侧栏：顶上一行切换「文档」「大纲」、打开搜索。窗口宽度不到 720 时是从左边滑进来的抽屉（Sheet：遮罩淡入、面板滑入，关时反向；点遮罩、Esc 或选了一项就收起），720 及以上并排。
 * 开没开、在哪一页存在 `ui-state.ts` 的 `sidebar` 里，切文档时编辑页重建，侧栏照旧。
 */
import { cleanup, type InputRef, type JSX, Text, View, type ViewRef, windowSize } from "nsh";
import { Input, Sheet } from "nsh/base";
import { t } from "../../i18n";
import { DocumentsPanel } from "../library/DocumentsPanel";
import { closeSearch, openSearch, panel, registerSearchField, setQuery, sidebarToolsHidden } from "../library/panel-state";
import { IconButton } from "../../ui/icon-button";
import { SIDE_PAD, SIDE_TEXT } from "./sidebar-style";
import { sidebar } from "./ui-state";

/**
 * 窗口比这窄时，侧栏不再把正文挤到右边，而是盖在正文上面。
 * 取 720：侧栏 240 加上正文列至少要的 480；再窄的话并排时正文只剩一条缝（2026-11-25 用户反馈的截图就是这样）。
 */
const OVERLAY_BELOW = 720;

/** 顶部那一行的输入框：边框占 1，左右内边距 7，字落在内容线上。 */
const SEARCH_FIELD = "h-7 min-w-0 flex-1 rounded-(--radius-sm) border border-input bg-background px-[7px] text-[13px] text-foreground placeholder:text-faint focus:border-primary";

/** 顶部一行里的搜索框：挂上时登记「给我焦点」，由 `openSearch` 调，不靠 autoFocus。 */
function SearchField() {
  let input: InputRef | undefined;
  registerSearchField(() => input?.focus());
  cleanup(() => registerSearchField(null));
  return (
    <Input
      testID="doc-search"
      ref={(node) => { input = node; }}
      value={panel.query()}
      onChange={({ value }) => setQuery(value)}
      placeholder={t("搜索所有文档", "Search all documents")}
      accessibilityLabel={t("搜索所有文档的正文", "Search the contents of all documents")}
      autoCapitalize="none"
      autoCorrect={false}
      class={SEARCH_FIELD}
    />
  );
}

/**
 * 侧栏顶部一行（2026-11-28 用户定，照 Typora）：左边按钮在文档和大纲之间切换，中间是这一页的名字，右边搜索。
 * 搜索打开时中间换成搜索框（搜所有文档，结果在文档页），右边换成关闭。
 * `grab`：盖在正文上时，打开就把焦点移到切换按钮上：焦点留在被盖住的编辑器里的话，Esc 被编辑器吃掉，收不起侧栏（2026-11-25 web host 实测）。
 */
function SidebarHeader(props: { grab: boolean }) {
  const docs = () => sidebar.tab() === "docs";
  const switchTab = () => {
    if (docs()) closeSearch();
    sidebar.tab.set(docs() ? "outline" : "docs");
  };
  return (
    <View class={`h-10 flex-row items-center gap-1 ${SIDE_PAD}`}>
      <IconButton
        testID="sidebar-switch"
        ref={(node: ViewRef) => props.grab && node.focus()}
        icon={docs() ? "list" : "folder"}
        label={docs() ? t("切到大纲", "Show the outline") : t("切到文档", "Show the documents")}
        tooltip={docs() ? t("大纲", "Outline") : t("文档", "Documents")}
        compact
        onPress={switchTab}
      />
      <If when={panel.searchOpen()} else={
        <Text testID="sidebar-title" role="header" class="min-w-0 flex-1 text-center text-xs font-medium text-muted-foreground">
          {docs() ? t("文档", "Documents") : t("大纲", "Outline")}
        </Text>
      }>
        <SearchField />
      </If>
      <View
        testID="sidebar-search-slot"
        class="transition-opacity duration-180 ease-settle motion-reduce:transition-none"
        classList={{ "opacity-0": sidebarToolsHidden() && !panel.searchOpen() }}
        focusWithinStyle={{ opacity: 1 }}
      >
      <IconButton
        testID="sidebar-search"
        icon={panel.searchOpen() ? "close" : "search"}
        label={panel.searchOpen() ? t("关闭搜索", "Close search") : t("搜索所有文档", "Search all documents")}
        tooltip={panel.searchOpen() ? t("关闭搜索", "Close search") : t("搜索", "Search")}
        compact
        onPress={() => (panel.searchOpen() ? closeSearch() : openSearch())}
      />
      </View>
    </View>
  );
}

function Panel(props: { outline: () => JSX.Element; onPicked: () => void; overlay: boolean }) {
  // 指针还在侧栏里时被收起（快捷键、抽屉里选了一篇）不会有 onMouseLeave
  cleanup(() => panel.pointerInside.set(false));
  return (
    <View
      testID="sidebar"
      accessibilityLabel={t("侧栏", "Sidebar")}
      class="w-[240px] border-r border-border bg-card"
      onMouseEnter={() => panel.pointerInside.set(true)}
      onMouseLeave={() => panel.pointerInside.set(false)}
    >
      <SidebarHeader grab={props.overlay} />
      <If when={sidebar.tab() === "docs"} else={props.outline()}>
        <DocumentsPanel onPicked={props.onPicked} />
      </If>
    </View>
  );
}

/** 源码方式下没有大纲时，大纲页显示的一行字。 */
export function NoOutline() {
  return <Text class={`pt-1 ${SIDE_TEXT}`}>{t("源码方式下没有大纲", "The outline is unavailable in source mode")}</Text>;
}

/** 正文区连同左侧栏。`outline` 给大纲页的内容（选了一项以后调 `collapseIfOverlay`）。 */
export function WithSidebar(props: { outline: () => JSX.Element; children: JSX.Element }) {
  const overlays = () => windowSize().width < OVERLAY_BELOW;
  const collapse = () => overlays() && sidebar.open.set(false);
  return (
    <View class="flex-1 flex-row">
      <If when={sidebar.open() && !overlays()}>
        <Panel outline={props.outline} onPicked={collapse} overlay={false} />
      </If>
      {props.children}
      {/* 窄窗口：抽屉一直挂着、只切 open，收起时才有滑出的过渡 */}
      <If when={overlays()}>
        <Sheet
          open={sidebar.open()}
          side="left"
          accessibilityLabel={t("侧栏", "Sidebar")}
          onOpenChange={({ open }) => !open && sidebar.open.set(false)}
          backdropClass="bg-scrim"
          popupClass="flex-row shadow-lg"
        >
          <Panel outline={props.outline} onPicked={collapse} overlay />
        </Sheet>
      </If>
    </View>
  );
}

/** 盖在正文上时，选了大纲里的一项也要收起侧栏。 */
export function collapseIfOverlay() {
  if (windowSize().width < OVERLAY_BELOW) sidebar.open.set(false);
}
