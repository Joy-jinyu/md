/** 设置页各类内容共用的排版：分组卡片、设置行、键值行、提示框、状态、分段选择、开关、折叠说明。样子见 DESIGN.md「屏幕：设置」。 */
import { type JSX, signal, Text, View } from "nsh";
import { Button as BaseButton, Collapsible, Switch } from "nsh/base";
import { t } from "../../i18n";
import { Icon } from "../../ui/icon";

/** 说明文字最宽多少：卡片铺满右栏，但字一行太长不好读（约 45 个汉字、90 个英文字符）。 */
export const PROSE = "max-w-[640px]";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const NOTE = "select-text text-xs leading-5 text-muted-foreground";

/** 一组设置：上面一个小标题（可选），下面一张卡片，卡片里一行一行用细线隔开。 */
export function Group(props: { title?: string; description?: string; testID?: string; children: JSX.Element }) {
  return (
    <View testID={props.testID} class="gap-2">
      <If when={props.title}>
        {(title) => (
          <Text role="header" class="px-1 text-[13px] font-semibold text-strong">
            {title()}
          </Text>
        )}
      </If>
      <If when={props.description}>{(text) => <Text class={`px-1 ${NOTE} ${PROSE}`}>{text()}</Text>}</If>
      {/* 每行顶上一条线；-mt-px 把第一行的线藏进卡片的边框里，就不用分第一行 */}
      <View class="overflow-hidden rounded-(--radius) border border-border bg-card">
        <View class="-mt-px">{props.children}</View>
      </View>
    </View>
  );
}

/** 卡片里的一行：左边名字和说明，右边控件；窄了控件折到下一行。`children` 放在说明下面（一段路径、一行结果）。 */
export function Row(props: { label: string; description?: string; control?: JSX.Element; testID?: string; mono?: boolean; children?: JSX.Element }) {
  return (
    <View testID={props.testID} class="min-h-14 flex-row flex-wrap items-center gap-x-6 gap-y-2 border-t border-border px-4 py-3">
      <View class="min-w-[220px] flex-1 gap-0.5">
        <Text class="select-text text-strong" classList={{ "text-[13px] font-medium": !props.mono, "font-mono text-[12px]": !!props.mono }}>
          {props.label}
        </Text>
        <If when={props.description}>{(text) => <Text class={`${NOTE} ${PROSE}`}>{text()}</Text>}</If>
        {props.children}
      </View>
      <If when={props.control}>{(control) => <View class="shrink-0 flex-row flex-wrap items-center gap-2">{control()}</View>}</If>
    </View>
  );
}

/** 卡片里不分左右的一块（表单、命令、步骤）。 */
export function Block(props: { testID?: string; children: JSX.Element }) {
  return (
    <View testID={props.testID} class="gap-3 border-t border-border px-4 py-3">
      {props.children}
    </View>
  );
}

/** 只读的「名字 值」一行：名字定宽、值可选中。读屏连起来读「名字：值」。 */
export function Field(props: { label: string; value: string; mono?: boolean }) {
  return (
    <View accessible accessibilityLabel={t(`${props.label}：${props.value}`, `${props.label}: ${props.value}`)} class="min-h-11 flex-row flex-wrap items-center gap-x-6 gap-y-0.5 border-t border-border px-4 py-2.5">
      <Text class="w-32 shrink-0 text-[13px] text-muted-foreground">{props.label}</Text>
      <Text class="min-w-[150px] flex-1 select-text text-[13px] text-foreground" classList={{ "font-mono text-[12px]": !!props.mono }}>
        {props.value}
      </Text>
    </View>
  );
}

/** 页面说明下面的一段话（限宽）。 */
export const Prose = (props: { children: string; testID?: string }) => (
  <Text testID={props.testID} class={`${NOTE} ${PROSE}`}>
    {props.children}
  </Text>
);

/**
 * 一块有底色的提示：`warn` 要注意（网关拒绝了），`danger` 出错了，`info` 一件事的结果。
 * 不只靠颜色：`warn` / `danger` 读屏当提醒读（`role=alert`），标题写清是什么事。`announce`：`info` 也要读屏马上读（点了按钮之后的结果）。
 */
