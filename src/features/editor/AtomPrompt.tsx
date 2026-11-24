/** 公式、Mermaid 的源码编辑框：插入新的，或改已有的。渲染要等 M4，这里只改源码。 */
import { signal, Text, View } from "nsh";
import { Input, insertContent, type RichEditorSession, setNodeAttribute } from "nsh/base";
import { Button } from "../../ui/button";
import type { AtomKind } from "./commands";

const KINDS: Record<AtomKind, { title: string; attr: string; placeholder: string; multiline: boolean }> = {
  mathBlock: { title: "公式块（LaTeX）", attr: "tex", placeholder: "E = mc^2", multiline: true },
  mathInline: { title: "行内公式（LaTeX）", attr: "tex", placeholder: "a^2 + b^2", multiline: false },
  diagram: { title: "Mermaid 图", attr: "code", placeholder: "graph TD\n  A --> B", multiline: true },
};

export const isAtomKind = (type: string): type is AtomKind => type in KINDS;

/** 取出节点里的源码。 */
export function atomSource(kind: AtomKind, attrs: Record<string, unknown> | undefined): string {
  const value = attrs?.[KINDS[kind].attr];
  return typeof value === "string" ? value : "";
}

export function createAtomPrompt(session: RichEditorSession) {
  /** `pos` 是要改的节点的位置；null 表示在光标处插入新的。 */
  const target = signal<{ kind: AtomKind; pos: number | null } | null>(null);
  const draft = signal("");
  let openedAt = 0;
  const open = (kind: AtomKind, pos: number | null, source: string) => {
    draft.set(source);
    openedAt = session.revision;
    target.set({ kind, pos });
  };
  const close = () => {
    target.set(null);
    setTimeout(() => session.focus(), 0);
  };
  /** 新插入时源码为空就不插；改已有的可以改成空。 */
  const apply = () => {
    const t = target();
    if (!t) return;
    const { attr } = KINDS[t.kind];
    if (t.pos !== null) session.run(setNodeAttribute(t.pos, attr, draft()));
    else if (draft().trim() !== "") session.run(insertContent({ type: t.kind, attrs: { [attr]: draft() } }));
    close();
  };
  return {
    target,
    draft,
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
        onChange={({ value }) => p.draft.set(value)}
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
      <View class="flex-row justify-end gap-1">
        <Button label="取消" onPress={p.close} />
        <Button label="应用" variant="primary" onPress={p.apply} />
      </View>
    </View>
  );
}
