/** Cmd+K 的链接输入：编辑器 bubbleMenu 里一个地址框，应用 / 取消，光标在链接里时多一个「打开」。 */
import { signal, View } from "nsh";
import { chain, extendMarkRange, Input, insertContent, type RichEditorSession, setLink, unsetLink } from "nsh/base";
import { t } from "../../i18n";
import { Button } from "../../ui/button";
import { openLink } from "./links";

/** 链接输入的状态，`revision` 是编辑器的修订号（光标一动就变）。 */
export function createLinkPrompt(session: RichEditorSession, revision: () => number) {
  const open = signal(false);
  const draft = signal("");
  const href = () => {
    void revision();
    const value = (session.getAttributes("link") as { href?: unknown }).href;
    return typeof value === "string" ? value : "";
  };
  const inLink = () => {
    void revision();
    return session.isActive("link");
  };
  const show = () => {
    draft.set(href());
    open.set(true);
  };
  const close = () => {
    open.set(false);
    // 等这次按键处理完再还焦点：Web 上提交用的回车还没处理完，马上聚焦编辑器会把它当成换行
    setTimeout(() => session.focus(), 0);
  };
  /** 地址为空就去掉链接；有选区或在链接里就改地址；光标处什么都没有就插入地址本身作链接文字。 */
  const apply = () => {
    const url = draft().trim();
    const hasSelection = session.selection.anchor !== session.selection.head;
    if (!url) session.run(chain([extendMarkRange("link"), unsetLink()]));
    else if (inLink() || hasSelection) session.run(chain([extendMarkRange("link"), setLink({ href: url })]));
    else session.run(insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }));
    close();
  };
  return { isOpen: () => open(), draft, href, show, close, apply };
}

export type LinkPromptState = ReturnType<typeof createLinkPrompt>;

export function LinkPrompt(props: { prompt: LinkPromptState; onAnchor: (id: string) => boolean }) {
  const p = props.prompt;
  return (
    <View class="flex-row items-center gap-1 rounded-(--radius) border border-border bg-popover p-1">
      <Input
        ref={(node: { focus(): void }) => node.focus()}
        value={p.draft()}
        onChange={({ value }) => p.draft.set(value)}
        onSubmit={p.apply}
        submitBehavior="submit"
        placeholder="https://"
        accessibilityLabel={t("链接地址", "Link address")}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        class="h-7 w-[280px] rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary"
      />
      <Button label={t("应用", "Apply")} variant="primary" onPress={p.apply} />
      <If when={p.href() !== ""}>
        <Button label={t("打开", "Open")} accessibilityLabel={t("打开链接", "Open link")} onPress={() => void openLink(p.href(), props.onAnchor)} />
      </If>
      <Button label={t("取消", "Cancel")} onPress={p.close} />
    </View>
  );
}
