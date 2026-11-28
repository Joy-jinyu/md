/**
 * 文档页列表里的行：文章卡片（网页和 macOS 的列表视图）和 macOS 文件树。样子见 DESIGN.md「文档列表 · 文章卡片」「文件树」。
 * macOS 从右键或「⋯」弹出系统菜单，网页用「⋯」展开行内操作。
 */
import { t } from "../../i18n";
import { type Point, Text, View, type ViewRef } from "nsh";
import type { DocMeta } from "../../store/document-store";
import { CAN_HOVER, IS_MACOS } from "../../platform";
import { storageKind } from "../../store/backend";
import { allDocs, currentDocId, displayName } from "../../store/library";
import { Button } from "../../ui/button";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/icon-button";
import { tip } from "../../ui/tooltip";
import { InlineRename, settleRename } from "./InlineRename";
import { dirOf } from "../../doc/file-name";
import { DOC_EXT } from "../../doc/doc-ext";
import { excerptOf } from "../../doc/excerpt";
import { folderExpanded, macFolders, showMacLibraryMenu, toggleFolder } from "./mac-library";
import { problemText } from "./external";
import { panel, sorted, timeLabel } from "./panel-state";
import { requestLibrary } from "./requests";

export interface ListActions {
  onPicked: () => void;
  focusSearch: () => void;
}

/** 「+」和每行的「⋯」离底色边线 8（和行里上下的留白一样），两者中心在同一条竖线上。 */
export const RIGHT_INSET = "mr-2";

const LIBRARY_NAME = "Pairdown";
const fileBacked = () => storageKind().kind !== "local";
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const docsIn = (folder: string | undefined) =>
  sorted(allDocs().filter((doc) => folder === undefined || dirOf(doc.id) === (folder ? `${folder}/` : "")), panel.sort());

/** 一篇文档行的共用动作：打开、弹菜单（macOS 系统菜单从「⋯」下面或右键处弹出）。 */
function docActions(props: ListActions & { doc: DocMeta }) {
  let moreButton: ViewRef | undefined;
  const current = () => props.doc.id === currentDocId();
  const expanded = () => panel.expanded() === props.doc.id;
  const open = async () => {
    if (!(await settleRename())) return;
    if (!current()) requestLibrary({ kind: "open", id: props.doc.id });
    props.onPicked();
  };
  const showMenu = async (anchor?: Point, belowButton = false) => {
    const doc = props.doc;
    panel.expanded.set(doc.id);
    try {
      const button = belowButton ? await moreButton?.measure() : null;
      const position = button ? { x: button.pagePosition.x, y: button.pagePosition.y + button.bounds.size.height } : anchor;
      await showMacLibraryMenu({ folder: dirOf(doc.id).slice(0, -1), doc, open, focusSearch: props.focusSearch }, position);
    } finally {
      if (panel.expanded() === doc.id) panel.expanded.set(null);
    }
  };
  const name = () => displayName(props.doc);
  /** macOS 原地改名中：这一行不当按钮用，里面是输入框。 */
  const renaming = () => IS_MACOS && panel.renaming()?.id === props.doc.id;
  const more = (always = false) => (
    <IconButton
      testID={`doc-more-${props.doc.id}`}
      ref={IS_MACOS ? (node) => { moreButton = node; } : undefined}
      icon="ellipsis"
      label={t(`「${name()}」的更多操作`, `More actions for “${name()}”`)}
      tooltip={t("更多操作", "More actions")}
      active={expanded()}
      compact
      class={CAN_HOVER && !expanded() && !always ? `${RIGHT_INSET} opacity-0 group-hover:opacity-100 focus-visible:opacity-100` : RIGHT_INSET}
      onPress={() => {
        if (IS_MACOS) void showMenu(undefined, true);
        else panel.expanded.set(expanded() ? null : props.doc.id);
      }}
    />
  );
  return { current, expanded, open, showMenu, name, more, renaming };
}

/** 网页的「⋯」展开在行下面的一排按钮。 */
function InlineActions(props: { doc: DocMeta }) {
  return (
    <View class="flex-row flex-wrap gap-1 pb-2 pl-2">
      <Button testID="doc-rename" label={t("改文库名", "Rename in library")} onPress={() => panel.renaming.set(props.doc)} />
      <Button testID="doc-history" label={t("版本历史", "Version history")} onPress={() => requestLibrary({ kind: "history", id: props.doc.id })} />
      <Button testID="doc-delete" label={t("删除", "Delete")} onPress={() => panel.deleting.set(props.doc)} />
    </View>
  );
}

