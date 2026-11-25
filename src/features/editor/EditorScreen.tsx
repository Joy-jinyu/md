/**
 * 编辑页：读出文档库里开着的那一篇，按大小和能否读进编辑器选富文本或源码方式；换一篇就整个重建。
 * 失焦、切后台、退出时立即保存；窗口重新获得焦点时和存储比对版本（另一个标签页可能改过）。
 */
import { effect, lifecycle, signal, untracked, View } from "nsh";
import { messageOf } from "../../doc/message";
import { droppedPaths, fileLibrary, keepWindowOnClose, onOpenFiles, PROBE_GATEWAY, saveBeforeLeaving } from "../../platform";
import { chooseBackend, elsewhereWords } from "../../store/backend";
import { checkExternal, flush, openDocument, saveState, stashUnsaved } from "../../store/document";
import { currentDocId, markOpened, refreshLibrary, startLibrary } from "../../store/library";
import { loadShortcutOverrides, saveShortcutOverrides, type ShortcutOverrides } from "../../store/settings";
import { recoverUnsaved } from "../../store/unsaved";
import { Notice } from "../../ui/notice";
import { FileActions } from "../files/FileActions";
import { createLibraryActions, openFallback } from "../library/actions";
import { DocDialogs } from "../library/DocDialogs";
import { followStoreChanges } from "../library/external";
import { HistoryDialog } from "../library/HistoryDialog";
import { StorageNotice } from "../library/StorageNotice";
import { QuickOpen } from "../library/QuickOpen";
import { dismissReceipt, receipt, say } from "../library/receipt";
import { libraryRequest, pendingFind, requestLibrary } from "../library/requests";
import { ImageHostDialog } from "../settings/ImageHostDialog";
import { ImageUploadConfirm } from "../settings/ImageUploadConfirm";
import { SettingsScreen } from "../settings/SettingsScreen";
import { SyncHost } from "../sync/SyncHost";
import { ConflictBar } from "./ConflictBar";
import { setOverrides } from "./keybindings";
import { dropImageFiles, dropImages, isImagePath } from "./images";
import { MermaidRenderer } from "./mermaid";
import { RichDocument } from "./RichDocument";
import { openRich, type RichOpened } from "./rich-session";
import { SourceDocument } from "./SourceDocument";
import { closeTransients } from "./ui-state";

/**
 * 所见即所得方式能流畅打开的上限，超过任何一个就用源码方式打开。
 * nsh 0.6.0 的 RichEditor 没有虚拟滚动，整篇一次渲染，耗时比块数涨得快，而且发生在宿主里，JS 这边拦不住。
 * 出处：2026-11-24 本机 web host（headless Chrome）实测，打开到出字 / 每敲一个字：
 * 约 4000 个非空行 1.3–1.8 秒 / 35–50ms；8000–10000 行 3.5–5.3 秒 / 80–160ms；
 * 纯段落 21 万字符 1.0–1.3 秒，64 万字符 3.3 秒。300 张三行小表（900 行）1.7 秒，所以表格行按 4 行算。
 * 单张表格涨得更快：500 行 1.4 秒，750 行 3.4 秒，1000 行 7 秒，2000 行 45 秒以上，所以单张表另设行数上限。
 * macOS host 没量过，先用同一组值。
 * nsh 0.7.0 复测（2026-11-25，同样 headless Chrome，打包后的网页；打开含运行时启动约 0.2 秒）：编辑器只挂视口附近的块，打开快了很多
 * （约 3000 / 1 万 / 1.7 万行 0.5 / 1.2 / 1.8 秒，单表 1000 / 2000 行 1.4 / 3.4 秒），但每敲一个字仍随全文变慢（67 / 135 / 212ms，单表 1000 行 133ms），
 * 上限这次没改；放宽前先定能接受的每键耗时。
 */
export const RICH_MAX_CHARS = 300_000;
export const RICH_MAX_LINES = 4_000;
export const RICH_MAX_TABLE_ROWS = 500;
const TABLE_LINE_WEIGHT = 4;

