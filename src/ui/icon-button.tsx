/** 图标按钮：只有一个图标的 ghost 按钮（30 见方）。没有字，所以读屏名和悬停提示必须给。 */
import { Button as BaseButton } from "nsh/base";
import { Icon, type IconName } from "./icon";
import { tip } from "./tooltip";

export interface IconButtonProps {
  icon: IconName;
  /** 读屏名，也是悬停提示：说这个按钮做什么（「打开文件」），不是图标画的是什么。 */
  label: string;
  /** 这一项正开着（大纲已展开）：图标变主色，底留着悬停的洗色。 */
  active?: boolean;
  testID?: string;
  onPress?: () => void;
}

export function IconButton(props: IconButtonProps) {
  return (
    <BaseButton
      testID={props.testID}
      onPress={props.onPress}
      accessibilityLabel={props.label}
      tooltip={tip(props.label)}
      class="size-[30px] items-center justify-center rounded-(--radius) transition duration-180 ease-settle hover:bg-hover active:scale-[0.97] active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100"
      classList={{ "bg-hover": !!props.active }}
    >
      <Icon name={props.icon} color={props.active ? "primary" : "muted-foreground"} />
    </BaseButton>
  );
}
