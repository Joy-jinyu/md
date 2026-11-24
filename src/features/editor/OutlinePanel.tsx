/** 大纲侧栏：顶层标题按级别缩进，光标所在的那一节标出来，点一下跳过去。 */
import { Scroll, Text, View } from "nsh";
import type { HeadingEntry } from "./outline";

/** 每深一级多缩进多少（点）。 */
const INDENT = 12;

export function OutlinePanel(props: { headings: HeadingEntry[]; current: number; onJump: (index: number) => void }) {
  return (
    <View testID="outline" accessibilityLabel="大纲" class="w-[240px] border-r border-border bg-card">
      <If when={props.headings.length > 0} else={<Text class="px-4 py-3 text-xs text-faint">还没有标题</Text>}>
        <Scroll class="flex-1 py-2">
          <Each of={props.headings} key={(h) => `${h.pos}:${h.text}`}>
            {(h, index) => (
              <View
                testID={`outline-${index()}`}
                role="button"
                accessibilityLabel={h().text}
                onPress={() => props.onJump(index())}
                style={{ paddingLeft: 16 + (h().level - 1) * INDENT }}
                class="min-h-7 justify-center pr-3 hover:bg-hover active:bg-pressed"
              >
                <Text
                  style={{ numberOfLines: 1 }}
                  class="text-[13px] leading-5"
                  classList={{ "text-primary font-medium": index() === props.current, "text-muted-foreground": index() !== props.current }}
                >
                  {h().text || "（空标题）"}
                </Text>
              </View>
            )}
          </Each>
        </Scroll>
      </If>
    </View>
  );
}
