/** 图标按钮：只有一个图标的 ghost 按钮（30 见方，`compact` 时 28）。没有字，所以读屏名和悬停提示必须给。 */
import type { ViewRef } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { Icon, type IconName } from "./icon";
import { tip } from "./tooltip";

export interface IconButtonProps {
  icon: IconName;
  /** 读屏名，也是悬停提示：说这个按钮做什么（「打开文件」），不是图标画的是什么。 */
  label: string;
  /** 悬停提示，默认就是 label。读屏名要带上下文（「「名字」的更多操作」）而提示放不下时，给短的。 */
  tooltip?: string;
  /** 加在按钮上的类：位置（外边距）、悬停才出现这类和所在行有关的样子；尺寸和状态色仍由这里定。 */
  class?: string;
  /** 这一项正开着（大纲已展开）：图标变主色，底留着悬停的洗色。 */
  active?: boolean;
  /** 侧栏这类紧凑的地方：28 见方、`radius-sm`，和旁边 28 高的控件一样高。 */
  compact?: boolean;
  /** 开关类按钮现在是开着的（读屏说「已选中」）；样子用 `active`。 */
  selected?: boolean;
  testID?: string;
  ref?: (node: ViewRef) => void;
  onPress?: () => void;
}

export function IconButton(props: IconButtonProps) {
  return (
    <BaseButton
      testID={props.testID}
      ref={props.ref}
      onPress={props.onPress}
      selected={props.selected}
      accessibilityLabel={props.label}
      tooltip={tip(props.tooltip ?? props.label)}
      class={`${props.class ?? ""} items-center justify-center transition duration-180 ease-settle hover:bg-hover active:scale-[0.97] active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100`}
      classList={{ "bg-hover": !!props.active, "size-[30px] rounded-(--radius)": !props.compact, "size-7 rounded-(--radius-sm)": !!props.compact }}
    >
      <Icon name={props.icon} color={props.active ? "primary" : "muted-foreground"} />
    </BaseButton>
  );
}