type Opened =
  | { kind: "loading" }
  | { kind: "rich"; doc: RichOpened }
  | { kind: "source"; markdown: string; notice: string }
  | { kind: "failed"; message: string };

/**
 * 估出的渲染量超没超上限：非空行数（表格行加权），和最长的一张表。
 * 带 | 的行都当表格行（表格可以不写行首的 |，也可以在引用、列表里），连着的算一张表；宁可多算。
 */
function tooBigForRich(markdown: string): boolean {
  if (markdown.length > RICH_MAX_CHARS) return true;
  let total = 0;
  let run = 0;
  for (const line of markdown.split("\n")) {
    const tableLine = line.includes("|");
    run = tableLine ? run + 1 : 0;
    if (line.trim() !== "") total += tableLine ? TABLE_LINE_WEIGHT : 1;
    if (run > RICH_MAX_TABLE_ROWS || total > RICH_MAX_LINES) return true;
  }
  return false;
}

function choose(markdown: string): Opened {
  if (tooBigForRich(markdown)) {
    return { kind: "source", markdown, notice: "这篇文档比较大，超过所见即所得编辑能流畅打开的上限，先用源码方式打开。" };
  }
  try {
    return { kind: "rich", doc: openRich(markdown) };
  } catch (e) {
    console.error("openRich failed", e);
    return { kind: "source", markdown, notice: `没能按所见即所得方式打开（${messageOf(e)}），先用源码方式打开，原文没有改动。` };
  }
}

/**
 * 窗口失焦、应用切到后台、退出、macOS 关窗时立即写入；写不进去的原因由顶栏的保存状态显示。切到后台和关页面时先同步记一份应急键（见 store/unsaved.ts）。
 * 重新获得焦点、macOS 点程序坞图标重新显示窗口时：别处存过这一篇、这里没改过就直接载入（`reload`）；这里也改过就由冲突条让用户选。文档列表也重读一遍（别处可能新建、删了几篇）。
 */
function watchLifecycle(reload: () => void) {
  const recheck = () => {
    void refreshLibrary().catch((e: unknown) => console.warn("library not refreshed", e));
    void checkExternal()
      .then((r) => r === "reload" && reload())
      .catch((e: unknown) => console.warn("external change not checked", e));
  };
  let wasActive = true;
  effect(() => {
    const active = lifecycle() === "active";
    untracked(() => {
      if (!active) {
        if (lifecycle() === "background") stashUnsaved();
        void flush();
      }
      else if (!wasActive) recheck();
      wasActive = active;
    });
  });
  const saved = () => flush().then((r) => r.ok);
  saveBeforeLeaving(stashUnsaved, saved);
  keepWindowOnClose(stashUnsaved, saved, recheck);
}

