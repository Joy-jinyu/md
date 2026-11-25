/**
 * 冲突对比：本机和 GitHub 两栏（宽屏并排，窄了上下排），按块（空行分开的段）列出原文，和另一边不一样的块标出「只在本机」/「只在 GitHub」。
 * 整篇选一边；没选的那一边存进版本历史。布局见 DESIGN.md「M5：同步」。
 */
import { Scroll, Text, View, windowSize } from "nsh";
import { type DiffBlock, diffBlocks } from "../../doc/block-diff";
import { Button } from "../../ui/button";
import type { Issue } from "./engine";
import { keepLocal, resolving, takeRemote } from "./resolve";

/** 一栏最多列多少块：每块一个文字视图，太多了排版慢。 */
const MAX_BLOCKS = 400;
/** 两栏并排要的最小窗口宽度：每栏至少 320 加边距。 */
const SIDE_BY_SIDE = 720;

type Conflict = Extract<Issue, { kind: "conflict" }>;

function Column(props: { testID: string; title: string; onlyLabel: string; blocks: DiffBlock[] }) {
  const shown = () => props.blocks.slice(0, MAX_BLOCKS);
  const changed = () => props.blocks.filter((b) => b.only).length;
  return (
    <View testID={props.testID} class="min-w-0 flex-1 gap-1">
      <Text class="text-[11px] text-faint">{`${props.title} · ${changed()} 块不一样`}</Text>
      <Scroll class="max-h-[360px] rounded-(--radius-sm) border border-border bg-background">
        <View class="gap-2 p-2">
          <Each of={shown()} key="index">
            {(block) => (
              <View class="rounded-(--radius-sm) px-2 py-1" classList={{ "bg-warn-tint": block().only }}>
                <If when={block().only}>
                  <Text class="text-[11px] text-warn">{props.onlyLabel}</Text>
                </If>
                <Text class="font-mono text-[12px] leading-5 text-foreground">
                  {block().text}
                </Text>
              </View>
            )}
          </Each>
          <If when={props.blocks.length > MAX_BLOCKS}>
            <Text class="text-[11px] text-faint">{`还有 ${props.blocks.length - MAX_BLOCKS} 块没列出来。`}</Text>
          </If>
          <If when={props.blocks.length === 0}>
            <Text class="text-[11px] text-faint">（空文档）</Text>
          </If>
        </View>
      </Scroll>
    </View>
  );
}

export function ConflictView(props: { issue: Conflict; onBack: () => void }) {
  const diff = diffBlocks(props.issue.local, props.issue.remote.text);
  const busy = () => resolving() !== null;
  const pick = (choose: (issue: Conflict) => Promise<void>) => void choose(props.issue).then(props.onBack);
  return (
    <View testID="conflict-view" class="gap-3 px-4 py-3">
      <Text class="text-sm font-medium text-strong">{`「${props.issue.name}」两边都改过`}</Text>
      <If when={diff.rough}>
        <Text testID="conflict-rough" class="text-xs leading-5 text-muted-foreground">
          这篇太长，有一段没有逐块比较：那一段整段标成了不一样，实际可能有相同的块。
        </Text>
      </If>
      <If when={!diff.local.some((b) => b.only) && !diff.remote.some((b) => b.only)}>
        <Text testID="conflict-blank-only" class="text-xs leading-5 text-muted-foreground">
          两边的段落都一样，只差空行或换行符。
        </Text>
      </If>
      <View class="gap-3" classList={{ "flex-row": windowSize().width >= SIDE_BY_SIDE }}>
        <Column testID="conflict-local" title="本机" onlyLabel="只在本机" blocks={diff.local} />
        <Column testID="conflict-remote" title="GitHub" onlyLabel="只在 GitHub" blocks={diff.remote} />
      </View>
      <View class="flex-row flex-wrap items-center justify-end gap-1">
        <Text class="min-w-0 flex-1 text-[11px] leading-4 text-faint">没选的那一边会存进这篇的版本历史。</Text>
        <Button testID="conflict-later" label="先不选" autoFocus onPress={props.onBack} />
        <Button testID="conflict-take-remote" label="用 GitHub 的" disabled={busy()} onPress={() => pick(takeRemote)} />
        <Button testID="conflict-keep-local" label="保留本机的" variant="primary" disabled={busy()} onPress={() => pick(keepLocal)} />
      </View>
    </View>
  );
}
