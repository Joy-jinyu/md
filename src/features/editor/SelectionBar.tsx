/** 光标旁的三种小条：选中文字时的格式条、光标在链接里时的链接卡片、选中能改源码的原子块（公式、图、front matter、HTML 块）时的操作条。 */
import { signal, Text, View } from "nsh";
import { chain, command, extendMarkRange, type RichEditorSession, unsetLink } from "nsh/base";
import { t } from "../../i18n";
import { Button } from "../../ui/button";
import { atomSource, type AtomPromptState, isAtomKind } from "./AtomPrompt";
import { commandById } from "./commands";
import { openLink } from "./links";
import type { LinkPromptState } from "./LinkPrompt";
import { selectionRange } from "./selection";

export type BarMode = "selection" | "link" | "atom" | "image" | null;

/** `typing`：这次修订是打字带来的。打字经过链接（比如刚打完一个网址）时不出链接卡片，它会盖住下一行。 */
function readMode(session: RichEditorSession, typing: boolean): BarMode {
  const { from, to, type } = selectionRange(session);
  if (type === "node") {
    const node = session.nodeAt(from);
    if (node?.type === "image") return "image";
    return node && isAtomKind(node.type) ? "atom" : null;
  }
  if (from !== to) return session.isActive("codeBlock") ? null : "selection";
  return !typing && session.isActive("link") ? "link" : null;
}

/** 现在该出哪一种小条；`sync` 在编辑器每次修订后调。 */
export function createSelectionBar(session: RichEditorSession) {
  const mode = signal<BarMode>(null);
  const sync = (typing: boolean) => {
    const next = readMode(session, typing);
    if (next !== mode()) mode.set(next);
  };
  return { mode, sync };
}

const BAR = "flex-row items-center rounded-(--radius) border border-border bg-popover p-1";

/** 各家编辑器通用的记号：B 粗、I 斜、S 加删除线、等宽的 </>、带高亮底的 A。 */
const MARKS = [
  { label: "B", look: "text-[13px] font-bold", name: "bold", id: "format.bold" },
  { label: "I", look: "text-[13px] italic", name: "italic", id: "format.italic" },
  { label: "S", look: "text-[13px] line-through", name: "strike", id: "format.strike" },
  { label: "</>", look: "font-mono", name: "code", id: "format.code" },
  { label: "A", look: "rounded-(--radius-sm) bg-warn-tint px-1 text-[13px]", name: "highlight", id: "format.highlight" },
];

const BLOCKS = [
  { get label() { return t("正文", "Body"); }, id: "block.paragraph", active: (s: RichEditorSession) => s.isActive("paragraph") },
  ...[1, 2, 3].map((level) => ({ label: `H${level}`, id: `block.h${level}`, active: (s: RichEditorSession) => s.isActive("heading", { level }) })),
];

/** 选中文字时的格式条：粗、斜、删、码、亮、链，和把这一块转成正文或标题。 */
export function FormatBar(props: { session: RichEditorSession; revision: () => number; onLink: () => void }) {
  const s = props.session;
  const on = (test: () => boolean) => {
    void props.revision();
    return test();
  };
  const run = (id: string) => {
    const c = commandById(id);
    if (c.rich) s.run(c.rich);
    s.focus();
  };
  return (
    <View testID="format-bar" accessibilityLabel={t("格式", "Formatting")} class={BAR}>
      <Each of={MARKS} key={(m) => m.id}>
        {(m) => (
          <Button
            testID={`bar-${m().name}`}
            label={m().label}
            labelClass={m().look}
            accessibilityLabel={commandById(m().id).label}
            active={on(() => s.isActive(m().name))}
            onPress={() => run(m().id)}
          />
        )}
      </Each>
      <Button testID="bar-link" label={t("链接", "Link")} accessibilityLabel={t("链接", "Link")} active={on(() => s.isActive("link"))} onPress={props.onLink} />
      <View class="mx-1 h-4 w-px bg-border" />
      <Each of={BLOCKS} key={(b) => b.id}>
        {(b) => (
          <Button
            testID={`bar-${b().id}`}
            label={b().label}
            accessibilityLabel={t(`转成${commandById(b().id).label}`, `Turn into ${commandById(b().id).label}`)}
            active={on(() => b().active(s))}
            onPress={() => run(b().id)}
          />
        )}
      </Each>
    </View>
  );
}

/** 光标停在链接里时的卡片：地址，和打开、编辑、取消链接。 */
export function LinkCard(props: { session: RichEditorSession; link: LinkPromptState; onAnchor: (id: string) => boolean }) {
  const unlink = () => {
    props.session.run(chain([extendMarkRange("link"), unsetLink()]));
    props.session.focus();
  };
  return (
    <View testID="link-card" accessibilityLabel={t("链接", "Link")} class={`${BAR} gap-1`}>
      <Text style={{ numberOfLines: 1 }} class="max-w-[240px] select-text px-2 text-xs text-muted-foreground">
        {props.link.href()}
      </Text>
      <Button label={t("打开", "Open")} accessibilityLabel={t("打开链接", "Open link")} onPress={() => void openLink(props.link.href(), props.onAnchor)} />
      <Button label={t("编辑", "Edit")} accessibilityLabel={t("编辑链接", "Edit link")} onPress={props.link.show} />
      <Button label={t("取消链接", "Remove link")} onPress={unlink} />
    </View>
  );
}

/** 选中公式、Mermaid 图、front matter、HTML 块或定义行时的操作条。 */
export function AtomBar(props: { session: RichEditorSession; atom: AtomPromptState }) {
  const s = props.session;
  const edit = () => {
    const { from } = selectionRange(s);
    const node = s.nodeAt(from);
    if (node && isAtomKind(node.type)) props.atom.edit(node.type, from, atomSource(node.type, node.attrs));
  };
  const remove = () => {
    s.run(command("deleteSelection"));
    s.focus();
  };
  return (
    <View testID="atom-bar" accessibilityLabel={t("块操作", "Block actions")} class={BAR}>
      <Button label={t("编辑", "Edit")} accessibilityLabel={t("编辑源码", "Edit source")} onPress={edit} />
      <Button label={t("删除", "Delete")} onPress={remove} />
    </View>
  );
}
