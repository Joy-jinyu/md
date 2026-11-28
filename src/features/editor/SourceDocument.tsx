/** 源码方式编辑（超大文档、读不进富文本编辑器时）：整篇 Markdown 放进等宽编辑器，改动按原来的 BOM 和换行风格存回。 */
import { type JSX, signal, View } from "nsh";
import { joinEndings, splitEndings } from "../../doc/line-endings";
import { markChanged } from "../../store/document";
import { Notice } from "../../ui/notice";
import { CommandPalette } from "./CommandPalette";
import { formatCounts } from "./counts";
import { type CommandContext, runCommand } from "./commands";
import { createFindState, FindBar, followPendingFind } from "./FindBar";
import { bindViewKeys, once } from "./keys";
import { markdownTitle } from "./outline";
import { NoOutline, WithSidebar } from "./Sidebar";
import { createSourceFind, SourcePane } from "./SourcePane";
import { TopBar } from "./TopBar";
import { createUi, provideEditorFocus } from "./ui-state";

/** 顶栏的标题和字符数在停手多久后重算（毫秒）。 */
const STATS_DELAY = 300;

const nothing = () => undefined;

export function SourceDocument(props: { markdown: string; notice: () => string; notices?: () => JSX.Element }) {
  // Editor 回报的文字没有 BOM、换行全是 LF（web host 实测），所以进编辑器前拆掉，存回时补上
  const endings = splitEndings(props.markdown);
  let text = endings.text;
  const stats = signal({ title: markdownTitle(text), counts: { chars: text.length } });
  let statsTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = (value: string) => {
    text = value;
    markChanged(() => joinEndings(text, endings));
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = setTimeout(() => stats.set({ title: markdownTitle(text), counts: { chars: text.length } }), STATS_DELAY);
  };
  const ui = createUi();
  const find = createSourceFind();
  const findState = createFindState();
  const ctx: CommandContext = { ui, session: null, askLink: nothing, askAtom: nothing, toggleSource: null, find: () => find.engine };
  const run = once((c) => runCommand(c, ctx));
  bindViewKeys(run, ctx);
  followPendingFind(ui, findState, () => find.engine);
  const refocus = () => find.ref()?.focus();
  provideEditorFocus(refocus);
  return (
    <View class="flex-1">
      <TopBar title={stats().title} counts={formatCounts(stats().counts)} />
      {props.notices?.()}
      <FindBar ui={ui} state={findState} engine={() => find.engine} onClose={refocus} />
      <Notice testID="source-notice" message={props.notice()} />
      <WithSidebar outline={() => <NoOutline />}>
        <SourcePane text={endings.text} find={find} onChange={changed} />
      </WithSidebar>
      <CommandPalette ctx={ctx} headings={() => []} run={run} onJump={nothing} onClose={refocus} />
    </View>
  );
}
