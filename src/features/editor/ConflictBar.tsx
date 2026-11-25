/**
 * 冲突提示，两种：这篇在别处（另一个标签页）存过、这里也有没存的修改，让用户选一边，另一边存进版本历史；
 * 或者这篇在别处删掉了，让用户选存成新文档还是放弃。都不静默覆盖、不静默丢。
 */
import { Text, View } from "nsh";
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
      say(`出错了：${e instanceof Error ? e.message : String(e)}`, "warn");
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
                <Text class="min-w-0 flex-1 select-text text-xs leading-5 text-warn">{`${elsewhereWords().changed}，和这里没存的修改冲突。选一边保留，另一边会存进版本历史。`}</Text>
                <Button testID="keep-mine" label="保留我的" onPress={() => choose(keepMine)} />
                <Button testID="take-theirs" label="载入外面的" onPress={() => choose(takeTheirs, props.onTheirs)} />
              </>
            }
          >
            <Text class="min-w-0 flex-1 select-text text-xs leading-5 text-warn">{`${elsewhereWords().deleted}。这里的内容还在：存成一篇新文档留下它，或者放弃。`}</Text>
            <Button
              testID="save-as-new"
              label="存成新文档"
              onPress={() => {
                receipt.set(null);
                requestLibrary({ kind: "rescue" });
              }}
            />
            <Button
              testID="abandon-deleted"
              label="放弃这篇"
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
