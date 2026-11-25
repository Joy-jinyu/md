/**
 * 同步面板：账号和上次同步时间、这篇同步不同步、这次的结果、要你选的事、「立即同步」。冲突的对比在同一个对话框里换成 ConflictView。
 * 布局见 DESIGN.md「M5：同步」。
 */
import { effect, Scroll, signal, Text, untracked, View } from "nsh";
import { Dialog } from "nsh/base";
import { messageOf } from "../../doc/message";
import { SIGN_IN_FLOW } from "../../platform";
import { currentDocId } from "../../store/library";
import { syncRecordOf } from "../../store/sync-store";
import { currentAccount } from "../../sync/account";
import { syncConfigured } from "../../sync/config";
import { gistTitle } from "../../sync/github";
import { Button } from "../../ui/button";
import { CopyButton } from "../../ui/copy-button";
import { returnFocusToEditor } from "../editor/ui-state";
import { timeLabel } from "../library/panel-state";
import { ConflictView } from "./ConflictView";
import { type Issue, issueKey, lastSyncAt, resultText, runSync, syncIssues, syncRun } from "./engine";
import { comparing, syncOpen } from "./open";
import { createSeparate, forgetDeleted, linkNameMatch, pullAllRemote, pullBack, pullRemote, reupload, resolving, setExcluded, stopSyncing } from "./resolve";
import { SyncAccount } from "./SyncAccount";
import { UploadConfirm } from "./UploadConfirm";

type Choice = Exclude<Issue, { kind: "upload" }>;

/** 一件要你选的事：名字、一句说明、按钮。 */
function IssueRow(props: { issue: Choice }) {
  const i = props.issue;
  const busy = () => resolving() !== null;
  const title = i.kind === "remote-only" ? gistTitle(i.gist) : i.name;
  const text = {
    conflict: "本机和 GitHub 上都改过，改得不一样。",
    "name-match": "这篇还没同步过，GitHub 上有一篇同名的，内容不一样。",
    "remote-deleted": "GitHub 上的那份被删了，本机这篇还在。",
    "local-deleted": "本机删了，GitHub 上还在。",
    "remote-only": "GitHub 上有，这台设备上没有。",
    failed: i.kind === "failed" ? i.message : "",
  }[i.kind];
  return (
    <View testID={`sync-issue-${issueKey(i)}`} class="gap-1 rounded-(--radius-sm) bg-card px-3 py-2">
      <Text style={{ numberOfLines: 1 }} class="select-text text-[13px] font-medium text-strong">{`「${title}」`}</Text>
      <Text class="select-text text-xs leading-5 text-muted-foreground">{text}</Text>
      <View class="flex-row flex-wrap gap-1">
        {i.kind === "conflict" && <Button testID="sync-compare" label="对比并选择" variant="primary" onPress={() => comparing.set(i.id)} />}
        {i.kind === "name-match" && (
          <>
            <Button testID="sync-link-match" label="连上并对比" disabled={busy()} onPress={() => void linkNameMatch(i).then(() => comparing.set(i.id))} />
            <Button testID="sync-create-separate" label="另建一个" disabled={busy()} onPress={() => void createSeparate(i)} />
          </>
        )}
        {i.kind === "remote-deleted" && (
          <>
            <Button testID="sync-reupload" label="重新上传" disabled={busy()} onPress={() => void reupload(i)} />
            <Button testID="sync-stop" label="不再同步这篇" disabled={busy()} onPress={() => void stopSyncing(i)} />
          </>
        )}
        {i.kind === "local-deleted" && (
          <>
            <Button testID="sync-pull-back" label="拉回本机" disabled={busy()} onPress={() => void pullBack(i)} />
            <Button testID="sync-forget" label="不再同步" disabled={busy()} onPress={() => void forgetDeleted(i)} />
          </>
        )}
        {i.kind === "remote-only" && <Button testID="sync-pull" label="拉到本机" disabled={busy()} onPress={() => void pullRemote(i)} />}
      </View>
    </View>
  );
}

function Issues() {
  const remoteOnly = () => syncIssues().filter((i): i is Extract<Issue, { kind: "remote-only" }> => i.kind === "remote-only");
  const upload = () => syncIssues().find((i): i is Extract<Issue, { kind: "upload" }> => i.kind === "upload") ?? null;
  const choices = () => syncIssues().filter((i): i is Choice => i.kind !== "upload");
  return (
    <>
      <If when={upload()}>{(u) => <UploadConfirm issue={u()} />}</If>
      <If when={choices().length > 0}>
        <View class="gap-2">
          <View class="flex-row items-center justify-between">
            <Text class="text-[11px] text-faint">要你选的事</Text>
            <If when={remoteOnly().length > 1}>
              <Button testID="sync-pull-all" label="全部拉到本机" disabled={resolving() !== null} onPress={() => void pullAllRemote(remoteOnly())} />
            </If>
          </View>
          <Each of={choices()} key={issueKey}>
            {(issue) => <IssueRow issue={issue()} />}
          </Each>
        </View>
      </If>
    </>
  );
}

