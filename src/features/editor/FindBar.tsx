/** 查找条：顶栏下面一行查找、一行替换。它只管输入和选项，真正去找的是传进来的引擎（所见即所得一个，源码一个）。 */
import { effect, keymap, signal, Text, untracked, View } from "nsh";
import { Input } from "nsh/base";
import { t } from "../../i18n";
import { Button } from "../../ui/button";
import { currentDocId } from "../../store/library";
import { pendingFind } from "../library/requests";
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
  if (r.error) return t("正则有误", "Invalid regular expression");
  if (query === "") return "";
  if (r.count === 0) return t("无结果", "No matches");
  const total = `${r.count}${r.capped ? "+" : ""}`;
  return r.current === null ? t(`${total} 处`, `${total} ${r.count === 1 && !r.capped ? "match" : "matches"}`) : `${r.current + 1} / ${total}`;
}

const FIELD =
  "h-7 w-[260px] rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary";

/** 查找条开着的时候 Esc 关掉它。单独成一个组件：绑定跟着查找条出现和消失，关着时不占 Esc。输入框自己的 onKeyDown 收不到 Esc（web host 实测，Esc 直接让输入框失焦）。 */
function EscapeCloses(props: { onEscape: () => void }) {
  keymap.bind("escape", props.onEscape, { when: "always" });
  return null;
}

/** 等查找条把词交给引擎、引擎找完再跳（毫秒）：查找条的 effect 在渲染之后才跑。 */
const PENDING_FIND_SETTLE = 50;

/** 切到源码视图后，等源码编辑框挂上、找完再跳：每隔多久看一次、最多看几次（毫秒 / 次），合计约 1.5 秒。 */
const SOURCE_FIND_POLL = 50;
const SOURCE_FIND_TRIES = 30;

/** 切到源码视图以后，等源码那边找到了再跳到第一处；一直找不到就停。 */
function nextOnceFound(engine: () => FindEngine, tries = SOURCE_FIND_TRIES) {
  if (engine().result().count > 0) return engine().next();
  if (tries > 0) setTimeout(() => nextOnceFound(engine, tries - 1), SOURCE_FIND_POLL);
}

/**
 * 全文搜索点了结果、打开这篇以后：打开查找条、填上那个词（普通方式，不分大小写），跳到第一处。在编辑页渲染时调用。
 * 全文搜索搜的是 Markdown 原文，`**粗体`、链接地址这类在所见即所得里看不到：给了 `toSource` 且这边一处都找不到时，切到源码视图再找。
 */
export function followPendingFind(ui: Ui, state: FindState, engine: () => FindEngine, toSource?: () => void) {
  const mine = currentDocId();
  effect(() => {
    const pending = pendingFind();
    if (pending === null || pending.id !== mine) return;
    const { query } = pending;
    untracked(() => {
      pendingFind.set(null);
      state.query.set(query);
      state.caseSensitive.set(false);
      state.wholeWord.set(false);
      state.regex.set(false);
      ui.findMode.set("find");
      setTimeout(() => {
        if (engine().result().count > 0 || !toSource) return engine().next();
        toSource();
        nextOnceFound(engine);
      }, PENDING_FIND_SETTLE);
    });
  });
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
      <View testID="find-bar" accessibilityLabel={t("查找", "Find")} class="gap-1 border-b border-border bg-card px-5 py-2">
        <EscapeCloses onEscape={close} />
        <View class="flex-row flex-wrap items-center gap-1">
          <Input
            testID="find-query"
            ref={(node: { focus(): void }) => node.focus()}
            value={state.query()}
            onChange={({ value }) => state.query.set(value)}
            onSubmit={() => props.engine().next()}
            submitBehavior="submit"
            placeholder={t("查找", "Find")}
            accessibilityLabel={t("查找内容", "Search text")}
            autoCapitalize="none"
            autoCorrect={false}
            class={FIELD}
          />
          <Button label="Aa" accessibilityLabel={t("区分大小写", "Match case")} active={state.caseSensitive()} onPress={flip(state.caseSensitive)} />
          <Button label={t("词", "Word")} accessibilityLabel={t("整词匹配", "Match whole words")} active={state.wholeWord()} onPress={flip(state.wholeWord)} />
          <Button label=".*" accessibilityLabel={t("正则表达式", "Regular expression")} active={state.regex()} onPress={flip(state.regex)} />
          <Button label={t("上一个", "Previous")} disabled={none()} onPress={() => props.engine().previous()} />
          <Button label={t("下一个", "Next")} disabled={none()} onPress={() => props.engine().next()} />
          <Text
            testID="find-count"
            style={{ fontVariant: ["tabular-nums"], numberOfLines: 1 }}
            class="min-w-0 flex-1 px-2 text-xs"
            classList={{ "text-destructive": !!result().error, "text-muted-foreground": !result().error }}
          >
            {summary(result(), state.query())}
          </Text>
          <Button label={t("关闭", "Close")} accessibilityLabel={t("关闭查找", "Close Find")} onPress={close} />
        </View>
        <If when={ui.findMode() === "replace"}>
          <View class="flex-row flex-wrap items-center gap-1">
            <Input
              testID="find-replacement"
              value={state.replacement()}
              onChange={({ value }) => state.replacement.set(value)}
              onSubmit={() => props.engine().replace(state.replacement())}
              submitBehavior="submit"
              placeholder={t("替换成", "Replace with")}
              accessibilityLabel={t("替换成", "Replace with")}
              autoCapitalize="none"
              autoCorrect={false}
              class={FIELD}
            />
            <Button label={t("替换", "Replace")} disabled={none()} onPress={() => props.engine().replace(state.replacement())} />
            <Button label={t("全部替换", "Replace All")} disabled={none()} onPress={() => void props.engine().replaceAll(state.replacement())} />
          </View>
        </If>
      </View>
    </If>
  );
}
