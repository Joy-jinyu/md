/** 设置页：整页盖住应用（编辑页在下面留着）。宽屏左栏分类、右边内容；窄屏先列分类，点进去看一类。布局见 DESIGN.md「屏幕：设置」。 */
import { type JSX, keymap, Scroll, signal, Text, untracked, View, type ViewRef, windowSize } from "nsh";
import { Button as BaseButton, Dialog } from "nsh/base";
import { IN_BROWSER } from "../../platform";
import type { ShortcutOverrides } from "../../store/settings";
import { Icon } from "../../ui/icon";
import { currentOverrides, sanitize } from "../editor/keybindings";
import { returnFocusToEditor } from "../editor/ui-state";
import { GatewayPanel } from "./GatewayPanel";
import { ImageHostPanel } from "./ImageHostPanel";
import { settingsOpen, settingsPage } from "./open";
import { type Section, SECTIONS, type SectionId, sectionOf } from "./sections";
import { createShortcutEditor, type ShortcutEditor, ShortcutsPanel } from "./ShortcutsPanel";
import { StoragePanel } from "./StoragePanel";
import { SyncPanel } from "./SyncPanel";

/** 窄于这个宽度不并排，改成两层（DESIGN.md「屏幕：设置」）。 */
const NARROW = 640;

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * 没在录键时 Esc 回到编辑页。走应用级 keymap（最新的绑定先跑），不靠 Dialog 自己的 closeOnEscape：
 * macOS 窗口里从 Cmd+, 或菜单打开时焦点还在编辑器里，第一下 Esc 被编辑器接走，要按两下才关（2026-11-25 用户实测）。
 * 录键时由 KeyRecorder 的 Esc 绑定取消录键。
 */
function EscapeCloses(props: { onEscape: () => void }) {
  keymap.bind("escape", props.onEscape, { when: "always" });
  return null;
}

/** 「‹ 返回」这类回上一层的按钮：主色字，左边一个箭头。 */
function BackButton(props: { testID: string; label: string; accessibilityLabel: string; autoFocus?: boolean; onPress: () => void }) {
  return (
    <BaseButton
      testID={props.testID}
      ref={(node: ViewRef) => props.autoFocus && node.focus()}
      accessibilityLabel={props.accessibilityLabel}
      onPress={props.onPress}
      class={`min-h-9 shrink-0 flex-row items-center gap-1 rounded-(--radius) pl-1 pr-3 transition duration-180 ease-settle hover:bg-hover active:bg-pressed motion-reduce:transition-none ${FOCUS_RING}`}
    >
      <Icon name="chevronLeft" color="primary" />
      <Text class="text-[13px] text-primary">{props.label}</Text>
    </BaseButton>
  );
}

/** 宽屏左栏的一项。当前项不只靠颜色：`selected` 让读屏报「已选中」，读屏名再加「（当前）」。 */
function NavItem(props: { section: Section; on: boolean; autoFocus: boolean; onPress: () => void }) {
  return (
    <BaseButton
      testID={`settings-tab-${props.section.id}`}
      ref={(node: ViewRef) => props.autoFocus && node.focus()}
      selected={props.on}
      accessibilityLabel={props.on ? `${props.section.title}（当前）` : props.section.title}
      onPress={props.onPress}
      class={`min-h-9 flex-row items-center gap-3 rounded-(--radius) px-3 transition duration-180 ease-settle hover:bg-hover active:bg-pressed selected:bg-pressed motion-reduce:transition-none ${FOCUS_RING}`}
    >
      <Icon name={props.section.icon} color={props.on ? "primary" : "muted-foreground"} />
      <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 text-[13px]" classList={{ "font-medium text-strong": props.on, "text-muted-foreground": !props.on }}>
        {props.section.title}
      </Text>
    </BaseButton>
  );
}

/** 窄屏第一层的一行：点了进这一类。 */
function ListRow(props: { section: Section; autoFocus: boolean; onPress: () => void }) {
  return (
    <BaseButton
      testID={`settings-tab-${props.section.id}`}
      ref={(node: ViewRef) => props.autoFocus && node.focus()}
      accessibilityLabel={props.section.title}
      onPress={props.onPress}
      class="min-h-12 flex-row items-center gap-3 border-b border-border px-4 hover:bg-hover active:bg-pressed focus-visible:bg-pressed"
    >
      <Icon name={props.section.icon} color="muted-foreground" />
      <Text class="min-w-0 flex-1 text-[13px] text-foreground">{props.section.title}</Text>
      <Icon name="chevronRight" color="muted-foreground" />
    </BaseButton>
  );
}

/** 窄屏两层共用的顶栏：48 高，一行。 */
function NarrowHeader(props: { children: JSX.Element }) {
  return <View class="h-12 shrink-0 flex-row items-center gap-2 border-b border-border px-2">{props.children}</View>;
}

const Description = (props: { id: SectionId }) => <Text class="select-text text-[13px] leading-5 text-muted-foreground">{sectionOf(props.id).description}</Text>;

interface Layout {
  page: () => SectionId;
  show: (id: SectionId) => void;
  close: () => void;
  body: (id: SectionId) => JSX.Element;
  /** 打开时就在某一类（不是默认的快捷键）：焦点给左栏的当前项。 */
  focusCurrent: boolean;
}

