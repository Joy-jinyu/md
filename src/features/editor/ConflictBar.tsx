/**
 * 冲突提示，两种：这篇在别处（另一个标签页）存过、这里也有没存的修改，让用户选一边，另一边存进版本历史；
 * 或者这篇在别处删掉了，让用户选存成新文档还是放弃。都不静默覆盖、不静默丢。
 */
import { Text, View } from "nsh";
import { t } from "../../i18n";
import { elsewhereWords } from "../../store/backend";
import { keepMine, type SaveResult, saveState, takeTheirs } from "../../store/document";
import { Button } from "../../ui/button";
import { receipt, say } from "../library/receipt";
import { requestLibrary } from "../library/requests";

/** 选了一边没选成（被放弃的那边存不进版本历史）：冲突条还在，顶上说明原因。这篇在别处删了的话冲突条自己会换成删除的那种。 */
function choose(pick: () => Promise<SaveResult>, done?: () => void) {
  receipt.set(null);
  pick().then(
    (result) => {
      if (result.ok) return done?.();
      if (!result.error.deleted && saveState().kind === "conflict") say(result.error.detail, "warn");
    },
    (e: unknown) => {
      console.error("conflict choice failed", e);
      say(() => t(`出错了：${e instanceof Error ? e.message : String(e)}`, `Something went wrong: ${e instanceof Error ? e.message : String(e)}`), "warn");
    },
  );
}

/** `onTheirs`：选了「载入外面的」，编辑页该重新载入这一篇了。选了以后顶上那条「先选一边再切换」之类的回执也不再有用，一并清掉。 */
export function ConflictBar(props: { onTheirs: () => void }) {
  const conflict = () => {
    const s = saveState();
    return s.kind === "conflict" ? s : null;
  };
  return (
    <If when={conflict()}>
      {(c) => (
        <View testID="conflict" role="alert" class="flex-row flex-wrap items-center gap-2 bg-warn-tint px-5 py-2">
          <If
            when={c().deleted}
            else={
              <>
                <Text class="min-w-0 flex-1 select-text text-xs leading-5 text-warn">{t(`${elsewhereWords().changed}，和这里没存的修改冲突。选一边保留，另一边会存进版本历史。`, `${elsewhereWords().changed}. This conflicts with your unsaved changes. Choose which version to keep. The other will be saved in version history.`)}</Text>
                <Button testID="keep-mine" label={t("保留我的", "Keep mine")} onPress={() => choose(keepMine)} />
                <Button testID="take-theirs" label={t("载入外面的", "Load external version")} onPress={() => choose(takeTheirs, props.onTheirs)} />
              </>
            }
          >
            <Text class="min-w-0 flex-1 select-text text-xs leading-5 text-warn">{t(`${elsewhereWords().deleted}。这里的内容还在：存成一篇新文档留下它，或者放弃。`, `${elsewhereWords().deleted}. Save your changes as a new document, or discard them.`)}</Text>
            <Button
              testID="save-as-new"
              label={t("存成新文档", "Save as a new document")}
              onPress={() => {
                receipt.set(null);
                requestLibrary({ kind: "rescue" });
              }}
            />
            <Button
              testID="abandon-deleted"
              label={t("放弃这篇", "Discard this document")}
              onPress={() => {
                receipt.set(null);
                requestLibrary({ kind: "abandon" });
              }}
            />
          </If>
        </View>
      )}
    </If>
  );
}
