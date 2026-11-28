/**
 * 编辑页顶栏。浏览器和 macOS 都在这一行放文档名、保存状态、字数和同步入口；macOS 这一行同时是标题栏。
 */
import { colorScheme, computed, Text, View, windowSize } from "nsh";
import { Button as BaseButton, Toolbar } from "nsh/base";
import { t } from "../../i18n";
import { bindDocumentWindowTitle, editorTitleBarArea, IS_MACOS } from "../../platform";
import { elsewhereWords } from "../../store/backend";
import { saveState } from "../../store/document";
import { openDisplayName } from "../../store/library";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/icon-button";
import { tip } from "../../ui/tooltip";
import { requestFile } from "../files/requests";
import { quickOpenOpen } from "../library/requests";
import { settingsOpen } from "../settings/open";
import { SyncButton } from "../sync/SyncButton";
import { toggleAppearance } from "./commands";
import { sidebar, toggleSidebar, type Ui } from "./ui-state";

/** 顶栏上的视图开关；只能用源码打开的文档没有这些。 */
export interface ViewToggles {
  ui: Ui;
  sourceOn: boolean;
  onToggleSource: () => void;
}

/** 窗口窄于这个宽度（pt）时顶栏让位给文档名和保存状态：字数不显示，同步入口只留图标和短状态（375 宽实测）。 */
const NARROW = 480;

/** 模式标签最窄多宽（pt）：窄屏上两个标签同时开着时挤一挤，字截成「专…」「打…」还认得出，不只剩一个 ×，也不把右边的按钮挤出窗口（375 宽实测）。 */
const CHIP_MIN_WIDTH = 56;

/** 正开着的模式：一个小标签，点它（或里面的 ×）退出。不开的时候不出现。 */
function ModeChip(props: { testID: string; label: string; onExit: () => void }) {
  return (
    <BaseButton
      testID={props.testID}
      onPress={props.onExit}
      style={{ minWidth: CHIP_MIN_WIDTH }}
      accessibilityLabel={t(`退出${props.label}`, `Exit ${props.label}`)}
      tooltip={tip(t(`退出${props.label}`, `Exit ${props.label}`))}
      class="h-6 min-w-0 shrink flex-row items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1.5 transition duration-180 ease-settle hover:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
    >
      <Text style={{ numberOfLines: 1 }} class="min-w-0 shrink text-[11px] font-medium text-primary">
        {props.label}
      </Text>
      <Icon name="close" size={12} color="muted-foreground" />
    </BaseButton>
  );
}

interface TopBarProps {
  title: string;
  counts: string;
  toggles?: ViewToggles;
}

function SidebarButton() {
  return <IconButton testID="toggle-sidebar" icon="sidebar" label={sidebar.open() ? t("收起侧栏", "Collapse sidebar") : t("展开侧栏（文档、大纲）", "Expand sidebar (documents and outline)")} active={sidebar.open()} onPress={() => toggleSidebar()} />;
}

function ModeChips(props: { toggles?: ViewToggles }) {
  return (
    <If when={props.toggles}>
      {(toggles) => (
        <>
          <If when={toggles().ui.focusOn() && !toggles().sourceOn}>
            <ModeChip testID="exit-focus" label={t("专注模式", "Focus Mode")} onExit={() => toggles().ui.focusOn.set(false)} />
          </If>
          <If when={toggles().ui.typewriterOn() && !toggles().sourceOn}>
            <ModeChip testID="exit-typewriter" label={t("打字机模式", "Typewriter Mode")} onExit={() => toggles().ui.typewriterOn.set(false)} />
          </If>
          <If when={!IS_MACOS && toggles().sourceOn}>
            <ModeChip testID="toggle-source" label={t("源码模式", "Source Mode")} onExit={toggles().onToggleSource} />
          </If>
        </>
      )}
    </If>
  );
}

function MacToolbar(props: TopBarProps) {
  const title = () => openDisplayName(props.title);
  bindDocumentWindowTitle(title);
  return (
    <>
      <View desktop={{ windowDrag: true }}>
        <Toolbar
          testID="macos-title-toolbar"
          accessibilityLabel={t("编辑工具栏", "Editor toolbar")}
          style={{ paddingLeft: editorTitleBarArea().left }}
          class="min-h-10 flex-row items-center gap-2 border-b border-border bg-card pr-3"
        >
          <SidebarButton />
          <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 text-sm font-semibold text-strong">
            {title()}
          </Text>
          <ModeChips toggles={props.toggles} />
          <SaveStatus />
          <If when={windowSize().width >= NARROW}>
            <Counts text={props.counts} />
          </If>
          <SyncButton compact={windowSize().width < NARROW} dense />
          <IconButton testID="toolbar-quick-open" icon="fileSearch" label={t("快速打开…", "Quick Open…")} compact onPress={() => quickOpenOpen.set(true)} />
          <If when={props.toggles}>
            {(toggles) => (
              <IconButton
                testID="toggle-source"
                icon="code"
                label={t("源码视图", "Source View")}
                tooltip={toggles().sourceOn ? t("回到所见即所得", "Back to rich text") : t("Markdown 源码", "Markdown source")}
                active={toggles().sourceOn}
                selected={toggles().sourceOn}
                compact
                onPress={toggles().onToggleSource}
              />
            )}
          </If>
        </Toolbar>
      </View>
    </>
  );
}

