/** 所见即所得编辑：Markdown 读进编辑器会话，改动停手后写回 Markdown 交给 store。编辑页上的各个部件在这里接到一起。 */
import { cleanup, Clipboard, effect, signal, untracked, View } from "nsh";
import { chain, RichEditor, type RichEditorSession, scrollIntoView, setTextSelection } from "nsh/base";
import { droppedPaths, PLAIN_PASTE_KEY } from "../../platform";
import { markChanged } from "../../store/document";
import { Notice } from "../../ui/notice";
import { AtomPrompt, createAtomPrompt } from "./AtomPrompt";
import { BlockHandle, createBlockHandle } from "./BlockHandle";
import { BlockOverlays, createBlockOverlays } from "./BlockOverlays";
import { CaretMarker, createCaretFollow } from "./caret-follow";
import { createCodeHighlight } from "./code-highlight";
import { CommandPalette } from "./CommandPalette";
import { type CommandContext, runCommand } from "./commands";
import { countChars, countWords } from "./counts";
import { refreshDocIndex } from "./doc-index";
import { EDITOR_CLASSES } from "./editor-classes";
import { ImageBar } from "./ImageBar";
import { attachImageTarget, insertImageBytes, insertImageFiles, noteEditorWidth, pickImages, transferAllImages } from "./images";
import { createEmoji, EmojiMenu } from "./EmojiMenu";
import { createRichFind } from "./find";
import { createFindState, FindBar, followPendingFind } from "./FindBar";
import { createFocusMode } from "./focus-mode";
import { bindViewKeys, capturedKeys, commandForKey, once } from "./keys";
import { createLinkPrompt, LinkPrompt } from "./LinkPrompt";
import { slugify } from "./links";
import { OutlinePanel } from "./OutlinePanel";
import { dropUnsafeImages } from "./paste";
import { caretPosIn, currentHeading, documentTitle, type HeadingEntry, headingStarts, markdownTitle, type Node, topBlocks } from "./outline";
import type { RichOpened } from "./rich-session";
import { AtomBar, createSelectionBar, FormatBar, LinkCard } from "./SelectionBar";
import { type Rect, selectionRange } from "./selection";
import { collapseIfOverlay, NoOutline, WithSidebar } from "./Sidebar";
import { createSlash, SlashMenu } from "./SlashMenu";
import { createSourceFind, SourcePane } from "./SourcePane";
import { createSourceView } from "./source-view";
import { createTableBar, TableBar } from "./TableBar";
import { convertTyped, createTypedTracker } from "./typing";
import { TopBar } from "./TopBar";
import { createUi, provideEditorFocus } from "./ui-state";

/** 顶栏的标题和字数、大纲、查找高亮在停手多久后重算（毫秒）；体感值，不追求实时。 */
const STATS_DELAY = 300;

/** 选中文字的字数在选区停住多久后算（毫秒）：拖着选的过程中不算。 */
const SELECTION_DELAY = 120;

function readStats(session: RichEditorSession) {
  const doc = session.getJSON() as Node;
  return { title: documentTitle(doc), counts: `${session.words()} 字词 · ${session.characters()} 字符`, headings: headingStarts(doc) };
}

function readSelected(session: RichEditorSession): string {
  const { from, to } = selectionRange(session);
  if (from === to) return "";
  const text = session.textBetween(from, to, "\n");
  return `选中 ${countWords(text)} 字词 · ${countChars(text)} 字符`;
}

function jumpTo(session: RichEditorSession, heading: HeadingEntry) {
  session.run(chain([setTextSelection(heading.pos + 1), scrollIntoView()]));
  session.focus();
}

/**
 * 文档以原子块（front matter、公式）开头时，编辑器打开后默认选中这个块，操作条会跟着冒出来、滚动时还贴在窗口顶上；
 * 打开时把光标放进第一个能打字的块。整篇都是原子块就不动。
 */
function startInText(session: RichEditorSession) {
  if (session.selection.type !== "node") return;
  const first = topBlocks(session.getJSON() as Node).find((b) => caretPosIn(b) !== b.pos);
  if (first) session.run(setTextSelection(caretPosIn(first)));
}

/** 格式条的高度和隔开一行时离选区的距离（正文行高 30 + 宿主默认间距 8），见 RichDocument 里的 bubbleSpot。 */
const BAR_HEIGHT = 38;
const LINE_GAP = 38;
/** 画了边框、底色的块：格式条压在它们的下沿上很显眼。 */
const FRAMED_BLOCKS = ["table", "codeBlock"];

