/** 设置里的「快捷键」一类：列出全部命令和它的键，可以改、清除、恢复默认。布局见 DESIGN.md「屏幕：设置」。 */
import { type Phrase, phrase, t } from "../../i18n";
import { keymap, signal, Text, View } from "nsh";
import { Button as BaseButton, Input } from "nsh/base";
import { IN_BROWSER, SYSTEM_KEYS } from "../../platform";
import type { ShortcutOverrides } from "../../store/settings";
import { Button } from "../../ui/button";
import { IconButton } from "../../ui/icon-button";
import { tip } from "../../ui/tooltip";
import { Group } from "./parts";
import { type AppCommand, COMMANDS, commandGroupLabel, isViewCommand, type CommandGroup } from "../editor/commands";
import { browserMayTake, canonical, conflictOf, currentOverrides, fromKeymapName, keyOf, recordableKeystrokes, rejectReason } from "../editor/keybindings";
import { toKeymapName } from "../editor/keys";

/** 行下面的一条话：拒绝的原因、提醒，或者撞键时等用户选。 */
interface RowNote {
  id: string;
  text: Phrase;
  /** 撞键时：要设的键，和现在用着它的那条命令。 */
  swap?: { key: string; other: AppCommand };
}

type Row = { kind: "group"; name: CommandGroup } | { kind: "command"; command: AppCommand };

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
    return c.label.toLowerCase().includes(q) || c.keywords.some((w) => w.includes(q)) || commandGroupLabel(c.group).toLowerCase().includes(q) || (key !== undefined && label(key).toLowerCase().includes(q));
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
    if (reason) return note.set({ id: c.id, text: () => t(`${label(key)}：${rejectReason(key, !isViewCommand(c))}`, `${label(key)}: ${rejectReason(key, !isViewCommand(c))}`) });
    const other = conflictOf(key, c.id, draft());
    if (other) return note.set({ id: c.id, text: () => t(`${label(key)} 已被「${other.label}」使用`, `${label(key)} is already used by “${other.label}”.`), swap: { key, other } });
    set(c, key);
    note.set(IN_BROWSER && browserMayTake(key) ? { id: c.id, text: () => t(`${label(key)}：在浏览器里可能被浏览器先处理，按了没反应就换一个`, `The browser may intercept ${label(key)}. Choose another shortcut if this one doesn’t work.`) } : null);
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
      const key = c.key;
      if (key !== undefined && other) return note.set({ id: c.id, text: () => t(`默认键 ${label(key)} 现在被「${other.label}」用着`, `The default shortcut ${label(key)} is now used by “${other.label}”.`), swap: { key, other } });
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

/** 行尾定宽的一列放「清除」「恢复」两个小图标按钮：每行的键都贴着它对齐，系统键那几行也留出这一列。 */
const ACTIONS = "w-[60px] shrink-0 flex-row items-center justify-end gap-0.5";

/** 现在的键，本身就是「修改」按钮：点了开始录键。没有键时写「未设置」。 */
function KeyChip(props: { command: AppCommand; editor: Editor }) {
  const ed = props.editor;
  const c = props.command;
  const key = () => keyOf(c, ed.draft());
  return (
    <BaseButton
      testID={`shortcut-edit-${c.id}`}
      accessibilityLabel={key() ? t(`修改「${c.label}」的快捷键，现在是 ${label(key() as string)}`, `Change the shortcut for “${c.label}” (now ${label(key() as string)})`) : t(`给「${c.label}」设快捷键`, `Set a shortcut for “${c.label}”`)}
      tooltip={tip(t("点击修改", "Click to change"))}
      onPress={() => ed.begin(c)}
      class="min-h-7 min-w-[72px] flex-row items-center justify-center rounded-(--radius-sm) border border-input bg-background px-1.5 transition duration-180 ease-settle hover:border-primary hover:bg-hover active:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
    >
      <If when={key()} else={<Text class="text-[11px] text-muted-foreground">{t("未设置", "None")}</Text>}>
        {(k) => (
          <Text style={{ fontVariant: ["tabular-nums"] }} class="text-[12px] text-strong">
            {label(k())}
          </Text>
        )}
      </If>
    </BaseButton>
  );
}