export function EditorScreen() {
  const opened = signal<Opened>({ kind: "loading" });
  /** 读出一篇、换上编辑器。读不到（已经不在了）返回 false，编辑页不变。 */
  const show = async (id: string, find?: string): Promise<boolean> => {
    let text: string | null;
    try {
      text = await openDocument(id);
    } catch (e) {
      opened.set({ kind: "failed", message: `没能读出本机存的文档：${messageOf(e)}` });
      return false;
    }
    if (text === null) return false;
    markOpened(id);
    pendingFind.set(find ? { id, query: find } : null);
    // 换掉编辑页之前先收起快速打开、命令面板，下一轮再换（同命令面板的 close）
    if (closeTransients()) await new Promise((resolve) => setTimeout(resolve, 0));
    opened.set(choose(text));
    return true;
  };
  /** 开不了（已经不在了）就开最近改过的一篇，一篇都没有就新建。 */
  const showOrFallback = async (id: string) => {
    if (await show(id)) return;
    say("这篇文档已经不在了（可能在别的标签页里删掉了）。", "warn");
    await openFallback(show);
  };
  const reopen = async () => {
    const id = currentDocId();
    if (id) await showOrFallback(id);
  };
  const openFromSystem = (paths: string[]) => paths[0] && requestLibrary({ kind: "openPath", path: paths[0] });
  /** 拖进窗口的本地文件（macOS 给路径）：图片插进开着的文档，别的当文档打开。网页里给的是文件本身，只收图片（images.ts 的 `dropImageFiles`）。 */
  const dropped = (paths: string[]) => {
    const images = paths.filter(isImagePath);
    if (images.length > 0) dropImages(images);
    openFromSystem(paths.filter((p) => !isImagePath(p)));
  };
  // 键表在建编辑器会话时定下来，所以先读设置再开文档；存储（文库文件夹 / 网关 / 浏览器本地）定下来以后，上次没存上的改动在开文档之前并回去
  void loadShortcutOverrides()
    .then(setOverrides)
    .then(() => chooseBackend(fileLibrary(), PROBE_GATEWAY))
    .then(() => followStoreChanges(() => void reopen().then(() => say(`${elsewhereWords().changed}，已载入最新的内容。`, "info"))))
    .then(recoverUnsaved)
    .then((note) => note && say(note.text, note.tone))
    .then(startLibrary)
    .then(showOrFallback)
    .then(() => onOpenFiles(openFromSystem))
    .catch((e: unknown) => opened.set({ kind: "failed", message: `没能读出本机存的文档：${messageOf(e)}` }));

  // 开着的这篇在别处删了：冲突条出来让人选，叠在上面的快速打开、命令面板先收起
  effect(() => {
    const s = saveState();
    if (s.kind === "conflict" && s.deleted) untracked(closeTransients);
  });

  const handle = createLibraryActions(show);
  effect(() => {
    const request = libraryRequest();
    if (!request) return;
    untracked(() => {
      libraryRequest.set(null);
      void handle(request.request);
    });
  });

  /**
   * 设置里改了键：存下来，再把编辑页整个重建（会话的键表建好后换不了）。
   * 重建是从存储重新读文档，所以要先把没存的改动写进去；写不进去就不重建、也不改键，免得丢字，并在页面顶上说明。
   */
  const settingsProblem = signal("");
  const applyShortcuts = async (next: ShortcutOverrides) => {
    if (!(await flush()).ok) return settingsProblem.set("文档没能存上，这次没有改快捷键（原因见顶栏的保存状态）。存上以后再到设置里改一次。");
    const failed = await saveShortcutOverrides(next);
    settingsProblem.set(failed ? `快捷键没能存到本机（${failed}）：现在能用，重新打开后会回到原来的键。` : "");
    setOverrides(next);
    opened.set({ kind: "loading" });
    await reopen();
  };
  watchLifecycle(() => {
    void reopen().then(() => say(`${elsewhereWords().changed}，已载入最新的内容。`, "info"));
  });
  return (
    <View
      class="flex-1 bg-background"
      onFileDrop={(e) => {
        dropped(droppedPaths(e.uris));
        dropImageFiles(e.files);
      }}
    >
      <StorageNotice />
      <If when={settingsProblem()}>{(message) => <Notice testID="settings-problem" message={message()} onDismiss={() => settingsProblem.set("")} />}</If>
      <If when={receipt()}>{(m) => <Notice testID="receipt" message={m().text} tone={m().tone} copyable={m().tone === "warn"} onDismiss={m().tone === "warn" ? dismissReceipt : undefined} />}</If>
      <ConflictBar onTheirs={() => void reopen()} />
      <FileActions />
      {screen(opened())}
      <SettingsScreen onApply={(next) => void applyShortcuts(next)} />
      <QuickOpen />
      <HistoryDialog />
      <DocDialogs />
      <ImageHostDialog />
      <ImageUploadConfirm />
      <SyncHost reload={reopen} />
      <MermaidRenderer />
    </View>
  );
}

function screen(current: Opened) {
  switch (current.kind) {
    case "loading":
      return null;
    case "rich":
      return <RichDocument doc={current.doc} tooBig={tooBigForRich} />;
    case "source":
      return <SourceDocument markdown={current.markdown} notice={current.notice} />;
    case "failed":
      return <Notice message={current.message} />;
  }
}
