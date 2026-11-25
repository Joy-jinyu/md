/** 顶栏下面的一条提示（超大文档、读入失败、文件存到哪了）：浅底、小字，整条宽。 */
import { Text, View } from "nsh";
import { IconButton } from "./icon-button";

/**
 * `tone`："warn"（默认）是要注意的事；"info" 是做完一件事的回执（存到哪了），安静一些。
 * `onDismiss`：给了就在右边放一个「×」让人关掉它（出错的回执不自己消失，见 DESIGN.md「回执」）。
 */
export function Notice(props: { message: string; testID?: string; tone?: "warn" | "info"; onDismiss?: () => void }) {
  const info = () => props.tone === "info";
  return (
    <View testID={props.testID} role="alert" class="flex-row items-center gap-2 pl-5" classList={{ "bg-warn-tint": !info(), "bg-secondary": info(), "pr-5": !props.onDismiss, "pr-2": !!props.onDismiss }}>
      <Text class="min-w-0 flex-1 py-2 text-xs leading-5" classList={{ "text-warn": !info(), "text-muted-foreground": info() }}>
        {props.message}
      </Text>
      <If when={props.onDismiss}>{(dismiss) => <IconButton testID={props.testID ? `${props.testID}-dismiss` : undefined} icon="close" label="关掉这条提示" onPress={dismiss()} />}</If>
    </View>
  );
}
