/**
 * 左侧栏：顶上两页切换「文档」「大纲」。窗口宽度不到 720 时盖在正文上面（下面一层遮罩，点遮罩或选了一项就收起），720 及以上并排。
 * 开没开、在哪一页存在 `ui-state.ts` 的 `sidebar` 里，切文档时编辑页重建，侧栏照旧。
 */
import { type JSX, keymap, Text, View, type ViewRef, windowSize } from "nsh";
import { DocumentsPanel } from "../library/DocumentsPanel";
import { panel } from "../library/panel-state";
import { historyOpen, quickOpenOpen } from "../library/requests";
import { settingsOpen } from "../settings/open";
import { SIDE_PAD, SIDE_TEXT } from "./sidebar-style";
import { sidebar, type SidebarTab } from "./ui-state";

/**
 * 窗口比这窄时，侧栏不再把正文挤到右边，而是盖在正文上面。
 * 取 720：侧栏 240 加上正文列至少要的 480；再窄的话并排时正文只剩一条缝（2026-11-25 用户反馈的截图就是这样）。
 */
const OVERLAY_BELOW = 720;

/** `grab`：盖在正文上时，打开就把焦点移到选中的那页签上：焦点留在被盖住的编辑器里的话，Esc 被编辑器吃掉，收不起侧栏（2026-11-25 web host 实测）。 */
function TabButton(props: { tab: SidebarTab; label: string; grab: boolean }) {
  const on = () => sidebar.tab() === props.tab;
  return (
    <View
      ref={(node: ViewRef) => props.grab && on() && node.focus()}
      testID={`sidebar-tab-${props.tab}`}
      role="tab"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: on() }}
      onPress={() => sidebar.tab.set(props.tab)}
      class="h-7 flex-1 items-center justify-center rounded-(--radius-sm) active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      classList={{ "bg-pressed": on(), "hover:bg-hover": !on() }}
    >
      <Text class="text-xs" classList={{ "font-semibold text-strong": on(), "text-muted-foreground": !on() }}>
        {props.label}
      </Text>
    </View>
  );
}

function Panel(props: { outline: () => JSX.Element; onPicked: () => void; overlay: boolean }) {
  return (
    <View testID="sidebar" accessibilityLabel="侧栏" class="w-[240px] border-r border-border bg-card">
      <View role="tablist" class={`flex-row gap-1 pb-2 pt-2 ${SIDE_PAD}`}>
        <TabButton tab="docs" label="文档" grab={props.overlay} />
        <TabButton tab="outline" label="大纲" grab={props.overlay} />
      </View>
      <If when={sidebar.tab() === "docs"} else={props.outline()}>
        <DocumentsPanel onPicked={props.onPicked} />
      </If>
    </View>
  );
}

/** 侧栏上面又开了对话框：这时的 Esc 是关对话框的。 */
const dialogOpen = () => panel.renaming() !== null || panel.deleting() !== null || historyOpen() || quickOpenOpen() || settingsOpen();

/**
 * 侧栏盖在正文上时 Esc 收起它。单独成一个组件：绑定跟着遮罩出现和消失。
 * 对话框的 Esc 不走 keymap，这条绑定会先接到（2026-11-25 web host 实测重命名框里按 Esc 只收起了侧栏），所以放行按键、对话框开着时不收。
 */
function EscapeCollapses() {
  keymap.bind("escape", () => !dialogOpen() && sidebar.open.set(false), { when: "always", passThrough: true });
  return null;
}

/** 源码方式下没有大纲时，大纲页显示的一行字。 */
export function NoOutline() {
  return <Text class={`pt-1 ${SIDE_TEXT}`}>源码方式下没有大纲</Text>;
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
      {/* 窄窗口：侧栏盖在正文上。写在正文后面，画的时候才在上层 */}
      <If when={sidebar.open() && overlays()}>
        <EscapeCollapses />
        <View testID="sidebar-scrim" role="button" accessibilityLabel="收起侧栏" onPress={() => sidebar.open.set(false)} class="absolute inset-0 bg-scrim" />
        <View class="absolute bottom-0 left-0 top-0 flex-row shadow-lg">
          <Panel outline={props.outline} onPicked={collapse} overlay />
        </View>
      </If>
    </View>
  );
}

/** 盖在正文上时，选了大纲里的一项也要收起侧栏。 */
export function collapseIfOverlay() {
  if (windowSize().width < OVERLAY_BELOW) sidebar.open.set(false);
}
