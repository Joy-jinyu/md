/** 源码编辑框，和接在它上面的查找引擎（用编辑器自带的查找）。源码视图和只能用源码打开的文档共用。 */
import { keymap, signal, View } from "nsh";
import { Editor, type EditorCommand, type EditorRef, type EditorSearch } from "nsh/base";
import { SOURCE_MOVE_KEYS } from "../../platform";
import { type FindEngine, type FindResult, NO_RESULT } from "./find";

/** 编辑器的查找最多数到这么多处（nsh 的 EditorSearchResult.count 上限）。 */
const EDITOR_MATCH_CAP = 10_000;

/** 源码这一边的查找和对编辑框的引用。先建好，等 SourcePane 挂上来才真正能用。 */
export function createSourceFind() {
  const search = signal<EditorSearch | undefined>(undefined);
  const result = signal<FindResult>(NO_RESULT);
  let ref: EditorRef | null = null;
  const engine: FindEngine = {
    search(q) {
      search.set(q && q.query !== "" ? { ...q } : undefined);
      if (!q || q.query === "") result.set(NO_RESULT);
    },
    result: () => result(),
    next: () => ref?.run("findNext"),
    previous: () => ref?.run("findPrevious"),
    replace: (text) => ref?.replace(text),
    replaceAll: async (text) => (await ref?.replaceAll(text))?.count ?? 0,
  };
  return {
    engine,
    search,
    ref: () => ref,
    attach: (next: EditorRef | null) => {
      ref = next;
    },
    report: (r: { count: number; current?: number | null; error?: string | null }) =>
      result.set({ count: r.count, current: r.current ?? null, capped: r.count >= EDITOR_MATCH_CAP, error: r.error ?? null }),
  };
}

export type SourceFind = ReturnType<typeof createSourceFind>;

/** 文末还能再往上滚多少行。默认是一整屏，滚到底只剩一片空白（2026-11-24 用户反馈）；留几行让最后一行不贴着窗口底边就够。 */
const SCROLL_PAST_END_ROWS = 6;

/** 行首行尾这些键只在焦点在源码编辑框里时接：查找框里的 Home / End 归输入框自己。返回解绑函数。 */
function bindMoveKeys(find: SourceFind): () => void {
  const handlers = Object.fromEntries(Object.entries(SOURCE_MOVE_KEYS).map(([key, name]) => [key, () => void find.ref()?.run(name as EditorCommand)]));
  return keymap.bind(handlers, { when: "always" });
}

export function SourcePane(props: { text: string; find: SourceFind; onChange: (text: string) => void; onReady?: (ref: EditorRef) => void }) {
  let unbind: (() => void) | null = null;
  const release = () => {
    unbind?.();
    unbind = null;
  };
  return (
    <View class="flex-1">
      <Editor
        testID="source-editor"
        ref={(ref: EditorRef) => {
          props.find.attach(ref);
          props.onReady?.(ref);
        }}
        defaultValue={props.text}
        onChange={({ value }) => props.onChange(value)}
        search={props.find.search()}
        onSearchChange={({ result }) => props.find.report(result)}
        onFocus={() => {
          release();
          unbind = bindMoveKeys(props.find);
        }}
        onBlur={release}
        language="markdown"
        autoFocus
        softWrap
        lineNumbers={false}
        fontSize={14}
        lineHeight={22}
        accessibilityLabel="Markdown 源码"
        // 编辑框占满整宽，滚动条才贴着窗口右边；限宽居中做在文字区上。
        // 上边留白和所见即所得的正文列一样（EDITOR_CLASSES.content 的 pt-10），切换时第一行不跳
        classes={{ content: "mx-auto w-full max-w-[860px] pt-10" }}
        scrollBeyondLastLine={SCROLL_PAST_END_ROWS}
        class="flex-1"
      />
    </View>
  );
}
