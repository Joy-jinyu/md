/** 一条提示：浅底、小字。状态提示条（超大文档、读入失败）整条宽放在顶栏下；回执由 EditorScreen 包成浮在底部的卡片。 */
import { t } from "../i18n";
import { Text, View } from "nsh";
import { CopyButton } from "./copy-button";
import { IconButton } from "./icon-button";

/**
 * `tone`："warn"（默认）是要注意的事；"info" 是做完一件事的回执（存到哪了），安静一些。
 * `onDismiss`：给了就在右边放一个「×」让人关掉它（出错的回执不自己消失，见 DESIGN.md「回执」）。
 * `copyable`：右边多一个「复制」按钮，复制这条的字（出错的回执：原因要拿去查、去问）。
 */
export function Notice(props: { message: string; testID?: string; tone?: "warn" | "info"; copyable?: boolean; onDismiss?: () => void }) {
  const info = () => props.tone === "info";
  return (
    <View testID={props.testID} role="alert" class="flex-row items-center gap-2 pl-5" classList={{ "bg-warn-tint": !info(), "bg-secondary": info(), "pr-5": !props.onDismiss, "pr-2": !!props.onDismiss }}>
      <Text class="min-w-0 flex-1 select-text py-2 text-xs leading-5" classList={{ "text-warn": !info(), "text-muted-foreground": info() }}>
        {props.message}
      </Text>
      <If when={props.copyable}>
        <CopyButton testID={props.testID ? `${props.testID}-copy` : undefined} text={props.message} label={t("复制这条提示", "Copy this notice")} />
      </If>
      <If when={props.onDismiss}>{(dismiss) => <IconButton testID={props.testID ? `${props.testID}-dismiss` : undefined} icon="close" label={t("关掉这条提示", "Dismiss this notice")} onPress={dismiss()} />}</If>
    </View>
  );
}
