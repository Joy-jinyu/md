/** 设置里的「快捷键」一类：列出全部命令和它的键，可以改、清除、恢复默认。布局见 DESIGN.md「屏幕：设置」。 */
import { keymap, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { IN_BROWSER, SYSTEM_KEYS } from "../../platform";
import type { ShortcutOverrides } from "../../store/settings";
import { Button } from "../../ui/button";
import { type AppCommand, COMMANDS, isViewCommand } from "../editor/commands";
import { browserMayTake, canonical, conflictOf, currentOverrides, fromKeymapName, keyOf, recordableKeystrokes, rejectReason } from "../editor/keybindings";
import { toKeymapName } from "../editor/keys";

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

/** 改键的草稿和操作：设置页打开时建一份，回到编辑页时交出草稿。 */
export function createShortcutEditor() {
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

export type ShortcutEditor = ReturnType<typeof createShortcutEditor>;
type Editor = ShortcutEditor;

function KeyCap(props: { text: string }) {
  return (
    <View class="rounded-(--radius-sm) bg-secondary px-1.5 py-0.5">
      <Text style={{ fontVariant: ["tabular-nums"] }} class="select-text text-[11px] text-foreground">
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

/** 按钮列定宽、靠左排：「修改」「清除」每行都在同一个位置，键贴在按钮列左边、靠右对齐。宽度放得下三个按钮。 */
const ACTIONS = "w-40 shrink-0";

/** 一行平时的样子：现在的键、「已改」，和修改 / 清除 / 恢复三个按钮。 */
function RowActions(props: { command: AppCommand; editor: Editor }) {
  const ed = props.editor;
  const c = props.command;
  const key = () => keyOf(c, ed.draft());
  const changed = () => c.id in ed.draft();
  return (
    <>
      <View class="flex-row items-center gap-2">
        <If when={changed()}>
          <Text class="text-[11px] text-primary">已改</Text>
        </If>
        <If when={key()} else={<Text class="text-[11px] text-muted-foreground">未设置</Text>}>
          {(k) => <KeyCap text={label(k())} />}
        </If>
      </View>
      <View class={`${ACTIONS} flex-row items-center gap-1`}>
        <Button testID={`shortcut-edit-${c.id}`} label="修改" accessibilityLabel={`修改「${c.label}」的快捷键`} onPress={() => ed.begin(c)} />
        <If when={key()}>
          <Button testID={`shortcut-clear-${c.id}`} label="清除" accessibilityLabel={`清除「${c.label}」的快捷键`} onPress={() => ed.clear(c)} />
        </If>
        <If when={changed()}>
          <Button testID={`shortcut-restore-${c.id}`} label="恢复" accessibilityLabel={`「${c.label}」恢复默认键`} onPress={() => ed.restore(c)} />
        </If>
      </View>
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
      <View class="min-h-9 flex-row items-center gap-2 rounded-(--radius-sm) px-2" classList={{ "bg-hover": isRecording(), "hover:bg-hover": !isRecording() }}>
        <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 select-text text-[13px] text-foreground">
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
            <Text class="min-w-0 flex-1 select-text text-xs leading-5 text-warn">{n().text}</Text>
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
          <View class="min-h-9 flex-row items-center gap-2 rounded-(--radius-sm) px-2 hover:bg-hover">
            <Text class="min-w-0 flex-1 select-text text-[13px] text-muted-foreground">{k().label}</Text>
            <Each of={k().keys} key={(name) => name}>
              {(name) => <KeyCap text={keymap.label(name())} />}
            </Each>
            <View class={ACTIONS} />
          </View>
        )}
      </Each>
    </View>
  );
}

/** 搜索框、「全部恢复默认」和命令表。`autoFocus`：设置页一打开就在这一类时，焦点给搜索框。 */
export function ShortcutsPanel(props: { editor: ShortcutEditor; autoFocus: boolean }) {
  const ed = props.editor;
  return (
    <View testID="shortcuts" class="gap-2">
      <View class="flex-row flex-wrap items-center justify-between gap-2">
        <Input
          testID="shortcut-search"
          autoFocus={props.autoFocus}
          value={ed.query()}
          onChange={({ value }) => ed.query.set(value)}
          placeholder="搜索命令或按键"
          accessibilityLabel="搜索命令或按键"
          autoCapitalize="none"
          autoCorrect={false}
          class="h-8 w-[240px] min-w-0 max-w-[480px] shrink grow rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary"
        />
        <Button
          testID="shortcut-reset-all"
          label={ed.confirmReset() ? "再点一次确认" : "全部恢复默认"}
          labelClass={ed.confirmReset() ? "text-destructive" : ""}
          disabled={Object.keys(ed.draft()).length === 0}
          onPress={ed.resetAll}
        />
      </View>
      <View>
        <Each of={rowsFor(ed.query(), ed.draft())} key={(r) => (r.kind === "group" ? `group:${r.name}` : r.command.id)}>
          {(r) => {
            const row = r();
            return row.kind === "group" ? <Text class="px-2 pb-1 pt-3 text-[11px] text-faint">{row.name}</Text> : <CommandRow command={row.command} editor={ed} />;
          }}
        </Each>
        <If when={ed.query().trim() === ""}>
          <SystemKeys />
        </If>
      </View>
    </View>
  );
}
