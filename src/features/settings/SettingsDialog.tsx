/** 设置对话框，两页：「快捷键」列出全部命令和它的键，可以改、清除、恢复默认；「存储」见 StoragePanel.tsx。布局见 DESIGN.md「屏幕：设置」。 */
import { effect, keymap, Scroll, signal, Text, untracked, View } from "nsh";
import { Dialog, Input } from "nsh/base";
import { IN_BROWSER, SYSTEM_KEYS } from "../../platform";
import type { ShortcutOverrides } from "../../store/settings";
import { Button } from "../../ui/button";
import { type AppCommand, COMMANDS, isViewCommand } from "../editor/commands";
import { browserMayTake, canonical, conflictOf, currentOverrides, fromKeymapName, keyOf, recordableKeystrokes, rejectReason, sanitize } from "../editor/keybindings";
import { toKeymapName } from "../editor/keys";
import { returnFocusToEditor } from "../editor/ui-state";
import { settingsOpen, settingsPage } from "./open";
import { StoragePanel } from "./StoragePanel";
import { SyncPanel } from "./SyncPanel";

/** 行下面的一条话：拒绝的原因、提醒，或者撞键时等用户选。 */
interface RowNote {
  id: string;
  text: string;
  /** 撞键时：要设的键，和现在用着它的那条命令。 */
  swap?: { key: string; other: AppCommand };
}

type Row = { kind: "group"; name: string } | { kind: "command"; command: AppCommand };

const label = (key: string) => keymap.label(toKeymapName(key));

/** 把 `c` 的键设成 `key`（null 是清除）：和默认一样就不记，本来没有键的命令清除也不记。 */
function withKey(from: ShortcutOverrides, c: AppCommand, key: string | null): ShortcutOverrides {
  const { [c.id]: _dropped, ...rest } = from;
  if (key === null) return c.key === undefined ? rest : { ...rest, [c.id]: null };
  return c.key !== undefined && canonical(c.key) === canonical(key) ? rest : { ...rest, [c.id]: canonical(key) };
}

function rowsFor(query: string, draft: ShortcutOverrides): Row[] {
  const q = query.trim().toLowerCase();
  const hit = (c: AppCommand) => {
    if (q === "") return true;
    const key = keyOf(c, draft);
    return c.label.toLowerCase().includes(q) || c.keywords.some((w) => w.includes(q)) || (key !== undefined && label(key).toLowerCase().includes(q));
  };
  const rows: Row[] = [];
  for (const c of COMMANDS.filter(hit)) {
    const last = rows.findLast((r) => r.kind === "group");
    if (!last || last.name !== c.group) rows.push({ kind: "group", name: c.group });
    rows.push({ kind: "command", command: c });
  }
  return rows;
}

function createShortcutEditor() {
  const draft = signal<ShortcutOverrides>({});
  const recording = signal<string | null>(null);
  const note = signal<RowNote | null>(null);
  const query = signal("");
  const confirmReset = signal(false);

  const set = (c: AppCommand, key: string | null) => {
    draft.set(withKey(draft(), c, key));
    recording.set(null);
    confirmReset.set(false);
  };
  /** 录键时按下了一个组合键。 */
  const pressed = (c: AppCommand, key: string) => {
    const reason = rejectReason(key, !isViewCommand(c));
    if (reason) return note.set({ id: c.id, text: `${label(key)}：${reason}` });
    const other = conflictOf(key, c.id, draft());
    if (other) return note.set({ id: c.id, text: `${label(key)} 已被「${other.label}」使用`, swap: { key, other } });
    set(c, key);
    note.set(IN_BROWSER && browserMayTake(key) ? { id: c.id, text: `${label(key)}：在浏览器里可能被浏览器先处理，按了没反应就换一个` } : null);
  };
  const swap = (c: AppCommand) => {
    const pending = note()?.swap;
    if (!pending) return;
    draft.set(withKey(withKey(draft(), pending.other, null), c, pending.key));
    recording.set(null);
    note.set(null);
  };
  return {
    draft,
    recording,
    note,
    query,
    confirmReset,
    pressed,
    swap,
    begin: (c: AppCommand) => {
      note.set(null);
      recording.set(c.id);
    },
    cancel: () => {
      recording.set(null);
      note.set(null);
    },
    clear: (c: AppCommand) => {
      note.set(null);
      set(c, null);
    },
    /** 恢复默认键。默认键这会儿被别的命令用着时不直接抢，和录键撞键一样让用户选。 */
    restore: (c: AppCommand) => {
      const { [c.id]: _dropped, ...rest } = draft();
      const other = c.key === undefined ? undefined : conflictOf(c.key, c.id, rest);
      if (c.key !== undefined && other) return note.set({ id: c.id, text: `默认键 ${label(c.key)} 现在被「${other.label}」用着`, swap: { key: c.key, other } });
      note.set(null);
      draft.set(rest);
    },
    resetAll: () => {
      if (!confirmReset()) return confirmReset.set(true);
      draft.set({});
      note.set(null);
      confirmReset.set(false);
    },
    open: () => {
      draft.set({ ...currentOverrides() });
      recording.set(null);
      note.set(null);
      query.set("");
      confirmReset.set(false);
    },
  };
}