function Wide(props: Layout) {
  return (
    <View class="flex-1 flex-row">
      <View role="navigation" accessibilityLabel="设置分类" class="w-56 shrink-0 gap-1 border-r border-border bg-card px-3 py-4">
        <View class="mb-2 flex-row">
          <BackButton testID="settings-done" label="返回" accessibilityLabel="返回编辑页" onPress={props.close} />
        </View>
        <Each of={SECTIONS} key={(s) => s.id}>
          {(s) => <NavItem section={s()} on={props.page() === s().id} autoFocus={props.focusCurrent && props.page() === s().id} onPress={() => props.show(s().id)} />}
        </Each>
      </View>
      <Scroll class="flex-1" contentClass="px-10 py-8">
        <View class="w-full max-w-[640px] gap-5">
          <View class="gap-1">
            <Text role="header" class="text-xl font-semibold text-strong">
              {sectionOf(props.page()).title}
            </Text>
            <Description id={props.page()} />
          </View>
          {props.body(props.page())}
        </View>
      </Scroll>
    </View>
  );
}

function Narrow(props: Layout & { listing: () => boolean; toList: () => void }) {
  return (
    <If
      when={props.listing()}
      else={
        <View class="flex-1">
          <NarrowHeader>
            <BackButton testID="settings-to-list" label="设置" accessibilityLabel="返回设置列表" autoFocus onPress={props.toList} />
            <Text role="header" style={{ numberOfLines: 1 }} class="min-w-0 flex-1 text-[15px] font-semibold text-strong">
              {sectionOf(props.page()).title}
            </Text>
          </NarrowHeader>
          <Scroll class="flex-1" contentClass="px-4 py-4">
            <View class="gap-5">
              <Description id={props.page()} />
              {props.body(props.page())}
            </View>
          </Scroll>
        </View>
      }
    >
      <View class="flex-1">
        <NarrowHeader>
          <BackButton testID="settings-done" label="返回" accessibilityLabel="返回编辑页" onPress={props.close} />
          <Text role="header" class="text-[15px] font-semibold text-strong">
            设置
          </Text>
        </NarrowHeader>
        <Scroll class="flex-1">
          <Each of={SECTIONS} key={(s) => s.id}>
            {(s) => <ListRow section={s()} autoFocus={props.page() === s().id} onPress={() => props.show(s().id)} />}
          </Each>
        </Scroll>
      </View>
    </If>
  );
}

/** 每一类的内容。`focusSearch`：打开时在快捷键页，焦点给搜索框；只给一次，之后从左栏切回快捷键不抢走左栏的焦点。 */
function sectionBodies(ed: ShortcutEditor, show: (id: SectionId) => void, focusSearch: boolean) {
  let searchFocus = focusSearch;
  const goGateway = () => show("gateway");
  return (id: SectionId): JSX.Element => {
    switch (id) {
      case "shortcuts": {
        const focus = searchFocus;
        searchFocus = false;
        return <ShortcutsPanel editor={ed} autoFocus={focus} />;
      }
      case "storage":
        return <StoragePanel inBrowser={IN_BROWSER} onGoGateway={goGateway} />;
      case "gateway":
        return <GatewayPanel />;
      case "image-host":
        return <ImageHostPanel onGoGateway={IN_BROWSER ? goGateway : undefined} />;
      case "sync":
        return <SyncPanel />;
    }
  };
}

/** 开着的设置页：每打开一次建一份（改键草稿、当前分类都从头来）。 */
function SettingsPage(props: { onApply: (next: ShortcutOverrides) => void }) {
  const ed = createShortcutEditor();
  ed.open();
  const wanted = untracked(settingsPage);
  settingsPage.set(null);
  const page = signal<SectionId>(wanted ?? "shortcuts");
  const listing = signal(wanted === null);
  const narrow = () => windowSize().width < NARROW;
  const show = (id: SectionId) => {
    page.set(id);
    listing.set(false);
  };
  const close = () => {
    if (!settingsOpen()) return;
    const next = sanitize(ed.draft());
    const changed = JSON.stringify(next) !== JSON.stringify(currentOverrides());
    settingsOpen.set(false);
    returnFocusToEditor();
    if (changed) props.onApply(next);
  };
  const body = sectionBodies(ed, show, wanted === null && !untracked(narrow));
  const layout: Layout = { page, show, close, body, focusCurrent: wanted !== null };
  return (
    <Dialog
      testID="settings"
      open
      animation="none"
      accessibilityLabel="设置"
      closeOnEscape={ed.recording() === null}
      onOpenChange={({ open }) => !open && close()}
      class="h-full w-full bg-background"
    >
      <If when={ed.recording() === null}>
        <EscapeCloses onEscape={close} />
      </If>
      <If when={narrow()} else={<Wide {...layout} />}>
        <Narrow {...layout} listing={listing} toList={() => listing.set(true)} />
      </If>
    </Dialog>
  );
}

/** `onApply`：回到编辑页时键有变化才调，交出整理过的改动。 */
export function SettingsScreen(props: { onApply: (next: ShortcutOverrides) => void }) {
  return (
    <If when={settingsOpen()}>
      <SettingsPage onApply={props.onApply} />
    </If>
  );
}
