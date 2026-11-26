/** 「复制」图标按钮：放在一眼就是拿去用的字旁边（命令、设备码、报错原因），点了写进剪贴板，右边短暂写「已复制」。规则见 DESIGN.md「文字可选、可复制」。 */
import { t } from "../i18n";
import { cleanup, signal, Text, View } from "nsh";
import { writeClipboard } from "./clipboard";
import { IconButton } from "./icon-button";

/** 「已复制」留多久（毫秒），和代码块的复制按钮一样。 */
const COPIED_MS = 1500;

/** `label`：读屏名和悬停提示，说复制的是什么（「复制启动命令」）。 */
export function CopyButton(props: { text: string; label: string; testID?: string }) {
  const state = signal<"idle" | "copied" | "failed">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => clearTimeout(timer));
  const copy = () => {
    clearTimeout(timer);
    writeClipboard(props.text).then(
      () => {
        state.set("copied");
        timer = setTimeout(() => state.set("idle"), COPIED_MS);
      },
      // 写不进去（浏览器不让写）时不自己消失：字本身可以选中再按复制键
      (e: unknown) => {
        console.warn("copy failed", e);
        state.set("failed");
      },
    );
  };
  return (
    <View class="shrink-0 flex-row items-center gap-1">
      <IconButton testID={props.testID} icon={state() === "copied" ? "check" : "copy"} label={state() === "copied" ? t("已复制", "Copied") : props.label} compact onPress={copy} />
      <If when={state() !== "idle"}>
        <Text class="text-[11px]" classList={{ "text-muted-foreground": state() === "copied", "text-destructive": state() === "failed" }}>
          {state() === "copied" ? t("已复制", "Copied") : t("没能复制", "Could not copy")}
        </Text>
      </If>
    </View>
  );
}
