/**
 * 顶栏里的同步入口：一个文字按钮，字就是状态（未登录 / 同步中… / 已同步 时间 / N 件事要选 / 同步出错），点开同步面板。没配置时不出现。
 * `compact`（窄窗口）：只留图标和短状态，读屏名照旧是完整的状态。布局见 DESIGN.md「M5：同步」。
 */
import { Text } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { SIGN_IN_FLOW } from "../../platform";
import { currentAccount } from "../../sync/account";
import { syncConfigured } from "../../sync/config";
import { Icon } from "../../ui/icon";
import { tip } from "../../ui/tooltip";
import { hourMinute } from "../library/panel-state";
import { lastSyncAt, syncIssues, syncRun } from "./engine";
import { syncOpen } from "./open";

/** 顶栏放得下的时间：今天的写「14:03」，更早的写「11 月 24 日」。 */
function shortTime(at: number): string {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString() ? hourMinute(d) : `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 状态文字、窄窗口里的短状态（空的就只有图标）、读屏名里的状态，和是不是要注意（出错、有冲突这类要选的事）。 */
export function syncLabel(): { text: string; short: string; spoken: string; alert: boolean } {
  const account = currentAccount();
  if (account.kind !== "signed-in") return { text: "未登录", short: "", spoken: "未登录", alert: false };
  const run = syncRun();
  if (run.kind === "running") return { text: "同步中…", short: "…", spoken: "同步中…", alert: false };
  if (run.kind === "error") return { text: "同步出错", short: "出错", spoken: "同步出错", alert: true };
  const open = syncIssues();
  if (open.length > 0) {
    const text = `${open.length} 件事要选`;
    return { text, short: String(open.length), spoken: text, alert: open.some((i) => i.kind !== "remote-only" && i.kind !== "upload") };
  }
  const at = lastSyncAt();
  // 没同步过时字就是「同步」，读屏名换成说状态，免得读成「同步：同步」
  if (!at) return { text: "同步", short: "", spoken: "还没同步过", alert: false };
  const text = `已同步 ${shortTime(at)}`;
  return { text, short: "", spoken: text, alert: false };
}

export function SyncButton(props: { compact: boolean }) {
  const shown = () => (props.compact ? syncLabel().short : syncLabel().text);
  return (
    <If when={syncConfigured(SIGN_IN_FLOW === "web")}>
      <BaseButton
        testID="sync-status"
        onPress={() => syncOpen.set(true)}
        accessibilityLabel={`同步：${syncLabel().spoken}，打开同步面板`}
        tooltip={tip("同步到 GitHub")}
        class="min-h-7 shrink-0 flex-row items-center gap-1 rounded-(--radius) px-2 transition duration-180 ease-settle hover:bg-hover active:scale-[0.97] active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:active:scale-100"
      >
        <If when={props.compact}>
          <Icon name="refresh" size={14} color="muted-foreground" />
        </If>
        <If when={shown()}>
          <Text style={{ numberOfLines: 1 }} class="text-xs" classList={{ "text-muted-foreground": !syncLabel().alert, "text-destructive": syncLabel().alert }}>
            {shown()}
          </Text>
        </If>
      </BaseButton>
    </If>
  );
}