/** 这篇同步不同步。 */
function ThisDocument() {
  const excluded = signal<boolean | null>(null);
  const problem = signal("");
  effect(() => {
    const id = currentDocId();
    // 处理完一件待选事项（确认上传时没勾这篇、「不再同步这篇」）可能改了这篇的设置：待选事项一变就重读
    syncIssues();
    if (!syncOpen() || !id) return;
    untracked(() => {
      excluded.set(null);
      syncRecordOf(id).then((r) => excluded.set(r?.excluded === true), (e: unknown) => problem.set(`读不到这篇的同步设置：${messageOf(e)}`));
    });
  });
  const flip = async () => {
    const id = currentDocId();
    const next = !excluded();
    if (!id) return;
    try {
      await setExcluded(id, next);
      excluded.set(next);
      problem.set("");
    } catch (e) {
      problem.set(`没能改：${messageOf(e)}`);
    }
  };
  return (
    <View class="flex-row flex-wrap items-center gap-2">
      <Text testID="sync-this-doc" class="select-text text-xs text-muted-foreground">
        {excluded() ? "这篇不同步" : "这篇会同步"}
      </Text>
      <Button testID="sync-toggle-doc" label={excluded() ? "恢复同步" : "不同步这篇"} disabled={excluded() === null} onPress={() => void flip()} />
      <If when={problem()}>
        <Text class="select-text text-xs text-destructive">{problem()}</Text>
      </If>
    </View>
  );
}

function RunResult() {
  const run = () => syncRun();
  return (
    <>
      <If when={resultText()}>
        {(summary) => (
          <Text testID="sync-result" class="select-text text-xs leading-5 text-foreground">
            {summary()}
          </Text>
        )}
      </If>
      <If when={run().kind === "error" ? (run() as { message: string }).message : null}>
        {(message) => (
          <View class="flex-row items-start gap-2">
            <Text testID="sync-error" role="alert" class="min-w-0 flex-1 select-text text-xs leading-5 text-destructive">
              {`没能同步：${message()}`}
            </Text>
            <CopyButton testID="copy-sync-error" text={message()} label="复制出错原因" />
          </View>
        )}
      </If>
    </>
  );
}

function Overview() {
  const signedIn = () => currentAccount().kind === "signed-in";
  const last = () => lastSyncAt();
  return (
    <Scroll class="max-h-[480px]">
      <View class="gap-3 px-4 py-3">
        <SyncAccount explain={!signedIn()} />
        <If when={!signedIn()}>
          <RunResult />
        </If>
        <If when={signedIn()}>
          <Text class="select-text text-xs text-muted-foreground">{last() ? `上次同步：${timeLabel(last() as number)}` : "这台设备还没同步过。"}</Text>
          <If when={currentDocId()}>
            <ThisDocument />
          </If>
          <RunResult />
          <Issues />
        </If>
      </View>
    </Scroll>
  );
}

export function SyncDialog() {
  const close = () => {
    comparing.set(null);
    syncOpen.set(false);
    returnFocusToEditor();
  };
  const conflict = () => syncIssues().find((i): i is Extract<Issue, { kind: "conflict" }> => i.kind === "conflict" && i.id === comparing()) ?? null;
  const canSync = () => syncConfigured(SIGN_IN_FLOW === "web") && currentAccount().kind === "signed-in";
  return (
    <Dialog
      testID="sync"
      open={syncOpen()}
      animation="fade"
      accessibilityLabel="同步到 GitHub"
      closeOnEscape
      closeOnBackdropPress
      onOpenChange={({ open }) => !open && close()}
      backdropClass="bg-scrim"
      class={`mx-auto mt-16 w-full px-4 ${conflict() ? "max-w-[960px]" : "max-w-[640px]"}`}
    >
      <View class="overflow-hidden rounded-(--radius) border border-border bg-popover">
        <If when={conflict() === null}>
          <View class="border-b border-border px-4 py-3">
            <Text class="text-sm font-medium text-strong">同步到 GitHub</Text>
          </View>
        </If>
        <If when={conflict()} else={<Overview />}>
          {(c) => <ConflictView issue={c()} onBack={() => comparing.set(null)} />}
        </If>
        <If when={conflict() === null}>
          <View class="flex-row items-center justify-end gap-1 border-t border-border px-4 py-2">
            <Button testID="sync-close" label="关闭" autoFocus onPress={close} />
            <If when={canSync()}>
              <Button
                testID="sync-now"
                label={syncRun().kind === "running" ? "同步中…" : "立即同步"}
                variant="primary"
                disabled={syncRun().kind === "running" || resolving() !== null}
                onPress={() => void runSync()}
              />
            </If>
          </View>
        </If>
      </View>
    </Dialog>
  );
}
