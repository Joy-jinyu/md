/** 所见即所得编辑：Markdown 读进编辑器会话，改动停手后写回 Markdown 交给 store。编辑页上的各个部件在这里接到一起。 */
import { Clipboard, effect, signal, untracked, View, windowSize } from "nsh";
import { chain, RichEditor, type RichEditorSession, scrollIntoView, setTextSelection } from "nsh/base";
import { PLAIN_PASTE_KEY } from "../../platform";
import { markChanged } from "../../store/document";
import { Notice } from "../../ui/notice";
import { AtomPrompt, createAtomPrompt } from "./AtomPrompt";
import { BlockHandle, createBlockHandle } from "./BlockHandle";
import { CommandPalette } from "./CommandPalette";
import { type CommandContext, runCommand } from "./commands";
import { countChars, countWords } from "./counts";
import { EDITOR_CLASSES } from "./editor-classes";
import { createRichFind } from "./find";
import { createFindState, FindBar } from "./FindBar";
import { createFocusMode } from "./focus-mode";
import { bindViewKeys, capturedKeys, commandForKey, once } from "./keys";
import { createLinkPrompt, LinkPrompt } from "./LinkPrompt";
import { slugify } from "./links";
import { OutlinePanel } from "./OutlinePanel";
import { currentHeading, documentTitle, type HeadingEntry, headingStarts, markdownTitle, type Node } from "./outline";
import type { RichOpened } from "./rich-session";
import { AtomBar, createSelectionBar, FormatBar, LinkCard } from "./SelectionBar";
import { selectionRange } from "./selection";
import { createSlash, SlashMenu } from "./SlashMenu";
import { createSourceFind, SourcePane } from "./SourcePane";
import { createSourceView } from "./source-view";
import { createTableBar, TableBar } from "./TableBar";
import { convertTyped, createTypedTracker } from "./typing";
import { TopBar } from "./TopBar";
import { createUi } from "./ui-state";

/** 顶栏的标题和字数、大纲、查找高亮在停手多久后重算（毫秒）；体感值，不追求实时。 */
const STATS_DELAY = 300;
/**
 * 窗口比这窄时，大纲不再把正文挤到右边，而是盖在正文上面（点旁边或选一个标题就收起）。
 * 取 720：大纲 240 加上正文列至少要的 480；再窄的话并排时正文只剩一条缝（2026-11-25 用户反馈的截图就是这样）。
 */
const OUTLINE_OVERLAY_BELOW = 720;

/** 选中文字的字数在选区停住多久后算（毫秒）：拖着选的过程中不算。 */
const SELECTION_DELAY = 120;

function readStats(session: RichEditorSession) {
  const doc = session.getJSON() as Node;
  return { title: documentTitle(doc), counts: `${session.words()} 词 · ${session.characters()} 字符`, headings: headingStarts(doc) };
}

function readSelected(session: RichEditorSession): string {
  const { from, to } = selectionRange(session);
  if (from === to) return "";
  const text = session.textBetween(from, to, "\n");
  return `选中 ${countWords(text)} 词 · ${countChars(text)} 字符`;
}

function jumpTo(session: RichEditorSession, heading: HeadingEntry) {
  session.run(chain([setTextSelection(heading.pos + 1), scrollIntoView()]));
  session.focus();
}

function pastePlain(session: RichEditorSession) {
  Clipboard.readText().then(
    (text) => text !== "" && session.pasteText(text),
    (e: unknown) => console.warn("read clipboard failed", e),
  );
}

