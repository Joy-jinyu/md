/** 文档面板「⋯」里的两个对话框：重命名、删除前确认。放在编辑页最外层，切文档时不跟着侧栏重建。 */
import { effect, keymap, signal, Text, untracked, View } from "nsh";
import { Dialog, Input } from "nsh/base";
import { messageOf } from "../../doc/message";
import { displayName, renameDocument } from "../../store/library";
import { Button } from "../../ui/button";
import { returnFocusToEditor } from "../editor/ui-state";
import { panel } from "./panel-state";
import { requestLibrary } from "./requests";

const FIELD = "h-8 rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary";

/**
 * 重命名框开着时 Esc 关掉它：焦点在输入框里时，第一下 Esc 只让输入框失焦、对话框不关（2026-11-25 web host 实测），
 * 走应用级 keymap 一下就关。同 FindBar、设置对话框的 EscapeCloses。
 */
function EscapeCloses(props: { onEscape: () => void }) {
  keymap.bind("escape", props.onEscape, { when: "always" });
  return null;
}

function RenameDialog() {
  const draft = signal("");
  const problem = signal("");
  effect(() => {
    const doc = panel.renaming();
    untracked(() => {
      draft.set(doc?.name ?? "");
      problem.set("");
    });
  });
  const close = () => {
    panel.renaming.set(null);
    returnFocusToEditor();
  };
  const submit = async () => {
    const doc = panel.renaming();
    if (!doc) return;
    if (draft().trim() === "") return problem.set("名字不能是空的");
    try {
      await renameDocument(doc.id, draft());
      panel.expanded.set(null);
      close();
    } catch (e) {
      console.error("rename failed", e);
      problem.set(`没能改名：${messageOf(e)}`);
    }
  };
  return (
    <Dialog
      testID="rename"
      open={panel.renaming() !== null}
      animation="fade"
      accessibilityLabel="修改文库名"
      closeOnEscape
      closeOnBackdropPress
      onOpenChange={({ open }) => !open && close()}
      backdropClass="bg-scrim"
      class="mx-auto mt-32 w-full max-w-[400px] px-4"
    >
      <EscapeCloses onEscape={close} />
      <View class="gap-3 rounded-(--radius) border border-border bg-popover p-4">
        <Text class="text-sm font-medium text-strong">修改文库名</Text>
        <Text class="select-text text-xs leading-5 text-muted-foreground">文库用这个名字保存。另存为优先用正文标题命名；没有标题时用文库名。</Text>
        <Input
          testID="rename-input"
          autoFocus
          value={draft()}
          onChange={({ value }) => draft.set(value)}
          onSubmit={() => void submit()}
          submitBehavior="submit"
          accessibilityLabel="新文库名"
          autoCapitalize="none"
          autoCorrect={false}
          class={FIELD}
        />
        <If when={problem()}>{(text) => <Text class="select-text text-xs text-destructive">{text()}</Text>}</If>
        <View class="flex-row justify-end gap-1">
          <Button testID="rename-cancel" label="取消" onPress={close} />
          <Button testID="rename-confirm" label="保存文库名" variant="primary" onPress={() => void submit()} />
        </View>
      </View>
    </Dialog>
  );
}

function DeleteDialog() {
  const close = () => {
    panel.deleting.set(null);
    returnFocusToEditor();
  };
  return (
    <Dialog
      testID="delete-confirm"
      open={panel.deleting() !== null}
      animation="fade"
      accessibilityLabel="删除文档"
      closeOnEscape
      closeOnBackdropPress
      onOpenChange={({ open }) => !open && close()}
      backdropClass="bg-scrim"
      class="mx-auto mt-32 w-full max-w-[400px] px-4"
    >
      <If when={panel.deleting()}>
        {(doc) => (
          <View class="gap-3 rounded-(--radius) border border-border bg-popover p-4">
            <Text class="text-sm font-medium text-strong">删除「{displayName(doc()) || "未命名"}」？</Text>
            <Text class="select-text text-xs leading-5 text-muted-foreground">这篇文档和它的版本历史都会从这台设备上删掉，找不回来。要留一份的话，先打开它再另存为。</Text>
            <View class="flex-row justify-end gap-1">
              {/* 焦点给「取消」不给「删除这篇」：删了找不回来，回车、空格不该直接删 */}
              <Button testID="delete-cancel" label="取消" autoFocus onPress={close} />
              <Button
                testID="delete-now"
                label="删除这篇"
                variant="primary"
                onPress={() => {
                  requestLibrary({ kind: "remove", id: doc().id });
                  panel.expanded.set(null);
                  close();
                }}
              />
            </View>
          </View>
        )}
      </If>
    </Dialog>
  );
}

export function DocDialogs() {
  return (
    <>
      <RenameDialog />
      <DeleteDialog />
    </>
  );
}
