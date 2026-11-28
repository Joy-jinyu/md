/** 表格工具条：光标在表格里时贴在表格正上方，一排图标按钮：加行、删行、加列、删列、删表。 */
import { signal, View } from "nsh";
import type { RichEditorSession } from "nsh/base";
import { t } from "../../i18n";
import type { IconName } from "../../ui/icon";
import { IconButton } from "../../ui/icon-button";
import { COMMANDS } from "./commands";
import type { Rect } from "./selection";

const TABLE_COMMANDS = COMMANDS.filter((c) => c.group === "表格");

/** 命令 → 图标；名字（读屏、悬停提示）仍用命令表里的。 */
const ICON: Record<string, IconName> = {
  "table.rowBefore": "tableRowAbove",
  "table.rowAfter": "tableRowBelow",
  "table.deleteRow": "tableRowDelete",
  "table.columnBefore": "tableColumnLeft",
  "table.columnAfter": "tableColumnRight",
  "table.deleteColumn": "tableColumnDelete",
  "table.delete": "trash",
};

/** 工具条底边离表格上沿多远；表格上面留的空位（editor-classes 的 table mt-10）放得下 30 高的条再加这道缝。 */
const GAP = 4;
const BAR_HEIGHT = 30;

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
 * 放进 RichEditor 的 contentLayer，贴在表格正上方、和表格左边对齐（2026-11-28 用户要求：交互就在表格附近，用图标放得下）。
 * 表格上面本来就留着这道空位，工具条出现、消失都不挡上一段、不让正文跳动。
 */
export function TableBar(props: { bar: TableBarState; session: RichEditorSession; at: { rect: Rect } | null }) {
  return (
    <If when={props.bar.active() ? props.at : null}>
      {(at) => (
        <View
          testID="table-bar"
          accessibilityLabel={t("表格", "Table")}
          style={{ left: at().rect.x, top: at().rect.y - BAR_HEIGHT - GAP, height: BAR_HEIGHT }}
          class="absolute flex-row items-center gap-0.5 rounded-(--radius) border border-border bg-popover px-0.5 shadow-sm"
        >
            <Each of={TABLE_COMMANDS} key={(c) => c.id}>
              {(c) => (
                <IconButton
                  testID={`table-${c().id}`}
                  icon={ICON[c().id] ?? "ellipsis"}
                  label={c().label}
                  compact
                  onPress={() => {
                    const rich = c().rich;
                    if (rich) props.session.run(rich);
                    props.session.focus();
                  }}
                />
              )}
            </Each>
        </View>
      )}
    </If>
  );
}