export function RichDocument(props: { doc: RichOpened; tooBig: (markdown: string) => boolean }) {
  const { session, keys, dump } = props.doc;
  const ui = createUi();
  const revision = signal(session.revision);
  const stats = signal(readStats(session));
  const selected = signal("");
  const focused = signal(true);

  const link = createLinkPrompt(session, revision);
  const atom = createAtomPrompt(session);
  const bar = createSelectionBar(session);
  const handle = createBlockHandle(session);
  const table = createTableBar(session);
  const focusMode = createFocusMode(session);
  const richFind = createRichFind(session);
  const sourceFind = createSourceFind();
  const findState = createFindState();
  const source = createSourceView(props.doc, sourceFind, props.tooBig);

  const typed = createTypedTracker();
  /** 上次修订之后文档有没有变：打字带来的修订不出链接卡片。 */
  let editedSinceSync = false;
  let statsTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = ({ change }: { change: { revision: number } }) => {
    markChanged(dump);
    handle.hide();
    editedSinceSync = true;
    // 编辑框记的是打开时的位置，之后文档再变就可能指错块
    if (atom.isOpen() && change.revision > atom.openedAt()) atom.close();
    typed.note(selectionRange(session).head, change.revision);
    if (convertTyped(session, typed, change.revision) === "math") atom.insert("mathBlock");
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = setTimeout(() => {
      stats.set(readStats(session));
      if (richFind.isActive()) richFind.refresh();
    }, STATS_DELAY);
  };
  /** 源码视图里顶栏也跟着改：标题取第一个标题行，只数字符（和只能源码打开的文档一样）。 */
  const sourceEdited = (text: string) => {
    source.edited(text);
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = setTimeout(() => stats.set({ ...stats(), title: markdownTitle(text), counts: `${text.length} 字符` }), STATS_DELAY);
  };
  let wasSource = false;
  effect(() => {
    const on = source.isOn();
    const leaving = wasSource && !on;
    wasSource = on;
    if (!leaving) return;
    untracked(() => {
      if (statsTimer) clearTimeout(statsTimer);
      stats.set(readStats(session));
    });
  });
  let selectedTimer: ReturnType<typeof setTimeout> | undefined;
  const selectionMoved = () => {
    if (selectedTimer) clearTimeout(selectedTimer);
    selectedTimer = setTimeout(() => {
      const next = readSelected(session);
      if (next !== selected()) selected.set(next);
    }, SELECTION_DELAY);
  };

  const ctx: CommandContext = {
    ui,
    get session() {
      return source.isOn() ? null : session;
    },
    askLink: link.show,
    askAtom: atom.insert,
    toggleSource: source.toggle,
  };
  const run = once((c) => runCommand(c, ctx));
  const slash = createSlash(session, (c) => runCommand(c, ctx));
  session.on("revision", ({ revision: r }) => {
    revision.set(r);
    typed.note(selectionRange(session).head, r);
    slash.sync();
    // 这次修订如果是文档改动，onChange 和它同一轮到，先后不定；推到下一轮再看有没有改过
    setTimeout(() => {
      bar.sync(editedSinceSync);
      editedSinceSync = false;
    }, 0);
    table.sync();
    handle.closeMenu();
    focusMode.sync(ui.focusOn());
    selectionMoved();
  });
  effect(() => {
    const on = ui.focusOn();
    untracked(() => focusMode.sync(on));
  });
  keys.captureKeys(PLAIN_PASTE_KEY ? [...capturedKeys(), PLAIN_PASTE_KEY] : capturedKeys(), (key) => {
    if (key === PLAIN_PASTE_KEY) return pastePlain(session);
    const c = commandForKey(key);
    if (c) run(c);
  });
  keys.capturing = true;
  bindViewKeys(run);

  /** 跳转时现取标题位置：`stats` 要停手 300ms 才重算，刚改过时里面的位置是旧的。 */
  const freshHeadings = () => headingStarts(session.getJSON() as Node);
  const anchor = (id: string) => {
    const target = freshHeadings().find((h) => slugify(h.text) === id);
    if (target) jumpTo(session, target);
    return !!target;
  };
  const jumpToIndex = (index: number) => {
    const target = freshHeadings()[index];
    if (target) jumpTo(session, target);
  };
  /**
   * 光标旁的浮层一次只出一个，按这个顺序取第一个开着的。
   * 焦点在查找框里时不出格式条这类跟着选区走的：查找每跳一处都会选中文字，格式条会跟着冒出来。
   * 链接输入、公式编辑框自己有输入框（焦点本来就不在正文里），不受这条限制；
   * 查找条开着但人回到正文里打字时也照常出，不然斜杠菜单看不见却还在接回车。
   */
  const bubble = () => {
    if (ui.paletteOpen()) return undefined;
    if (link.isOpen()) return <LinkPrompt prompt={link} onAnchor={anchor} />;
    const target = atom.target();
    if (target) return <AtomPrompt prompt={atom} kind={target.kind} />;
    if (ui.findMode() !== null && !focused()) return undefined;
    if (slash.isOpen()) return <SlashMenu slash={slash} />;
    switch (bar.mode()) {
      case "selection":
        return <FormatBar session={session} revision={revision} onLink={link.show} />;
      case "link":
        return <LinkCard session={session} link={link} onAnchor={anchor} />;
      case "atom":
        return <AtomBar session={session} atom={atom} />;
      default:
        return undefined;
    }
  };
  /** 格式条放在选区上方，不挡下一行；其余的（菜单、输入框）放下方。 */
  const bubbleAbove = () => !link.isOpen() && !atom.isOpen() && !slash.isOpen() && bar.mode() === "selection";
  const currentSection = () => {
    void revision();
    return currentHeading(stats().headings, selectionRange(session).head);
  };
  const outlineShown = () => ui.outlineOpen() && !source.isOn();
  const outlineOverlays = () => windowSize().width < OUTLINE_OVERLAY_BELOW;
  const refocus = () => (source.isOn() ? sourceFind.ref()?.focus() : session.focus());

  return (
    <View class="flex-1">
      <TopBar
        title={stats().title}
        counts={(!source.isOn() && selected()) || stats().counts}
        toggles={{ ui, sourceOn: source.isOn(), onToggleSource: source.toggle }}
        context={
          <If when={!source.isOn()}>
            <TableBar bar={table} session={session} />
          </If>
        }
      />
      <FindBar ui={ui} state={findState} engine={() => (source.isOn() ? sourceFind.engine : richFind.engine)} onClose={refocus} />
      <If when={source.notice()}>{(message) => <Notice testID="source-notice" message={message()} />}</If>
      <View class="flex-1 flex-row">
        <If when={outlineShown() && !outlineOverlays()}>
          <OutlinePanel headings={stats().headings} current={currentSection()} onJump={jumpToIndex} />
        </If>
        <View class="flex-1" classList={{ hidden: source.isOn() }}>
          <RichEditor
            testID="editor"
            editor={session}
            accessibilityLabel="正文"
            placeholder="从这里开始写…"
            autoFocus
            editable={!source.isOn()}
            class="flex-1"
            classes={EDITOR_CLASSES}
            onChange={changed}
            onFocus={() => focused.set(true)}
            onBlur={() => focused.set(false)}
            onMouseMove={(e) => handle.move(e.pagePosition)}
            bubbleMenu={bubble()}
            bubbleMenuPlacement={bubbleAbove() ? "top" : "bottom"}
            contentLayer={<BlockHandle handle={handle} />}
          />
        </View>
        <If when={source.view()}>{(v) => <SourcePane text={v().text} find={sourceFind} onChange={sourceEdited} onReady={source.ready} />}</If>
        {/* 窄窗口：大纲盖在正文上。写在正文后面，画的时候才在上层 */}
        <If when={outlineShown() && outlineOverlays()}>
          <View testID="outline-scrim" role="button" accessibilityLabel="收起大纲" onPress={() => ui.outlineOpen.set(false)} class="absolute inset-0 bg-scrim" />
          <View class="absolute bottom-0 left-0 top-0 flex-row shadow-lg">
            <OutlinePanel
              headings={stats().headings}
              current={currentSection()}
              onJump={(index) => {
                ui.outlineOpen.set(false);
                jumpToIndex(index);
              }}
            />
          </View>
        </If>
      </View>
      <CommandPalette ctx={ctx} headings={() => (source.isOn() ? [] : freshHeadings())} run={run} onJump={(h) => jumpTo(session, h)} onClose={refocus} />
    </View>
  );
}
