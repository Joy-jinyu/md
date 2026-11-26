/** 侧栏的「大纲」页：顶层标题按级别缩进，光标所在的那一节标出来，点一下跳过去。 */
import { Scroll, Text, View } from "nsh";
import { t } from "../../i18n";
import type { HeadingEntry } from "./outline";
import { SIDE_LIST, SIDE_ROW, SIDE_TEXT } from "./sidebar-style";

/** 每深一级多缩进多少（点）。 */
const INDENT = 12;

export function OutlinePanel(props: { headings: HeadingEntry[]; current: number; onJump: (index: number) => void }) {
  return (
    <View testID="outline" accessibilityLabel={t("大纲", "Outline")} class="flex-1">
      <If when={props.headings.length > 0} else={<Text class={`pt-1 ${SIDE_TEXT}`}>{t("还没有标题", "No headings yet")}</Text>}>
        <Scroll class="flex-1">
          <View class={SIDE_LIST}>
            <Each of={props.headings} key={(h) => `${h.pos}:${h.text}`}>
              {(h, index) => (
                <View
                  testID={`outline-${index()}`}
                  role="button"
                  accessibilityLabel={h().text}
                  accessibilityState={{ selected: index() === props.current }}
                  onPress={() => props.onJump(index())}
                  class={`min-h-7 justify-center ${SIDE_ROW}`}
                  classList={{ "bg-pressed": index() === props.current, "hover:bg-hover": index() !== props.current }}
                >
                  <Text
                    style={{ numberOfLines: 1, paddingLeft: (h().level - 1) * INDENT }}
                    class="text-[13px] leading-5"
                    classList={{ "font-semibold text-strong": index() === props.current, "text-muted-foreground": index() !== props.current }}
                  >
                    {h().text || t("（空标题）", "(Empty heading)")}
                  </Text>
                </View>
              )}
            </Each>
          </View>
        </Scroll>
      </If>
    </View>
  );
}