type Editor = ReturnType<typeof createShortcutEditor>;

function KeyCap(props: { text: string }) {
  return (
    <View class="rounded-(--radius-sm) bg-secondary px-1.5 py-0.5">
      <Text style={{ fontVariant: ["tabular-nums"] }} class="text-[11px] text-foreground">
        {props.text}
      </Text>
    </View>
  );
}

/**
 * 录键：出现期间把所有可能的组合键都绑到应用级 keymap 上，按下哪个就报哪个；随组件消失一起解绑。
 * 系统留着的键（Cmd+Q 这些）keymap 不让绑、会抛错，跳过就行：它们本来也不能当快捷键。
 */
function KeyRecorder(props: { onKey: (key: string) => void; onCancel: () => void }) {
  for (const keystroke of recordableKeystrokes()) {
    try {
      keymap.bind(keystroke, () => props.onKey(fromKeymapName(keystroke)), { when: "always" });
    } catch (e) {
      console.debug("not bindable, skipped while recording", keystroke, e);
    }
  }
  keymap.bind("escape", props.onCancel, { when: "always" });
  return null;
}

/** 一行平时的样子：现在的键、「已改」，和修改 / 清除 / 恢复三个按钮。 */
function RowActions(props: { command: AppCommand; editor: Editor }) {
  const ed = props.editor;
  const c = props.command;
  const key = () => keyOf(c, ed.draft());
  const changed = () => c.id in ed.draft();
  return (
    <>
      <If when={key()} else={<Text class="text-[11px] text-muted-foreground">未设置</Text>}>
        {(k) => <KeyCap text={label(k())} />}
      </If>
      <If when={changed()}>
        <Text class="text-[11px] text-primary">已改</Text>
      </If>
      <Button testID={`shortcut-edit-${c.id}`} label="修改" accessibilityLabel={`修改「${c.label}」的快捷键`} onPress={() => ed.begin(c)} />
      <If when={key()}>
        <Button testID={`shortcut-clear-${c.id}`} label="清除" accessibilityLabel={`清除「${c.label}」的快捷键`} onPress={() => ed.clear(c)} />
      </If>
      <If when={changed()}>
        <Button testID={`shortcut-restore-${c.id}`} label="恢复" accessibilityLabel={`「${c.label}」恢复默认键`} onPress={() => ed.restore(c)} />
      </If>
    </>
  );
}

function CommandRow(props: { command: AppCommand; editor: Editor }) {
  const ed = props.editor;
  const c = props.command;
  const isRecording = () => ed.recording() === c.id;
  const mine = () => (ed.note()?.id === c.id ? ed.note() : null);
  return (
    <View testID={`shortcut-${c.id}`}>
      <View class="min-h-9 flex-row items-center gap-2 rounded-(--radius-sm) px-2" classList={{ "bg-hover": isRecording() }}>
        <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 text-[13px] text-foreground">
          {c.label}
        </Text>
        <If
          when={isRecording()}
          else={
            <RowActions command={c} editor={ed} />
          }
        >
          <KeyRecorder onKey={(key) => ed.pressed(c, key)} onCancel={ed.cancel} />
          <View testID="shortcut-capture" role="alert">
            <Text class="text-xs text-primary">请按下新的组合键（Esc 取消）</Text>
          </View>
          <Button label="取消" onPress={ed.cancel} />
        </If>
      </View>
      <If when={mine()}>
        {(n) => (
          <View testID="shortcut-note" role="alert" class="mb-1 flex-row items-center gap-2 rounded-(--radius-sm) bg-warn-tint px-2 py-1">
            <Text class="min-w-0 flex-1 text-xs leading-5 text-warn">{n().text}</Text>
            <If when={n().swap}>
              <Button testID="shortcut-swap" label="换给这条" onPress={() => ed.swap(c)} />
              <Button label="取消" onPress={ed.cancel} />
            </If>
          </View>
        )}
      </If>
    </View>
  );
}

function SystemKeys() {
  return (
    <View testID="system-keys">
      <Text class="px-2 pb-1 pt-3 text-[11px] text-faint">系统键（不能改）</Text>
      <Each of={SYSTEM_KEYS} key={(k) => k.label}>
        {(k) => (
          <View class="min-h-9 flex-row items-center gap-2 px-2">
            <Text class="min-w-0 flex-1 text-[13px] text-muted-foreground">{k().label}</Text>
            <Each of={k().keys} key={(name) => name}>
              {(name) => <KeyCap text={keymap.label(name())} />}
            </Each>
          </View>
        )}
      </Each>
    </View>
  );
}