/** 卡片第一行左边：文件类后端写所在文件夹（根目录写「Pairdown」）；浏览器本地没有文件夹，标题和文库名不同时写文库名。 */
function cardPlace(doc: DocMeta): string {
  if (!fileBacked()) return doc.title && doc.title !== doc.name ? t(`文库名：${doc.name}.md`, `Library name: ${doc.name}.md`) : "";
  const dir = dirOf(doc.id).slice(0, -1);
  return dir ? baseName(dir) : LIBRARY_NAME;
}

/** 文章卡片：所在文件夹 · 时间，文件名（扩展名淡一档），两行摘要。「⋯」盖在文件名那一行右边，不在卡片的按钮里面。 */
export function DocCard(props: ListActions & { doc: DocMeta }) {
  const a = docActions(props);
  const problem = () => (props.doc.problem ? problemText(props.doc.problem) : null);
  const file = () => (fileBacked() ? baseName(props.doc.id) : "");
  const ext = () => DOC_EXT.exec(file())?.[0] ?? "";
  const big = () => (fileBacked() ? file().slice(0, file().length - ext().length) : a.name()) || t("未命名", "Untitled");
  const excerpt = () => (props.doc.head === undefined ? "" : excerptOf(props.doc.head));
  return (
    <View class="border-b border-border pb-0.5 pt-0.5">
      <View class="group rounded-(--radius-sm)" classList={{ "bg-pressed": a.current(), "bg-hover": a.expanded() && !a.current(), "hover:bg-hover": !a.current() }}>
        <View
          testID={`doc-${props.doc.id}`}
          role={a.renaming() ? undefined : "button"}
          accessibilityLabel={a.renaming() ? undefined : problem() ? t(`${big()}${ext()}（${problem()}）`, `${big()}${ext()} (${problem()})`) : `${big()}${ext()}`}
          accessibilityState={{ selected: a.current() }}
          onPress={a.renaming() ? undefined : () => void a.open()}
          onContextMenu={IS_MACOS && !a.renaming() ? ({ pagePosition }) => void a.showMenu(pagePosition) : undefined}
          class="min-w-0 gap-0.5 rounded-(--radius-sm) px-2 py-2 active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <View class="flex-row items-center gap-2">
            <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 font-mono text-[11px] leading-4 text-subtle">{cardPlace(props.doc)}</Text>
            <Text style={{ numberOfLines: 1 }} class="font-mono text-[11px] leading-4 text-subtle">{timeLabel(props.doc.updatedAt)}</Text>
          </View>
          <If when={a.renaming()} else={
            <Text style={{ numberOfLines: 1 }} class="min-w-0 pr-7 text-[14px] font-semibold leading-5 text-strong">
              {big()}
              <Text class="font-normal text-subtle">{ext()}</Text>
            </Text>
          }>
            <View class="flex-row pr-7"><InlineRename doc={props.doc} class="h-7 text-[14px] font-semibold" /></View>
          </If>
          <If when={problem() ?? excerpt()}>
            <Text style={{ numberOfLines: 2 }} class="text-[12px] leading-4" classList={{ "text-muted-foreground": !problem(), "text-warn-text": !!problem() }}>
              {problem() ?? excerpt()}
            </Text>
          </If>
        </View>
        <View class="absolute right-0 top-[22px]">{a.more()}</View>
        <If when={!IS_MACOS && a.expanded()}>
          <InlineActions doc={props.doc} />
        </If>
      </View>
    </View>
  );
}

/** 列表视图：所有文档（或一个文件夹里的）一篇一张卡。 */
export function DocCards(props: ListActions & { folder?: string }) {
  return (
    <Each of={docsIn(props.folder)} key={(doc) => doc.id}>
      {(doc) => <DocCard doc={doc()} onPicked={props.onPicked} focusSearch={props.focusSearch} />}
    </Each>
  );
}

const TREE_ROW = "min-h-8 min-w-0 flex-1 flex-row items-center gap-1.5 rounded-(--radius-sm) pr-1 focus-visible:outline-2 focus-visible:outline-ring";
/** 每深一层缩进 12；行本身的左内边距 8 落在内容线上。顶层的文件夹和文档与「Pairdown」那一行对齐（2026-11-28 用户嫌层级间距太宽）。 */
const indent = (depth: number) => ({ paddingLeft: 8 + depth * 12 });