export function Callout(props: { tone: "warn" | "danger" | "info"; title?: string; testID?: string; announce?: boolean; children: string }) {
  const alert = () => props.tone !== "info" || !!props.announce;
  return (
    <View testID={props.testID} role={alert() ? "alert" : undefined} class="gap-1 rounded-(--radius) px-4 py-3" classList={{ "bg-warn-tint": props.tone === "warn", "bg-muted": props.tone !== "warn" }}>
      <If when={props.title}>
        {(title) => (
          <Text class="text-[13px] font-medium" classList={{ "text-warn-text": props.tone === "warn", "text-destructive": props.tone === "danger", "text-strong": props.tone === "info" }}>
            {title()}
          </Text>
        )}
      </If>
      <Text class={`select-text text-xs leading-5 ${PROSE}`} classList={{ "text-warn-text": props.tone === "warn", "text-destructive": props.tone === "danger", "text-foreground": props.tone === "info" }}>
        {props.children}
      </Text>
    </View>
  );
}

/** 一个状态小标签：圆点 + 字。状态写成字，圆点只是帮眼睛。 */
export function Status(props: { tone: "ok" | "busy" | "off"; label: string; testID?: string }) {
  return (
    <View testID={props.testID} class="flex-row items-center gap-1.5 rounded-full bg-muted px-2.5 py-1">
      <View class="size-2 rounded-full" classList={{ "bg-primary": props.tone === "ok", "bg-warn": props.tone === "busy", "bg-faint": props.tone === "off" }} />
      <Text class="text-xs font-medium text-foreground">{props.label}</Text>
    </View>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  testID: string;
}

/** 几个选项里选一个（语言、图床种类）：当前项 `pressed` 底、字 `strong`、前面一个对勾，读屏名加「（当前）」并报「已选中」。 */
export function Segmented<T extends string>(props: { label: string; value: T; options: SegmentOption<T>[]; onChange: (value: T) => void }) {
  return (
    <View accessibilityLabel={props.label} class="flex-row flex-wrap self-start rounded-(--radius) border border-input bg-background p-0.5">
      <Each of={props.options} key={(o) => o.value}>
        {(o) => {
          const on = () => props.value === o().value;
          return (
            <BaseButton
              testID={o().testID}
              selected={on()}
              accessibilityLabel={on() ? t(`${o().label}（当前）`, `${o().label} (current)`) : o().label}
              onPress={() => props.onChange(o().value)}
              class={`min-h-7 flex-row items-center gap-1 rounded-(--radius-sm) px-3 transition duration-180 ease-settle hover:bg-hover active:bg-pressed selected:bg-pressed motion-reduce:transition-none ${FOCUS_RING}`}
            >
              <If when={on()}>
                <Icon name="check" size={12} color="primary" />
              </If>
              <Text class="text-xs" classList={{ "font-medium text-strong": on(), "text-muted-foreground": !on() }}>
                {o().label}
              </Text>
            </BaseButton>
          );
        }}
      </Each>
    </View>
  );
}

/** 开关：开着 `primary` 底、圆点在右。读屏名就是 `label`，开没开由 Switch 报。 */
export function Toggle(props: { checked: boolean; label: string; testID?: string; onChange: (next: boolean) => void }) {
  return (
    <Switch
      testID={props.testID}
      checked={props.checked}
      accessibilityLabel={props.label}
      onChange={({ checked }) => props.onChange(checked)}
      class={`rounded-full ${FOCUS_RING}`}
      trackClass="h-5 w-9 justify-center rounded-full bg-border-strong px-0.5 transition duration-180 ease-settle checked:bg-primary motion-reduce:transition-none"
      thumbClass="size-4 rounded-full bg-background shadow-sm transition duration-180 ease-settle checked:translate-x-4 motion-reduce:transition-none"
    />
  );
}

/** 「详细说明」：平时收着，点开看规则这类细节。 */
export function Details(props: { label: string; children: string; testID?: string }) {
  const open = signal(false);
  return (
    <Collapsible open={open()} content={<Text class={`pt-1 ${NOTE} ${PROSE}`}>{props.children}</Text>}>
      <View
        testID={props.testID}
        role="button"
        accessibilityLabel={props.label}
        accessibilityState={{ expanded: open() }}
        onPress={() => open.set(!open())}
        class={`-ml-1 flex-row items-center gap-0.5 self-start rounded-(--radius-sm) py-0.5 pl-0.5 pr-1.5 hover:bg-hover ${FOCUS_RING}`}
      >
        <Icon name={open() ? "chevronDown" : "chevronRight"} size={14} color="muted-foreground" />
        <Text class="text-xs text-muted-foreground">{props.label}</Text>
      </View>
    </Collapsible>
  );
}