function Footer(props: { editor: Editor; onDone: () => void }) {
  const ed = props.editor;
  return (
    <View class="flex-row items-center gap-2 border-t border-border px-4 py-3">
      <Text class="min-w-0 flex-1 text-xs text-muted-foreground">改键后编辑页会重新载入，撤销记录清空</Text>
      <Button
        testID="shortcut-reset-all"
        label={ed.confirmReset() ? "再点一次确认" : "全部恢复默认"}
        labelClass={ed.confirmReset() ? "text-destructive" : ""}
        disabled={Object.keys(ed.draft()).length === 0}
        onPress={ed.resetAll}
      />
      <Button testID="settings-done" label="完成" variant="primary" onPress={props.onDone} />
    </View>
  );
}

type Page = "shortcuts" | "storage" | "sync";

function PageTab(props: { page: Page; label: string; current: () => Page; onPick: (page: Page) => void }) {
  const on = () => props.current() === props.page;
  return (
    <View
      testID={`settings-tab-${props.page}`}
      role="tab"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: on() }}
      onPress={() => props.onPick(props.page)}
      class="h-7 items-center justify-center rounded-(--radius-sm) px-3 hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      classList={{ "bg-pressed": on() }}
    >
      <Text class="text-sm" classList={{ "font-semibold text-strong": on(), "text-muted-foreground": !on() }}>
        {props.label}
      </Text>
    </View>
  );
}

/**
 * 对话框开着、没在录键时 Esc 关掉它。走应用级 keymap（最新的绑定先跑），不靠对话框自己的 closeOnEscape：
 * macOS 窗口里从 Cmd+, 或菜单打开时焦点还在编辑器里，第一下 Esc 被编辑器接走，要按两下才关（2026-11-25 用户实测）；
 * 查找条用的也是这个办法，一下就关。录键时由 KeyRecorder 的 Esc 绑定取消录键。
 */
function EscapeCloses(props: { onEscape: () => void }) {
  keymap.bind("escape", props.onEscape, { when: "always" });
  return null;
}

/** `onApply`：关掉对话框时键有变化才调，交出整理过的改动。 */
export function SettingsDialog(props: { onApply: (next: ShortcutOverrides) => void }) {
  const ed = createShortcutEditor();
  const page = signal<Page>("shortcuts");
  effect(() => {
    if (!settingsOpen()) return;
    untracked(() => {
      ed.open();
      const wanted = settingsPage();
      if (wanted) page.set(wanted);
      settingsPage.set(null);
    });
  });
  const close = () => {
    if (!settingsOpen()) return;
    settingsOpen.set(false);
    returnFocusToEditor();
    const next = sanitize(ed.draft());
    if (JSON.stringify(next) !== JSON.stringify(currentOverrides())) props.onApply(next);
  };
  return (
    <Dialog
      testID="settings"
      open={settingsOpen()}
      animation="fade"
      accessibilityLabel="设置"
      closeOnEscape={ed.recording() === null}
      closeOnBackdropPress
      onOpenChange={({ open }) => !open && close()}
      backdropClass="bg-scrim"
      class="mx-auto mt-16 w-full max-w-[640px] px-4"
    >
      <If when={ed.recording() === null}>
        <EscapeCloses onEscape={close} />
      </If>
      <View class="overflow-hidden rounded-(--radius) border border-border bg-popover">
        <View class="flex-row items-center gap-3 border-b border-border px-4 py-3">
          <View role="tablist" class="shrink-0 flex-row gap-1">
            <PageTab page="shortcuts" label="快捷键" current={page} onPick={(p) => page.set(p)} />
            <PageTab page="storage" label="存储" current={page} onPick={(p) => page.set(p)} />
            <PageTab page="sync" label="同步" current={page} onPick={(p) => page.set(p)} />
          </View>
          <If when={page() === "shortcuts"}>
          <Input
            testID="shortcut-search"
            autoFocus
            value={ed.query()}
            onChange={({ value }) => ed.query.set(value)}
            placeholder="搜索命令或按键"
            accessibilityLabel="搜索命令或按键"
            autoCapitalize="none"
            autoCorrect={false}
            class="ml-auto h-7 w-[180px] min-w-0 shrink rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary"
          />
          </If>
        </View>
        <If when={page() === "sync"}>
          <SyncPanel />
        </If>
        <If when={page() === "storage"}>
          <StoragePanel inBrowser={IN_BROWSER} />
        </If>
        <If when={page() !== "shortcuts"}>
          <View class="flex-row items-center justify-end border-t border-border px-4 py-3">
            <Button testID="settings-done" label="完成" variant="primary" autoFocus onPress={close} />
          </View>
        </If>
        <If when={page() === "shortcuts"}>
        <Scroll class="max-h-[440px] px-2 pb-2">
          <Each of={rowsFor(ed.query(), ed.draft())} key={(r) => (r.kind === "group" ? `group:${r.name}` : r.command.id)}>
            {(r) => {
              const row = r();
              return row.kind === "group" ? <Text class="px-2 pb-1 pt-3 text-[11px] text-faint">{row.name}</Text> : <CommandRow command={row.command} editor={ed} />;
            }}
          </Each>
          <If when={ed.query().trim() === ""}>
            <SystemKeys />
          </If>
        </Scroll>
        <Footer editor={ed} onDone={close} />
        </If>
      </View>
    </Dialog>
  );
}
