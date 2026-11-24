/** 查找条：顶栏下面一行查找、一行替换。它只管输入和选项，真正去找的是传进来的引擎（所见即所得一个，源码一个）。 */
import { effect, keymap, signal, Text, untracked, View } from "nsh";
import { Input } from "nsh/base";
import { Button } from "../../ui/button";
import { settingsOpen } from "../settings/open";
import type { FindEngine, FindResult } from "./find";
import type { Ui } from "./ui-state";

/** 查找条的输入，放在组件外面：关掉再打开，上次找的还在。 */
export function createFindState() {
  return {
    query: signal(""),
    replacement: signal(""),
    caseSensitive: signal(false),
    wholeWord: signal(false),
    regex: signal(false),
  };
}

export type FindState = ReturnType<typeof createFindState>;

function summary(r: FindResult, query: string): string {
  if (r.error) return "正则有误";
  if (query === "") return "";
  if (r.count === 0) return "无结果";
  const total = `${r.count}${r.capped ? "+" : ""}`;
  return r.current === null ? `${total} 处` : `${r.current + 1} / ${total}`;
}

const FIELD =
  "h-7 w-[260px] rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary";

/** 查找条开着的时候 Esc 关掉它。单独成一个组件：绑定跟着查找条出现和消失，关着时不占 Esc。输入框自己的 onKeyDown 收不到 Esc（web host 实测，Esc 直接让输入框失焦）。 */
function EscapeCloses(props: { onEscape: () => void }) {
  keymap.bind("escape", props.onEscape, { when: "always" });
  return null;
}

/** `engine` 是取当前引擎的函数：切到源码视图时换一个。 */
export function FindBar(props: { ui: Ui; state: FindState; engine: () => FindEngine; onClose: () => void }) {
  const { ui, state } = props;
  effect(() => {
    const engine = props.engine();
    const open = ui.findMode() !== null;
    const q = { query: state.query(), caseSensitive: state.caseSensitive(), wholeWord: state.wholeWord(), regex: state.regex() };
    untracked(() => engine.search(open ? q : null));
  });
  const close = () => {
    // 设置对话框盖在上面时，Esc 是给对话框的
    if (settingsOpen()) return;
    ui.findMode.set(null);
    props.onClose();
  };
  const result = () => props.engine().result();
  const none = () => result().count === 0;
  const flip = (s: { (): boolean; set(v: boolean): void }) => () => s.set(!s());
  return (
    <If when={ui.findMode() !== null}>
      <View testID="find-bar" accessibilityLabel="查找" class="gap-1 border-b border-border bg-card px-5 py-2">
        <EscapeCloses onEscape={close} />
        <View class="flex-row flex-wrap items-center gap-1">
          <Input
            testID="find-query"
            ref={(node: { focus(): void }) => node.focus()}
            value={state.query()}
            onChange={({ value }) => state.query.set(value)}
            onSubmit={() => props.engine().next()}
            submitBehavior="submit"
            placeholder="查找"
            accessibilityLabel="查找内容"
            autoCapitalize="none"
            autoCorrect={false}
            class={FIELD}
          />
          <Button label="Aa" accessibilityLabel="区分大小写" active={state.caseSensitive()} onPress={flip(state.caseSensitive)} />
          <Button label="词" accessibilityLabel="整词匹配" active={state.wholeWord()} onPress={flip(state.wholeWord)} />
          <Button label=".*" accessibilityLabel="正则表达式" active={state.regex()} onPress={flip(state.regex)} />
          <Button label="上一个" disabled={none()} onPress={() => props.engine().previous()} />
          <Button label="下一个" disabled={none()} onPress={() => props.engine().next()} />
          <Text
            testID="find-count"
            style={{ fontVariant: ["tabular-nums"], numberOfLines: 1 }}
            class="min-w-0 flex-1 px-2 text-xs"
            classList={{ "text-destructive": !!result().error, "text-muted-foreground": !result().error }}
          >
            {summary(result(), state.query())}
          </Text>
          <Button label="关闭" accessibilityLabel="关闭查找" onPress={close} />
        </View>
        <If when={ui.findMode() === "replace"}>
          <View class="flex-row flex-wrap items-center gap-1">
            <Input
              testID="find-replacement"
              value={state.replacement()}
              onChange={({ value }) => state.replacement.set(value)}
              onSubmit={() => props.engine().replace(state.replacement())}
              submitBehavior="submit"
              placeholder="替换成"
              accessibilityLabel="替换成"
              autoCapitalize="none"
              autoCorrect={false}
              class={FIELD}
            />
            <Button label="替换" disabled={none()} onPress={() => props.engine().replace(state.replacement())} />
            <Button label="全部替换" disabled={none()} onPress={() => void props.engine().replaceAll(state.replacement())} />
          </View>
        </If>
      </View>
    </If>
  );
}
