/**
 * 侧栏的「文档」页：上面一个跨文档的搜索框、排序和新建；下面是文档列表，或者（有搜索词时）搜索结果。
 * 每行右边的「⋯」展开这一行的操作（重命名、版本历史、删除），不靠悬停，键盘和触屏都按得到。
 */
import { Scroll, Text, View } from "nsh";
import { Input } from "nsh/base";
import type { DocMeta } from "../../store/document-store";
import { allDocs, currentDocId, displayName } from "../../store/library";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { problemText } from "./external";
import { panel, setQuery, sorted, timeLabel } from "./panel-state";
import { historyOpen, requestLibrary } from "./requests";
import type { SearchResult } from "./search";

const FIELD = "h-7 rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary";

/** `onPicked`：选了一篇（或一个搜索结果），盖在正文上的侧栏这时该收起。 */
export function DocumentsPanel(props: { onPicked: () => void }) {
  const searching = () => panel.query().trim() !== "";
  return (
    <View testID="documents" accessibilityLabel="文档" class="flex-1">
      <View class="gap-1 px-3 pb-2">
        <Input
          testID="doc-search"
          value={panel.query()}
          onChange={({ value }) => setQuery(value)}
          placeholder="搜索所有文档"
          accessibilityLabel="搜索所有文档的正文"
          autoCapitalize="none"
          autoCorrect={false}
          class={FIELD}
        />
        <View class="flex-row items-center justify-between">
          <Button
            testID="doc-sort"
            label={panel.sort() === "time" ? "按改动时间" : "按名字"}
            accessibilityLabel={panel.sort() === "time" ? "现在按改动时间排，改成按名字排" : "现在按名字排，改成按改动时间排"}
            onPress={() => panel.sort.set(panel.sort() === "time" ? "name" : "time")}
          />
          <IconButton testID="doc-new" icon="plus" label="新建文档" onPress={() => requestLibrary({ kind: "create" })} />
        </View>
      </View>
      <If when={searching()} else={<DocList onPicked={props.onPicked} />}>
        <SearchResults onPicked={props.onPicked} />
      </If>
    </View>
  );
}

function DocList(props: { onPicked: () => void }) {
  return (
    <Scroll class="flex-1 pb-2">
      <Each of={sorted(allDocs(), panel.sort())} key={(d) => d.id}>
        {(doc) => <DocRow doc={doc()} onPicked={props.onPicked} />}
      </Each>
    </Scroll>
  );
}

function DocRow(props: { doc: DocMeta; onPicked: () => void }) {
  const current = () => props.doc.id === currentDocId();
  const expanded = () => panel.expanded() === props.doc.id;
  const name = () => displayName(props.doc);
  const problem = () => (props.doc.problem ? problemText(props.doc.problem) : null);
  const sub = () => problem() ?? (props.doc.title && props.doc.title !== props.doc.name ? `${props.doc.name} · ${timeLabel(props.doc.updatedAt)}` : timeLabel(props.doc.updatedAt));
  const open = () => {
    if (!current()) requestLibrary({ kind: "open", id: props.doc.id });
    props.onPicked();
  };
  return (
    <View>
      <View class="flex-row items-center pr-1" classList={{ "bg-pressed": current() }}>
        <View
          testID={`doc-${props.doc.id}`}
          role="button"
          accessibilityLabel={problem() ? `${name()}（${problem()}）` : name()}
          accessibilityState={{ selected: current() }}
          onPress={open}
          class="min-h-11 min-w-0 flex-1 justify-center py-1.5 pl-3 pr-1 hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Text style={{ numberOfLines: 1 }} class="text-[13px] leading-5" classList={{ "font-medium text-primary": current(), "text-foreground": !current() && !problem(), "text-faint": !!problem() }}>
            {name() || "未命名"}
          </Text>
          <Text style={{ numberOfLines: 1 }} class="text-[11px] leading-4" classList={{ "text-faint": !problem(), "text-warn": !!problem() }}>
            {sub()}
          </Text>
        </View>
        <IconButton testID={`doc-more-${props.doc.id}`} icon="ellipsis" label={`「${name()}」的更多操作`} active={expanded()} onPress={() => panel.expanded.set(expanded() ? null : props.doc.id)} />
      </View>
      <If when={expanded()}>
        <View class="flex-row flex-wrap gap-1 px-2 pb-2 pt-1">
          <Button testID="doc-rename" label="重命名" onPress={() => panel.renaming.set(props.doc)} />
          <If when={current()}>
            <Button testID="doc-history" label="版本历史" onPress={() => historyOpen.set(true)} />
          </If>
          <Button testID="doc-delete" label="删除" onPress={() => panel.deleting.set(props.doc)} />
        </View>
      </If>
    </View>
  );
}

function summary(found: { query: string; result: SearchResult } | null): string {
  if (!found) return "正在搜索…";
  const { query, result } = found;
  if (result.hits.length === 0) return `没有找到「${query}」`;
  return `${result.docs} 篇文档里找到${result.capped ? "（只列出前 100 处）" : ""}`;
}

function SearchResults(props: { onPicked: () => void }) {
  const titleOf = (id: string) => {
    const doc = allDocs().find((d) => d.id === id);
    return doc ? displayName(doc) || "未命名" : "（已删除）";
  };
  const done = () => {
    const s = panel.search();
    return s.kind === "done" ? s : null;
  };
  return (
    <View class="flex-1">
      <Text testID="search-status" class="px-3 pb-1 text-[11px] text-faint">
        {summary(done())}
      </Text>
      <If when={done()}>
        {(found) => (
          <Scroll class="flex-1 pb-2">
            <Each of={found().result.hits} key="index">
              {(hit, index) => (
                <View
                  testID={`hit-${index()}`}
                  role="button"
                  accessibilityLabel={`${titleOf(hit().id)}：${hit().snippet}`}
                  onPress={() => {
                    requestLibrary({ kind: "open", id: hit().id, find: found().query });
                    props.onPicked();
                  }}
                  class="gap-0.5 px-3 py-1.5 hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Text style={{ numberOfLines: 1 }} class="text-[12px] font-medium leading-4 text-foreground">
                    {titleOf(hit().id)}
                  </Text>
                  <Text style={{ numberOfLines: 2 }} class="text-[12px] leading-4 text-muted-foreground">
                    {hit().snippet}
                  </Text>
                </View>
              )}
            </Each>
          </Scroll>
        )}
      </If>
    </View>
  );
}
