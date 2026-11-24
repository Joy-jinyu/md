/** 顶栏下面的一条提示（超大文档、读入失败、文件存到哪了）：浅底、小字，整条宽。 */
import { Text, View } from "nsh";

/** `tone`："warn"（默认）是要注意的事；"info" 是做完一件事的回执（存到哪了），安静一些。 */
export function Notice(props: { message: string; testID?: string; tone?: "warn" | "info" }) {
  const info = () => props.tone === "info";
  return (
    <View testID={props.testID} role="alert" class="px-5 py-2" classList={{ "bg-warn-tint": !info(), "bg-secondary": info() }}>
      <Text class="text-xs leading-5" classList={{ "text-warn": !info(), "text-muted-foreground": info() }}>
        {props.message}
      </Text>
    </View>
  );
}
