/** 公式、Mermaid、front matter、透传块（HTML 块、定义行）的源码编辑框：插入新的，或改已有的。 */
import { signal, Text, View } from "nsh";
import { deleteRange, Input, insertContent, type RichEditorSession, setNodeAttribute } from "nsh/base";
import { Button } from "../../ui/button";
import type { AtomKind } from "./commands";
import { MATH_FENCE_LINE } from "./node-views";

/** `dropWhenEmpty`：改成空的就删掉这一块（空的 front matter、空的透传块写出来只剩分隔符或空行）。 */
const KINDS: Record<AtomKind, { title: string; attr: string; placeholder: string; multiline: boolean; dropWhenEmpty?: boolean }> = {
  mathBlock: { title: "公式块（LaTeX）", attr: "tex", placeholder: "E = mc^2", multiline: true },
  mathInline: { title: "行内公式（LaTeX）", attr: "tex", placeholder: "a^2 + b^2", multiline: false },
  diagram: { title: "Mermaid 图", attr: "code", placeholder: "graph TD\n  A --> B", multiline: true },
  frontmatter: { title: "Front matter（YAML）", attr: "yaml", placeholder: "title: 标题", multiline: true, dropWhenEmpty: true },
  rawBlock: { title: "原文（HTML 块、定义行）", attr: "src", placeholder: "<div>…</div>", multiline: true, dropWhenEmpty: true },
};

export const isAtomKind = (type: string): type is AtomKind => type in KINDS;

/** front matter 里单独一行 `---` / `...` 会在保存时提前收尾，后面的 YAML 成了正文。 */
const YAML_END_LINE = /^(?:---|\.\.\.)[ \t]*$/m;

/** 源码不能原样写回 Markdown 的原因（会把文档切开）；能写回时是 null。 */
function rejectReason(kind: AtomKind, source: string): string | null {
  if (kind === "frontmatter" && YAML_END_LINE.test(source)) return "Front matter 里不能有单独一行的 --- 或 ...（保存时会被当成结尾，后面的内容变成正文）";
  if (kind === "mathBlock" && MATH_FENCE_LINE.test(source)) return "公式里不能有以 $$ 开头的行（保存时会被当成公式的结尾）";
  return null;
}

/** 取出节点里的源码。 */
export function atomSource(kind: AtomKind, attrs: Record<string, unknown> | undefined): string {
  const value = attrs?.[KINDS[kind].attr];
  return typeof value === "string" ? value : "";
}

export function createAtomPrompt(session: RichEditorSession) {
  /** `pos` 是要改的节点的位置；null 表示在光标处插入新的。 */
  const target = signal<{ kind: AtomKind; pos: number | null } | null>(null);
  const draft = signal("");
  /** 应用时被拒的原因，改了源码就清掉。 */
  const error = signal<string | null>(null);
  let openedAt = 0;
  const open = (kind: AtomKind, pos: number | null, source: string) => {
    draft.set(source);
    error.set(null);
    openedAt = session.revision;
    target.set({ kind, pos });
  };
  const close = () => {
    target.set(null);
    setTimeout(() => session.focus(), 0);
  };
  /** 新插入时源码为空就不插；改已有的可以改成空（front matter、透传块改成空就删掉）。 */
  const apply = () => {
    const t = target();
    if (!t) return;
    const { attr, dropWhenEmpty } = KINDS[t.kind];
    const reason = rejectReason(t.kind, draft());
    if (reason) return error.set(reason);
    const empty = draft().trim() === "";
    if (t.pos !== null && empty && dropWhenEmpty) session.run(deleteRange({ from: t.pos, to: t.pos + 1 }));
    else if (t.pos !== null) session.run(setNodeAttribute(t.pos, attr, draft()));
    else if (!empty) session.run(insertContent({ type: t.kind, attrs: { [attr]: draft() } }));
    close();
  };
  return {
    target,
    draft,
    error,
    /** 改源码：清掉上次被拒的原因。 */
    edited: (value: string) => {
      draft.set(value);
      if (error()) error.set(null);
    },
    isOpen: () => target() !== null,
    /** 打开那一刻编辑器的修订号：之后文档再变，编辑框记的位置就可能不对了。 */
    openedAt: () => openedAt,
    insert: (kind: AtomKind) => open(kind, null, ""),
    edit: (kind: AtomKind, pos: number, source: string) => open(kind, pos, source),
    close,
    apply,
  };
}

export type AtomPromptState = ReturnType<typeof createAtomPrompt>;

export function AtomPrompt(props: { prompt: AtomPromptState; kind: AtomKind }) {
  const p = props.prompt;
  const spec = KINDS[props.kind];
  return (
    <View testID="atom-prompt" class="w-[360px] gap-2 rounded-(--radius) border border-border bg-popover p-2">
      <Text class="text-[11px] text-muted-foreground">{spec.title}</Text>
      <Input
        ref={(node: { focus(): void }) => node.focus()}
        value={p.draft()}
        onChange={({ value }) => p.edited(value)}
        onSubmit={p.apply}
        multiline={spec.multiline}
        submitBehavior={spec.multiline ? "newline" : "submit"}
        placeholder={spec.placeholder}
        accessibilityLabel={spec.title}
        autoCapitalize="none"
        autoCorrect={false}
        class="rounded-(--radius-sm) border border-input bg-background px-2 py-1 font-mono text-[13px] leading-5 text-foreground placeholder:text-faint focus:border-primary"
        classList={{ "h-[160px]": spec.multiline, "h-7": !spec.multiline }}
      />
      <If when={p.error()}>
        {(message) => (
          <Text testID="atom-error" role="alert" class="select-text text-[12px] leading-[18px] text-destructive">
            {message()}
          </Text>
        )}
      </If>
      <View class="flex-row justify-end gap-1">
        <Button label="取消" onPress={p.close} />
        <Button label="应用" variant="primary" onPress={p.apply} />
      </View>
    </View>
  );
}