/** `title`：正文第一个标题（编辑器里最新的，没有是空串）。 */
export function TopBar(props: TopBarProps) {
  if (IS_MACOS) return <MacToolbar {...props} />;
  const narrow = () => windowSize().width < NARROW;
  return (
    <View class="min-h-11 flex-row items-center border-b border-border pl-3 pr-4" classList={{ "gap-3": !narrow(), "gap-2": narrow() }}>
      <SidebarButton />
      <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 pl-1 text-sm font-medium text-strong">
        {openDisplayName(props.title)}
      </Text>
      <ModeChips toggles={props.toggles} />
      <SaveStatus />
      <If when={!narrow()}>
        <Counts text={props.counts} />
      </If>
      <SyncButton compact={narrow()} />
      <View class="flex-row items-center gap-0.5">
        <IconButton testID="file-open" icon="folderOpen" label={t("打开文件", "Open File")} onPress={() => requestFile("open")} />
        <IconButton testID="file-save-as" icon="download" label={t("另存为", "Save As")} onPress={() => requestFile("saveAs")} />
        <IconButton testID="open-settings" icon="settings" label={t("设置", "Settings")} onPress={() => settingsOpen.set(true)} />
      </View>
      <AppearanceToggle />
    </View>
  );
}

function Counts(props: { text: string }) {
  return (
    <Text style={{ fontVariant: ["tabular-nums"], numberOfLines: 1 }} class="min-w-0 shrink text-xs text-muted-foreground">
      {props.text}
    </Text>
  );
}

/** 保存状态的文字；出错时写明原因，变成 destructive 色。 */
function SaveStatus() {
  const label = computed(() => {
    const s = saveState();
    switch (s.kind) {
      case "pending":
        return t("保存中…", "Saving…");
      case "saved":
        return t("已保存", "Saved");
      case "error":
        return s.error.quota ? t("本机存储已满，最近的修改没存上", "Local storage is full. Your latest changes were not saved.") : t(`没能保存：${s.error.detail}`, `Could not save: ${s.error.detail}`);
      case "conflict":
        return s.deleted ? t(`${elsewhereWords().deleted}，没有保存`, `${elsewhereWords().deleted}. Your changes were not saved.`) : t("和别处的修改冲突，没有保存", "A change elsewhere conflicts with yours. Your changes were not saved.");
      default:
        return "";
    }
  });
  const failed = () => saveState().kind === "error" || saveState().kind === "conflict";
  // 「已保存」「保存中…」不让别的挤没；出错时的长原因可以截断，不然会把右边的按钮挤出窗口
  return (
    <Text
      style={{ numberOfLines: 1 }}
      class="text-xs transition-colors duration-120 motion-reduce:transition-none"
      classList={{ "text-muted-foreground": !failed(), "text-destructive": failed(), "shrink-0": !failed(), "min-w-0 shrink": failed() }}
    >
      {label()}
    </Text>
  );
}

/**
 * 明暗切换（不记住，重开后跟随系统）：圆形图标按钮，样子照 pairwise.site 博客顶栏那个。
 * 图标是现在的外观（浅色时太阳、深色时月亮），两个叠在一起，切换时一个淡出转走、一个转进来。
 */
function AppearanceToggle() {
  const dark = () => colorScheme() === "dark";
  const GLYPH = "absolute transition duration-300 ease-settle motion-reduce:transition-none";
  const AWAY = "-rotate-90 scale-50 opacity-0";
  return (
    <BaseButton
      testID="toggle-appearance"
      accessibilityLabel={t(`切换到${dark() ? "浅色" : "深色"}外观`, `Switch to ${dark() ? "light" : "dark"} appearance`)}
      tooltip={tip(t("切换明暗主题", "Toggle light and dark appearance"))}
      onPress={toggleAppearance}
      class="size-[34px] items-center justify-center rounded-full border border-border-strong bg-secondary transition duration-180 ease-settle hover:border-primary active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      <View class={GLYPH} classList={{ [AWAY]: dark() }}>
        <Icon name="sun" />
      </View>
      <View class={GLYPH} classList={{ [AWAY]: !dark() }}>
        <Icon name="moon" />
      </View>
    </BaseButton>
  );
}
