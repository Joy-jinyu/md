/**
 * 选中一张图片时的操作条：第一行宽度（25 / 50 / 75 / 100% 或原始大小），第二行对齐（左 / 中 / 右）、替代文字、删除；外链图片多一个「转存到本地」。
 * 链接里的图片没有宽度和对齐（见 images.ts 的 `canResize`）。同样的操作在命令面板里也有（commands.ts 的图片命令），键盘也能用。
 */
import { effect, keymap, signal, Text, untracked, View } from "nsh";
import { Input, type RichEditorSession } from "nsh/base";
import { t } from "../../i18n";
import { canTransfer } from "../../store/backend";
import { Button } from "../../ui/button";
import { altEditRequest, canResize, deleteImage, isExternalSrc, selectedImage, setImageAttr, transferImage } from "./images";

const WIDTHS = ["25%", "50%", "75%", "100%"];
const ALIGNS = [
  { value: "left", get label() { return t("左", "Left"); }, get name() { return t("靠左", "Align left"); } },
  { value: "center", get label() { return t("中", "Center"); }, get name() { return t("居中", "Center"); } },
  { value: "right", get label() { return t("右", "Right"); }, get name() { return t("靠右", "Align right"); } },
];

/** 当前这一项：字前加勾、读屏名后加「当前」，不只靠字的颜色。 */
const current = (on: boolean, label: string) => (on ? `✓ ${label}` : label);
const currentName = (on: boolean, name: string) => (on ? t(`${name}（当前）`, `${name} (current)`) : name);

/** 替代文字输入框开着时 Esc 收起它。输入框自己的 onKeyDown 收不到 Esc（同 FindBar 的 EscapeCloses）。 */
function EscapeCancels(props: { onEscape: () => void }) {
  keymap.bind("escape", props.onEscape, { when: "always" });
  return null;
}

export function ImageBar(props: { session: RichEditorSession; revision: () => number }) {
  const s = props.session;
  const editingAlt = signal(false);
  const draft = signal("");
  const attr = (name: string) => {
    void props.revision();
    const at = selectedImage(s);
    const v = at === null ? null : s.nodeAt(at)?.attrs?.[name];
    return v === null || v === undefined ? "" : String(v);
  };
  const resizable = () => {
    void props.revision();
    return canResize(s);
  };
  // 等这次按键处理完再还焦点：替代文字框里提交用的回车还没处理完，马上聚焦编辑器会把它当成换行（Web 实测，同 LinkPrompt）
  const refocus = () => setTimeout(() => s.focus(), 0);
  const set = (name: "width" | "align" | "alt", value: string | null) => {
    setImageAttr(s, name, value);
    refocus();
  };
  const remove = () => {
    deleteImage(s);
    s.focus();
  };
  const openAlt = () => {
    draft.set(attr("alt"));
    editingAlt.set(true);
  };
  const applyAlt = () => {
    editingAlt.set(false);
    set("alt", draft().trim());
  };
  const cancelAlt = () => {
    editingAlt.set(false);
    refocus();
  };
  effect(() => {
    if (!altEditRequest()) return;
    untracked(() => {
      altEditRequest.set(false);
      openAlt();
    });
  });
  return (
    <View testID="image-bar" accessibilityLabel={t("图片操作", "Image actions")} class="max-w-[360px] gap-1 rounded-(--radius) border border-border bg-popover p-1">
      <If
        when={resizable()}
        else={<Text class="px-2 py-1 text-[12px] text-muted-foreground">{t("链接里的图片不能调大小和对齐（写成 Markdown 读不回来）", "Linked images cannot be resized or aligned without losing the link in Markdown.")}</Text>}
      >
        <View class="flex-row flex-wrap items-center">
          <Each of={WIDTHS} key={(w) => w}>
            {(w) => (
              <Button
                testID={`image-width-${w()}`}
                label={current(attr("width") === w(), w())}
                accessibilityLabel={currentName(attr("width") === w(), t(`宽度 ${w()}`, `Width ${w()}`))}
                active={attr("width") === w()}
                onPress={() => set("width", w())}
              />
            )}
          </Each>
          <Button
            testID="image-width-natural"
            label={current(attr("width") === "", t("原始", "Original"))}
            accessibilityLabel={currentName(attr("width") === "", t("原始大小", "Original size"))}
            active={attr("width") === ""}
            onPress={() => set("width", null)}
          />
        </View>
      </If>
      <View class="flex-row flex-wrap items-center">
        <If when={resizable()}>
          <Each of={ALIGNS} key={(a) => a.value}>
            {(a) => (
              <Button
                testID={`image-align-${a().value}`}
                label={current(attr("align") === a().value, a().label)}
                accessibilityLabel={currentName(attr("align") === a().value, a().name)}
                active={attr("align") === a().value}
                onPress={() => set("align", attr("align") === a().value ? null : a().value)}
              />
            )}
          </Each>
          <View class="mx-1 h-4 w-px bg-border" />
        </If>
        <Button testID="image-alt" label={t("替代文字", "Alt text")} accessibilityLabel={t("编辑替代文字", "Edit alt text")} onPress={openAlt} />
        <If when={canTransfer() && isExternalSrc(attr("src"))}>
          <Button testID="image-bar-transfer" label={t("转存到本地", "Save a local copy")} onPress={() => void transferImage(s, attr("src").trim())} />
        </If>
        <Button testID="image-delete" label={t("删除", "Delete")} accessibilityLabel={t("删除图片", "Delete image")} onPress={remove} />
      </View>
      <If when={editingAlt()}>
        <View class="flex-row items-center gap-1">
          <EscapeCancels onEscape={cancelAlt} />
          <Input
            ref={(node: { focus(): void }) => node.focus()}
            value={draft()}
            onChange={({ value }) => draft.set(value)}
            onSubmit={applyAlt}
            submitBehavior="submit"
            placeholder={t("图片说明（读屏和图片显示不出来时用）", "Image description for screen readers or when the image cannot be displayed")}
            accessibilityLabel={t("替代文字", "Alt text")}
            class="h-7 min-w-0 flex-1 rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary"
          />
          <Button label={t("应用", "Apply")} variant="primary" accessibilityLabel={t("应用替代文字", "Apply alt text")} onPress={applyAlt} />
        </View>
      </If>
      <If when={attr("alt") !== "" && !editingAlt()}>
        <Text style={{ numberOfLines: 1 }} class="px-2 text-[12px] text-muted-foreground">{t(`替代文字：${attr("alt")}`, `Alt text: ${attr("alt")}`)}</Text>
      </If>
    </View>
  );
}