function TreeDocRow(props: ListActions & { doc: DocMeta; depth: number }) {
  const a = docActions(props);
  return (
    <View class="group flex-row items-center rounded-(--radius-sm)" classList={{ "bg-pressed": a.current(), "bg-hover": a.expanded() && !a.current(), "hover:bg-hover": !a.current() }}>
      <View
        testID={`doc-${props.doc.id}`}
        role={a.renaming() ? undefined : "button"}
        accessibilityLabel={a.renaming() ? undefined : props.doc.problem ? t(`${baseName(props.doc.id)}（${problemText(props.doc.problem)}）`, `${baseName(props.doc.id)} (${problemText(props.doc.problem)})`) : baseName(props.doc.id)}
        tooltip={props.doc.problem ? tip(problemText(props.doc.problem)) : undefined}
        accessibilityState={{ selected: a.current() }}
        onPress={a.renaming() ? undefined : () => void a.open()}
        onContextMenu={a.renaming() ? undefined : ({ pagePosition }) => void a.showMenu(pagePosition)}
        style={indent(props.depth)}
        class={TREE_ROW}
      >
        {/* 让出文件夹行展开箭头的位置，文件图标和同级文件夹的图标对齐 */}
        <View class="w-3" />
        <Icon name="file" size={14} color="muted-foreground" />
        <If when={a.renaming()} else={
          <Text style={{ numberOfLines: 1 }} class="min-w-0 shrink text-[13px]" classList={{ "font-semibold text-strong": a.current(), "text-foreground": !a.current() && !props.doc.problem, "text-muted-foreground": !!props.doc.problem }}>
            {baseName(props.doc.id)}
          </Text>
        }>
          <InlineRename doc={props.doc} class="h-6 text-[13px]" />
        </If>
      </View>
      {a.more()}
    </View>
  );
}

function FolderRow(props: ListActions & { folder: string; depth: number }) {
  const name = () => baseName(props.folder);
  const open = () => {
    void settleRename();
    toggleFolder(props.folder);
  };
  const showMenu = (anchor?: Point) => showMacLibraryMenu({ folder: props.folder, open: () => {
    if (!folderExpanded(props.folder)) open();
  }, focusSearch: props.focusSearch }, anchor);
  return (
    <View>
      <View class="group flex-row items-center rounded-(--radius-sm) hover:bg-hover">
        <View
          testID={`folder-${props.folder}`}
          role="button"
          accessibilityLabel={name()}
          accessibilityState={{ expanded: folderExpanded(props.folder) }}
          onPress={open}
          onContextMenu={({ pagePosition }) => void showMenu(pagePosition)}
          style={indent(props.depth)}
          class={TREE_ROW}
        >
          <Icon name={folderExpanded(props.folder) ? "chevronDown" : "chevronRight"} size={12} color="muted-foreground" />
          <Icon name="folder" size={14} color="muted-foreground" />
          <Text style={{ numberOfLines: 1 }} class="min-w-0 shrink text-[13px] text-foreground">{name()}</Text>
        </View>
        <IconButton testID={`folder-more-${props.folder}`} icon="ellipsis" label={t(`「${name()}」的更多操作`, `More actions for “${name()}”`)} compact class={`${RIGHT_INSET} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`} onPress={() => void showMenu()} />
      </View>
      <If when={folderExpanded(props.folder)}>
        <TreeBranch folder={props.folder} depth={props.depth + 1} onPicked={props.onPicked} focusSearch={props.focusSearch} />
      </If>
    </View>
  );
}

function TreeBranch(props: ListActions & { folder: string; depth: number }) {
  const folders = () => macFolders().filter((folder) => dirOf(folder) === (props.folder ? `${props.folder}/` : "")).sort((a, b) => a.localeCompare(b));
  return (
    <>
      <Each of={folders()} key={(path) => path}>
        {(folder) => <FolderRow folder={folder()} depth={props.depth} onPicked={props.onPicked} focusSearch={props.focusSearch} />}
      </Each>
      <Each of={docsIn(props.folder)} key={(doc) => doc.id}>
        {(doc) => <TreeDocRow doc={doc()} depth={props.depth} onPicked={props.onPicked} focusSearch={props.focusSearch} />}
      </Each>
    </>
  );
}

/** macOS 文件树：最上面一行是文库本身（不能折叠），下面是文件夹和文档。 */
export function LibraryTree(props: ListActions) {
  const showMenu = (anchor?: Point) => showMacLibraryMenu({ folder: "", focusSearch: props.focusSearch }, anchor);
  return (
    <>
      <View class="group flex-row items-center rounded-(--radius-sm) hover:bg-hover">
        <View testID="library-root" onContextMenu={({ pagePosition }) => void showMenu(pagePosition)} style={indent(0)} class={TREE_ROW}>
          <Icon name="folder" size={14} color="muted-foreground" />
          <Text style={{ numberOfLines: 1 }} class="min-w-0 shrink text-[13px] font-medium text-foreground">{LIBRARY_NAME}</Text>
        </View>
        <IconButton testID="library-root-more" icon="ellipsis" label={t("文库的更多操作", "More library actions")} compact class={`${RIGHT_INSET} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`} onPress={() => void showMenu()} />
      </View>
      <TreeBranch folder="" depth={0} onPicked={props.onPicked} focusSearch={props.focusSearch} />
    </>
  );
}
