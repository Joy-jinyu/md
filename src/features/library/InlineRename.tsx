/**
 * macOS 文库里原地改名（DESIGN.md「macOS 原地改名」）：文件名那一处换成输入框，选中扩展名之前的部分。
 * 回车、点到别处、输入框被收起（关侧栏、切页签、切视图）都算提交，Esc 放弃。网页仍用改名对话框。
 */
import { t } from "../../i18n";
import { cleanup, type InputRef, keymap, signal } from "nsh";
import { Input } from "nsh/base";
import { DOC_EXT } from "../../doc/doc-ext";
import { messageOf } from "../../doc/message";
import type { DocMeta } from "../../store/document-store";
import { renameDocument } from "../../store/library";
import { returnFocusToEditor } from "../editor/ui-state";
import { panel } from "./panel-state";
import { say } from "./receipt";

/** 正开着的改名框怎么提交。点列表里别的行不会让输入框失焦（行不接焦点，macOS 窗口实测），行被按下时先调它。 */
let active: (() => Promise<boolean>) | null = null;

/** 有正在改的名字就先提交；改名没成（重名、空名字）时是 false，调用方别接着换文档。 */
export const settleRename = (): Promise<boolean> => active?.() ?? Promise.resolve(true);

type Trigger = "enter" | "blur" | "unmount";

export function InlineRename(props: { doc: DocMeta; class: string }) {
  const file = props.doc.id.slice(props.doc.id.lastIndexOf("/") + 1);
  const stemLength = file.length - (DOC_EXT.exec(file)?.[0].length ?? 0);
  const draft = signal(file);
  /** 一开始选中扩展名之前的部分；用户一动就交还给输入框自己管。 */
  const initialRange = signal<{ start: number; end: number } | undefined>({ start: 0, end: stemLength });
  let input: InputRef | undefined;
  /** 进行中的那次提交：回车后的失焦、点别的行再提交一次都等它，不重复改名。 */
  let pending: Promise<boolean> | null = null;
  let closed = false;
  const mine = () => commit("blur");
  const close = (refocusEditor: boolean) => {
    closed = true;
    if (active === mine) active = null;
    if (panel.renaming()?.id === props.doc.id) panel.renaming.set(null);
    if (refocusEditor) returnFocusToEditor();
  };
  /** 没改成：回执说原因。回车提交的留着输入框接着改；失焦的不抢焦点；被收起的直接收掉。 */
  const fail = (message: string, how: Trigger) => {
    say(() => message, "warn");
    if (how === "unmount") close(false);
    else if (how === "enter") input?.focus();
    return false;
  };
  const run = async (how: Trigger): Promise<boolean> => {
    const stem = draft().trim().replace(DOC_EXT, "");
    if (stem === "") return fail(t("名字不能是空的", "Enter a name."), how);
    if (stem !== props.doc.name) {
      try {
        await renameDocument(props.doc.id, stem);
      } catch (e) {
        console.error("rename failed", e);
        return fail(t(`没能改名：${messageOf(e)}`, `Could not rename: ${messageOf(e)}`), how);
      }
    }
    panel.expanded.set(null);
    close(how !== "unmount");
    return true;
  };
  function commit(how: Trigger): Promise<boolean> {
    if (closed) return Promise.resolve(true);
    pending ??= run(how).finally(() => {
      pending = null;
    });
    return pending;
  }
  active = mine;
  // 提交进行中按 Esc 不算放弃：文件可能已经改了名
  keymap.bind("escape", () => {
    if (!pending) close(true);
  }, { when: "always" });
  cleanup(() => void commit("unmount"));
  return (
    <Input
      testID="rename-input"
      ref={(node) => { input = node; }}
      autoFocus
      selectedRange={initialRange()}
      value={draft()}
      onChange={({ value }) => {
        draft.set(value);
        initialRange.set(undefined);
      }}
      onSubmit={() => void commit("enter")}
      onBlur={() => void commit("blur")}
      submitBehavior="submit"
      accessibilityLabel={t("新文件名", "New file name")}
      autoCapitalize="none"
      autoCorrect={false}
      class={`min-w-0 flex-1 rounded-(--radius-sm) border border-primary bg-background px-1 text-foreground ${props.class}`}
    />
  );
}
