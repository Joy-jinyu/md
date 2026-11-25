/**
 * 版本历史：现在这篇的快照列表（新的在上），选一个在下面预览原文，「恢复这个版本」换掉现在的内容。
 * 恢复前现在的内容也会存成一个版本，所以恢复本身也能撤回。
 */
import { effect, Scroll, signal, Text, untracked, View } from "nsh";
import { Dialog } from "nsh/base";
import { messageOf } from "../../doc/message";
import { type Snapshot, snapshotsOf } from "../../store/history";
import { allDocs, currentDocId, displayName } from "../../store/library";
import { Button } from "../../ui/button";
import { returnFocusToEditor } from "../editor/ui-state";
import { timeLabel } from "./panel-state";
import { historyOpen, requestLibrary } from "./requests";

/** 预览最多显示多少字：整篇放进一个文字视图，太长了排版慢，前面一段足够认出是哪一版。 */
const PREVIEW_CHARS = 20_000;

function SnapshotRow(props: { snapshot: Snapshot; index: number; picked: boolean; onPick: () => void }) {
  return (
    <View
      testID={`snapshot-${props.index}`}
      role="button"
      accessibilityLabel={`${timeLabel(props.snapshot.at)} 的版本`}
      accessibilityState={{ selected: props.picked }}
      onPress={props.onPick}
      class="min-h-8 flex-row items-center justify-between gap-3 rounded-(--radius-sm) px-2 hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      classList={{ "bg-pressed": props.picked }}
    >
      <Text style={{ numberOfLines: 1 }} class="text-[13px]" classList={{ "font-medium text-primary": props.picked, "text-foreground": !props.picked }}>
        {timeLabel(props.snapshot.at)}
      </Text>
      <Text style={{ fontVariant: ["tabular-nums"], numberOfLines: 1 }} class="text-[11px] text-faint">
        {props.snapshot.text.length} 字符
      </Text>
    </View>
  );
}

export function HistoryDialog() {
  /** null 是还在读。 */
  const list = signal<Snapshot[] | null>(null);
  const picked = signal(0);
  const problem = signal("");
  effect(() => {
    if (!historyOpen()) return;
    const id = currentDocId();
    untracked(() => {
      list.set(null);
      picked.set(0);
      problem.set("");
      if (!id) return list.set([]);
      snapshotsOf(id).then(list.set, (e: unknown) => {
        problem.set(`没能读出版本历史：${messageOf(e)}`);
        list.set([]);
      });
    });
  });
  const close = () => {
    historyOpen.set(false);
    returnFocusToEditor();
  };
  const chosen = () => list()?.[picked()] ?? null;
  const name = () => {
    const doc = allDocs().find((d) => d.id === currentDocId());
    return doc ? displayName(doc) || "未命名" : "";
  };
  const preview = () => {
    const text = chosen()?.text ?? "";
    return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}\n…（只预览前 ${PREVIEW_CHARS} 字）` : text || "（空文档）";
  };
  return (
    <Dialog
      testID="history"
      open={historyOpen()}
      animation="fade"
      accessibilityLabel="版本历史"
      closeOnEscape
      closeOnBackdropPress
      onOpenChange={({ open }) => !open && close()}
      backdropClass="bg-scrim"
      class="mx-auto mt-16 w-full max-w-[640px] px-4"
    >
      <View class="overflow-hidden rounded-(--radius) border border-border bg-popover">
        <View class="gap-0.5 border-b border-border px-4 py-3">
          <Text class="text-sm font-medium text-strong">版本历史</Text>
          <Text style={{ numberOfLines: 1 }} class="select-text text-xs text-muted-foreground">
            {name()}
          </Text>
        </View>
        <If when={list()} else={<Text class="px-4 py-6 text-xs text-faint">正在读…</Text>}>
          {(snapshots) => (
            <If
              when={snapshots().length > 0}
              else={
                <Text testID="history-empty" class="select-text px-4 py-6 text-xs leading-5 text-muted-foreground">
                  {problem() || "这篇还没有历史版本。保存时，距上一个版本超过 5 分钟、或者改动比较大，会自动留一份。"}
                </Text>
              }
            >
              <Scroll class="max-h-[168px] border-b border-border p-1">
                <Each of={snapshots()} key="index">
                  {(s, index) => <SnapshotRow snapshot={s()} index={index()} picked={index() === picked()} onPick={() => picked.set(index())} />}
                </Each>
              </Scroll>
              <Scroll testID="history-preview" class="h-[280px] bg-background">
                <Text class="select-text px-4 py-3 font-mono text-[12px] leading-5 text-foreground">{preview()}</Text>
              </Scroll>
            </If>
          )}
        </If>
        <View class="flex-row flex-wrap items-center justify-end gap-1 border-t border-border px-4 py-2">
          <Text class="min-w-0 flex-1 text-[11px] leading-4 text-faint">恢复前，现在的内容会先存成一个版本。</Text>
          {/* 「恢复这个版本」在读出列表前是灰的，拿不到焦点，所以焦点给「关闭」 */}
          <Button testID="history-close" label="关闭" autoFocus onPress={close} />
          <Button
            testID="history-restore"
            label="恢复这个版本"
            variant="primary"
            disabled={chosen() === null}
            onPress={() => {
              const snapshot = chosen();
              if (!snapshot) return;
              close();
              requestLibrary({ kind: "restore", text: snapshot.text });
            }}
          />
        </View>
      </View>
    </Dialog>
  );
}
