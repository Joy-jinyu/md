/**
 * 编辑页顶栏。左边：大纲开关、文档名；右边：保存状态、字数、打开 / 另存为 / 设置三个图标按钮、明暗切换。
 * 专注和源码两种模式平时不占位置（用快捷键或命令面板进），进去以后才在文档名后面出一个可以点掉的小标签。
 */
import { colorScheme, computed, type JSX, setColorScheme, Text, View } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { saveState } from "../../store/document";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/icon-button";
import { tip } from "../../ui/tooltip";
import { requestFile } from "../files/requests";
import { settingsOpen } from "../settings/open";
import { toggleOutline, type Ui } from "./ui-state";

/** 顶栏上的视图开关；只能用源码打开的文档没有这些。 */
export interface ViewToggles {
  ui: Ui;
  sourceOn: boolean;
  onToggleSource: () => void;
}

/** 正开着的模式：一个小标签，点它（或里面的 ×）退出。不开的时候不出现。 */
function ModeChip(props: { testID: string; label: string; onExit: () => void }) {
  return (
    <BaseButton
      testID={props.testID}
      onPress={props.onExit}
      accessibilityLabel={`退出${props.label}`}
      tooltip={tip(`退出${props.label}`)}
      class="h-6 flex-row items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1.5 transition duration-180 ease-settle hover:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
    >
      <Text style={{ numberOfLines: 1 }} class="text-[11px] font-medium text-primary">
        {props.label}
      </Text>
      <Icon name="close" size={12} color="muted-foreground" />
    </BaseButton>
  );
}

/** `context`：跟着光标所在位置出现的工具（表格工具条），排在文档名后面。 */
export function TopBar(props: { title: string; counts: string; toggles?: ViewToggles; context?: JSX.Element }) {
  return (
    <View class="min-h-11 flex-row items-center gap-3 border-b border-border pl-3 pr-4">
      <If when={props.toggles}>
        {(t) => (
          <If when={!t().sourceOn}>
            <IconButton testID="toggle-outline" icon="sidebar" label={t().ui.outlineOpen() ? "收起大纲" : "展开大纲"} active={t().ui.outlineOpen()} onPress={() => toggleOutline(t().ui)} />
          </If>
        )}
      </If>
      <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 pl-1 text-sm font-medium text-strong">
        {props.title || "未命名"}
      </Text>
      <If when={props.toggles}>
        {(t) => (
          <>
            <If when={t().ui.focusOn() && !t().sourceOn}>
              <ModeChip testID="exit-focus" label="专注模式" onExit={() => t().ui.focusOn.set(false)} />
            </If>
            <If when={t().sourceOn}>
              <ModeChip testID="toggle-source" label="源码模式" onExit={t().onToggleSource} />
            </If>
          </>
        )}
      </If>
      {props.context}
      <SaveStatus />
      <Text style={{ fontVariant: ["tabular-nums"], numberOfLines: 1 }} class="shrink text-xs text-muted-foreground">
        {props.counts}
      </Text>
      <View class="flex-row items-center gap-0.5">
        <IconButton testID="file-open" icon="folderOpen" label="打开文件" onPress={() => requestFile("open")} />
        <IconButton testID="file-save-as" icon="download" label="另存为" onPress={() => requestFile("saveAs")} />
        <IconButton testID="open-settings" icon="settings" label="设置" onPress={() => settingsOpen.set(true)} />
      </View>
      <AppearanceToggle />
    </View>
  );
}

/** 保存状态的文字；出错时写明原因，变成 destructive 色。 */
function SaveStatus() {
  const label = computed(() => {
    const s = saveState();
    switch (s.kind) {
      case "pending":
        return "保存中…";
      case "saved":
        return "已保存";
      case "error":
        return s.error.quota ? "本机存储已满，最近的修改没存上" : `没能保存：${s.error.detail}`;
      default:
        return "";
    }
  });
  const failed = () => saveState().kind === "error";
  return (
    <Text
      style={{ numberOfLines: 1 }}
      class="min-w-0 shrink text-xs transition-colors duration-120 motion-reduce:transition-none"
      classList={{ "text-muted-foreground": !failed(), "text-destructive": failed() }}
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
      accessibilityLabel={`切换到${dark() ? "浅色" : "深色"}外观`}
      tooltip={tip("切换明暗主题")}
      onPress={() => setColorScheme(dark() ? "light" : "dark")}
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
