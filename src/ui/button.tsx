/** 按钮：M1 只有顶栏和链接输入用到，两种外观、一种尺寸。看起来怎样全在这里，功能代码只传 variant。 */
import { Text } from "nsh";
import { Button as BaseButton } from "nsh/base";

/** primary：一组里唯一的默认操作（回车对应的那个）。ghost：顶栏、弹层里的安静操作。 */
export type ButtonVariant = "primary" | "ghost";

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  /** 读屏名，默认就是 label。 */
  accessibilityLabel?: string;
  disabled?: boolean;
  /** ghost 专用：这一项正开着（粗体已加、大纲已展开），字变成 primary 色。 */
  active?: boolean;
  testID?: string;
  /** 加在字上的类（格式条的 B 要粗、I 要斜）；颜色仍由 variant / active 决定。 */
  labelClass?: string;
  onPress?: () => void;
}

/** 小号按钮（28 高）：洗色悬停、按下缩到 0.97（180ms 软落定）、键盘焦点环在边框外，不能按时 45% 不透明。 */
export function Button(props: ButtonProps) {
  const v = () => props.variant ?? "ghost";
  return (
    <BaseButton
      testID={props.testID}
      onPress={props.onPress}
      disabled={props.disabled}
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      class="min-h-7 flex-row items-center justify-center rounded-(--radius) px-3 transition duration-180 ease-settle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      classList={{
        "active:scale-[0.97] motion-reduce:active:scale-100": !props.disabled,
        "opacity-45": !!props.disabled,
        "bg-primary": v() === "primary",
        "hover:opacity-90": v() === "primary" && !props.disabled,
        "hover:bg-hover active:bg-pressed": v() === "ghost" && !props.disabled,
      }}
    >
      <Text
        style={{ numberOfLines: 1 }}
        class={`text-xs font-medium ${props.labelClass ?? ""}`}
        classList={{
          "text-primary-foreground": v() === "primary",
          "text-foreground": v() === "ghost" && !props.active,
          "text-primary": v() === "ghost" && !!props.active,
        }}
      >
        {props.label}
      </Text>
    </BaseButton>
  );
}