/** 页面上 y 这一条（格式条的上沿）落在表格、代码块里没有。 */
function framedAt(session: RichEditorSession, x: number, y: number): boolean {
  const pos = session.posAtPageCoords({ x, y });
  if (pos === null) return false;
  return FRAMED_BLOCKS.some((name) => session.findParentNode(name, pos) !== null);
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
  const highlight = createCodeHighlight(session);
  const overlays = createBlockOverlays(session);
  startInText(session);
  refreshDocIndex(session);
  highlight.schedule();
  const focusMode = createFocusMode(session);
  const follow = createCaretFollow(session);
  const richFind = createRichFind(session);
  const sourceFind = createSourceFind();
  const findState = createFindState();
  const source = createSourceView(props.doc, sourceFind, props.tooBig);
  followPendingFind(ui, findState, () => (source.isOn() ? sourceFind.engine : richFind.engine), () => source.isOn() || source.toggle());

  const typed = createTypedTracker();
  /** 上次修订之后文档有没有变：打字带来的修订不出链接卡片。 */
  let editedSinceSync = false;
  let statsTimer: ReturnType<typeof setTimeout> | undefined;
  /** 最近一次文档改动的修订号。 */
  let lastChange = session.revision;
  const changed = ({ change }: { change: { revision: number } }) => {
    lastChange = change.revision;
    markChanged(dump);
    handle.hide();
    highlight.schedule();
    overlays.docChanged();
    editedSinceSync = true;
    // 编辑框记的是打开时的位置，之后文档再变就可能指错块
    if (atom.isOpen() && change.revision > atom.openedAt()) atom.close();
    typed.note(selectionRange(session).head, change.revision);
    if (convertTyped(session, typed, change.revision) === "math") atom.insert("mathBlock");
    if (!ui.typewriterOn() && typed.advance(change.revision) > 0) setTimeout(follow.keepRoom, 0);
    follow.pointer.typed();
    followCaret();
    if (statsTimer) clearTimeout(statsTimer);
    statsTimer = setTimeout(() => {
      stats.set(readStats(session));
      refreshDocIndex(session);
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
      refreshDocIndex(session);
      highlight.repaint();
      overlays.docChanged();
      followCaret(true);
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
  // 切文档时编辑页整个重建：旧页的定时器不能晚到，把旧文档的索引写回全局（目录、脚注会显示上一篇的）
  cleanup(() => {
    if (statsTimer) clearTimeout(statsTimer);
    if (selectedTimer) clearTimeout(selectedTimer);
    highlight.dispose();
  });

  const ctx: CommandContext = {
    ui,
    get session() {
      return source.isOn() ? null : session;
    },
    askLink: link.show,
    askAtom: atom.insert,
    toggleSource: source.toggle,
    codeBlock: { chooseLanguage: overlays.chooseLanguage, copy: overlays.copy },
    images: { insert: () => void pickImages(session), transferAll: () => void transferAllImages(session) },
  };
  cleanup(attachImageTarget(() => ctx.session));
  const run = once((c) => runCommand(c, ctx));
  const slash = createSlash(session, (c) => runCommand(c, ctx));
  const emoji = createEmoji(session);
  /**
   * 打字机模式：键盘挪了光标或者文档改了才重新居中；只是交装饰带来的修订不动，不然用户滚走以后会被拽回来。
   * 鼠标点、拖出来的选区也不动：拖选时内容在鼠标下面滑走会越选越多，单击时按下那一下内容会跳走（判断见 caret-follow.tsx 的 createPointer）。
   * `force`：打开打字机模式、窗口改了大小、从源码视图切回来时，不管光标动没动都居中一次。
   */
  let followedHead = -1;
  let followedRevision = -1;
  const followCaret = (force = false) => {
    if (!ui.typewriterOn() || source.isOn()) return;
    const { from, to, head } = selectionRange(session);
    const edited = followedRevision !== lastChange;
    if (!force && head === followedHead && !edited) return;
    followedHead = head;
    followedRevision = lastChange;
    if (!force && !edited && follow.pointer.drives(from, to, head)) return;
    setTimeout(follow.center, 0);
  };
  effect(() => {
    const on = ui.typewriterOn();
    untracked(() => on && followCaret(true));
  });
  let editorSize = "";
  const resized = (size: { width: number; height: number }) => {
    const next = `${size.width}x${size.height}`;
    if (next === editorSize) return;
    editorSize = next;
    followCaret(true);
  };
  session.on("revision", ({ revision: r }) => {
    revision.set(r);
    typed.note(selectionRange(session).head, r);
    slash.sync();
    emoji.sync();
    overlays.sync();
    highlight.caretMoved();
    // 这次修订如果是文档改动，onChange 和它同一轮到，先后不定；推到下一轮再看有没有改过
    setTimeout(() => {
      bar.sync(editedSinceSync);
      editedSinceSync = false;
    }, 0);
    table.sync();
    handle.closeMenu();
    focusMode.sync(ui.focusOn());
    followCaret();
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
  keys.transformPasted(dropUnsafeImages);
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
    if (emoji.isOpen()) return <EmojiMenu emoji={emoji} />;
    switch (bar.mode()) {
      case "selection":
        return <FormatBar session={session} revision={revision} onLink={link.show} />;
      case "link":
        return <LinkCard session={session} link={link} onAnchor={anchor} />;
      case "image":
        return <ImageBar session={session} revision={revision} />;
      case "atom":
        return <AtomBar session={session} atom={atom} />;
      default:
        return undefined;
    }
  };
  /** 格式条放在选区上方，不挡下一行；其余的（菜单、输入框）放下方。 */
  const bubbleAbove = () => !link.isOpen() && !atom.isOpen() && !slash.isOpen() && !emoji.isOpen() && bar.mode() === "selection";
  /**
   * 格式条和选区之间隔开一整行：贴着选区（宿主默认 8）会正好盖住上一行（2026-11-25 macOS 窗口和 web host 都实测）。
   * 宿主按整个窗口判断上面放不放得下，选区离窗口顶太近时隔一行会盖到顶栏上，那时退回 8。
   * 200 ≈ 顶栏 44 + 两条提示条 72 + 隔开的 38 + 格式条高 38。没用 measure() 量正文区的位置：在 onLayout 里量，
   * 改键重建编辑页后查找条的 Esc 就关不掉了（2026-11-25 nsh test 实测，原因没查清）。
   * 隔一行后格式条的上沿落进上面的表格、代码块时改放到选区下面：上下都没地方躲开文字，压着边框最难看（2026-11-25 macOS 窗口、web host 实测）。
   */
  const bubbleSpot = (): { placement: "top" | "bottom"; offset: number } => {
    if (!bubbleAbove()) return { placement: "bottom", offset: 8 };
    void revision();
    const r = session.pageCoordsAtPos(selectionRange(session).from) as Rect | null;
    if (!r || r.y < 200) return { placement: "top", offset: 8 };
    return framedAt(session, r.x, r.y - LINE_GAP - BAR_HEIGHT + 2) ? { placement: "bottom", offset: 8 } : { placement: "top", offset: LINE_GAP };
  };
  const currentSection = () => {
    void revision();
    return currentHeading(stats().headings, selectionRange(session).head);
  };
  const outline = () =>
    source.isOn() ? (
      <NoOutline />
    ) : (
      <OutlinePanel
        headings={stats().headings}
        current={currentSection()}
        onJump={(index) => {
          collapseIfOverlay();
          jumpToIndex(index);
        }}
      />
    );
  const refocus = () => (source.isOn() ? sourceFind.ref()?.focus() : session.focus());
  provideEditorFocus(refocus);

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
      <WithSidebar outline={outline}>
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
            onMouseMove={(e) => {
              handle.move(e.pagePosition);
              follow.pointer.move(e);
            }}
            onMouseUp={follow.pointer.up}
            onMouseLeave={follow.pointer.leave}
            onLayout={(e) => {
              overlays.sync();
              noteEditorWidth(e.bounds.size.width);
              resized(e.bounds.size);
            }}
            onPasteFiles={({ paste }) => {
              void insertImageBytes(session, paste.files);
              const paths = droppedPaths(paste.uris);
              if (paths.length > 0) void insertImageFiles(session, paths);
            }}
            bubbleMenu={bubble()}
            bubbleMenuPlacement={bubbleSpot().placement}
            bubbleMenuOffset={bubbleSpot().offset}
            contentLayer={
              <>
                <BlockHandle handle={handle} />
                <BlockOverlays overlays={overlays} />
                <CaretMarker follow={follow} />
              </>
            }
          />
        </View>
        <If when={source.view()}>{(v) => <SourcePane text={v().text} find={sourceFind} onChange={sourceEdited} onReady={source.ready} />}</If>
      </WithSidebar>
      <CommandPalette ctx={ctx} headings={() => (source.isOn() ? [] : freshHeadings())} run={run} onJump={(h) => jumpTo(session, h)} onClose={refocus} />
    </View>
  );
}