/** 一行平时的样子：「已改」、现在的键（点了修改），和清除 / 恢复两个图标按钮。 */
function RowActions(props: { command: AppCommand; editor: Editor }) {
  const ed = props.editor;
  const c = props.command;
  const changed = () => c.id in ed.draft();
  return (
    <>
      <If when={changed()}>
        <Text class="text-[11px] text-primary">{t("已改", "Customized")}</Text>
      </If>
      <KeyChip command={c} editor={ed} />
      <View class={ACTIONS}>
        <If when={keyOf(c, ed.draft())}>
          <IconButton testID={`shortcut-clear-${c.id}`} icon="close" compact label={t(`清除「${c.label}」的快捷键`, `Clear the shortcut for “${c.label}”`)} tooltip={t("清除", "Clear")} onPress={() => ed.clear(c)} />
        </If>
        <If when={changed()}>
          <IconButton testID={`shortcut-restore-${c.id}`} icon="rotateCcw" compact label={t(`「${c.label}」恢复默认键`, `Reset the shortcut for “${c.label}”`)} tooltip={t("恢复默认", "Reset to default")} onPress={() => ed.restore(c)} />
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
    <View testID={`shortcut-${c.id}`} class="border-t border-border">
      <View class="min-h-11 flex-row items-center gap-2 px-4 py-1.5" classList={{ "bg-hover": isRecording(), "hover:bg-hover": !isRecording() }}>
        <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 select-text text-[13px] text-foreground">
          {c.label}
        </Text>
        <If when={isRecording()} else={<RowActions command={c} editor={ed} />}>
          <KeyRecorder onKey={(key) => ed.pressed(c, key)} onCancel={ed.cancel} />
          <View testID="shortcut-capture" role="alert" class="min-h-7 justify-center rounded-(--radius-sm) border border-primary bg-background px-2">
            <Text class="text-xs text-primary">{t("请按下新的组合键（Esc 取消）", "Press a new key combination (Esc to cancel)")}</Text>
          </View>
          <Button label={t("取消", "Cancel")} onPress={ed.cancel} />
        </If>
      </View>
      <If when={mine()}>
        {(n) => (
          <View testID="shortcut-note" role="alert" class="mx-4 mb-2 flex-row flex-wrap items-center gap-2 rounded-(--radius-sm) bg-warn-tint px-3 py-1.5">
            <Text class="min-w-0 flex-1 select-text text-xs leading-5 text-warn-text">{phrase(n().text)}</Text>
            <If when={n().swap}>
              <Button testID="shortcut-swap" variant="outline" label={t("换给这条", "Assign to this command")} onPress={() => ed.swap(c)} />
              <Button label={t("取消", "Cancel")} onPress={ed.cancel} />
            </If>
          </View>
        )}
      </If>
    </View>
  );
}

function SystemKeys() {
  return (
    <Group testID="system-keys" title={t("系统键（不能改）", "System shortcuts (fixed)")}>
      <Each of={SYSTEM_KEYS} key={(k) => k.label}>
        {(k) => (
          <View class="min-h-11 flex-row items-center gap-2 border-t border-border px-4 py-1.5">
            <Text class="min-w-0 flex-1 select-text text-[13px] text-muted-foreground">{k().label}</Text>
            <Each of={k().keys} key={(name) => name}>
              {(name) => <KeyCap text={keymap.label(name())} />}
            </Each>
            <View class={ACTIONS} />
          </View>
        )}
      </Each>
    </Group>
  );
}

/** 按组排好的命令（搜索过滤后），一组一张卡片。 */
function groupsFor(query: string, draft: ShortcutOverrides): { name: CommandGroup; commands: AppCommand[] }[] {
  const groups: { name: CommandGroup; commands: AppCommand[] }[] = [];
  for (const row of rowsFor(query, draft)) {
    if (row.kind === "group") groups.push({ name: row.name, commands: [] });
    else groups[groups.length - 1] = { ...groups[groups.length - 1], commands: [...groups[groups.length - 1].commands, row.command] };
  }
  return groups;
}

/** 搜索框、「全部恢复默认」和命令表。`autoFocus`：设置页一打开就在这一类时，焦点给搜索框。 */
export function ShortcutsPanel(props: { editor: ShortcutEditor; autoFocus: boolean }) {
  const ed = props.editor;
  return (
    <View testID="shortcuts" class="gap-6">
      <View class="flex-row flex-wrap items-center gap-2">
        <Input
          testID="shortcut-search"
          autoFocus={props.autoFocus}
          value={ed.query()}
          onChange={({ value }) => ed.query.set(value)}
          placeholder={t("搜索命令或按键", "Search commands or shortcuts")}
          accessibilityLabel={t("搜索命令或按键", "Search commands or shortcuts")}
          autoCapitalize="none"
          autoCorrect={false}
          class="h-8 w-[240px] min-w-0 max-w-[360px] shrink grow rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary"
        />
        <Button
          testID="shortcut-reset-all"
          variant={ed.confirmReset() ? "danger" : "outline"}
          label={ed.confirmReset() ? t("再点一次确认", "Click again to confirm") : t("全部恢复默认", "Reset all to defaults")}
          disabled={Object.keys(ed.draft()).length === 0}
          onPress={ed.resetAll}
        />
      </View>
      <If when={groupsFor(ed.query(), ed.draft()).length > 0} else={<Text class="px-1 text-[13px] text-muted-foreground">{t("没有找到命令", "No matching commands")}</Text>}>
        <Each of={groupsFor(ed.query(), ed.draft())} key={(g) => g.name}>
          {(g) => (
            <Group title={commandGroupLabel(g().name)}>
              <Each of={g().commands} key={(c) => c.id}>
                {(c) => <CommandRow command={c()} editor={ed} />}
              </Each>
            </Group>
          )}
        </Each>
      </If>
      <If when={ed.query().trim() === ""}>
        <SystemKeys />
      </If>
    </View>
  );
}
