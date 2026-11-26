/** 表格工具条：光标在表格里时出现在顶栏里，加行、删行、加列、删列、删表。 */
import { signal, View } from "nsh";
import type { RichEditorSession } from "nsh/base";
import { t } from "../../i18n";
import { Button } from "../../ui/button";
import { COMMANDS } from "./commands";

const TABLE_COMMANDS = COMMANDS.filter((c) => c.group === "表格");

export function createTableBar(session: RichEditorSession) {
  const active = signal(false);
  /** 在编辑器每次修订后调。 */
  const sync = () => {
    const next = session.isActive("table");
    if (next !== active()) active.set(next);
  };
  return { active, sync };
}

export type TableBarState = ReturnType<typeof createTableBar>;

/**
 * 放在顶栏里，不浮在正文上：贴在表格上沿会盖住表格上面一段，选中格子里的字时还和格式条叠在一起（2026-11-24 用户反馈）；
 * 浮在编辑区底部又会在表格靠近窗口底边时盖住表格自己（同日实测）。顶栏里不挡任何正文，也不让正文跳动。
 */
export function TableBar(props: { bar: TableBarState; session: RichEditorSession }) {
  return (
    <If when={props.bar.active()}>
      <View testID="table-bar" accessibilityLabel={t("表格", "Table")} class="flex-row items-center rounded-(--radius) bg-secondary">
        <Each of={TABLE_COMMANDS} key={(c) => c.id}>
          {(c) => (
            <Button
              testID={`table-${c().id}`}
              label={c().label}
              onPress={() => {
                const rich = c().rich;
                if (rich) props.session.run(rich);
                props.session.focus();
              }}
            />
          )}
        </Each>
      </View>
    </If>
  );
}
