/**
 * 盖在正文上、跟着滚动的两样东西（放进 RichEditor 的 contentLayer）：
 * 提示块左上角的类型标签，和光标所在代码块右上角的「语言 / 复制」。
 * 位置用 nodeRect 现量：选区或文档变了（编辑页每次修订调 `sync` / `docChanged`）、编辑器大小变了（编辑器的 onLayout 调 `sync`）就重量。
 */
import { cleanup, effect, keymap, signal, Text, untracked, View } from "nsh";
import { type RichEditorSession, Select, type SelectItem, setNodeAttribute, setTextSelection } from "nsh/base";
import { t } from "../../i18n";
import { handleError } from "../../doc/message";
import { writeClipboard } from "../../ui/clipboard";
import { tip } from "../../ui/tooltip";
import { ALERT_KINDS } from "./commands";
import { nodeViewsLaidOut } from "./doc-index";
import { toKeymapName } from "./keys";
import { eachNode, type Node, textOf } from "./outline";
import { blockRect, type Rect } from "./selection";

/** 选语言菜单里的「纯文本」：编辑器里语言是 null。 */
const PLAIN = "__plain";
const LANGUAGES: SelectItem[] =
  ["js", "ts", "json", "python", "bash", "html", "css", "markdown", "go", "rust", "java", "c", "cpp", "sql", "yaml"].map((value) => ({ value, title: value }));

/** 「已复制」「已选中」留多久（毫秒）。 */
const COPIED_MS = 1500;

/** 提示块类型 → 标签字色；标签文字取命令表的 ALERT_KINDS（不只靠颜色：标签上有字）。 */
const ALERT_COLOR: Record<string, string> = {
  note: "text-alert-note",
  tip: "text-alert-tip",
  important: "text-alert-important",
  warning: "text-alert-warning",
  caution: "text-alert-caution",
};
const ALERT_LABEL = new Map<string, () => string>(ALERT_KINDS.map((k) => [k.alert, () => k.label]));

/** 滚动停下多久后重量位置（毫秒）：滚到的块要过一两帧才挂上。 */
const SCROLL_SETTLE = 120;

interface Placed {
  pos: number;
  rect: Rect;
}

interface Found {
  pos: number;
  node: Node;
}

function alertPositions(doc: Node): { pos: number; alert: string }[] {
  const out: { pos: number; alert: string }[] = [];
  eachNode(doc, (node, pos) => {
    const alert = node.type === "blockquote" ? node.attrs?.alert : null;
    if (typeof alert === "string" && ALERT_LABEL.has(alert)) out.push({ pos, alert });
  });
  return out;
}

export function createBlockOverlays(session: RichEditorSession) {
  const alerts = signal<(Placed & { alert: string })[]>([]);
  const code = signal<(Placed & { language: string | null; text: string }) | null>(null);
  /** 按了「复制」之后按钮上的回执：复制成了，或者没有剪贴板权限、改成选中了代码。 */
  const copied = signal<"copied" | "selected" | null>(null);
  /** 语言列表开着没有：命令「设置代码块语言」从键盘打开它。 */
  const languageOpen = signal(false);
  let known: { pos: number; alert: string }[] = [];
  let dirty = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const measure = () => {
    timer = undefined;
    if (dirty) {
      known = alertPositions(session.getJSON() as Node);
      dirty = false;
    }
    alerts.set(known.flatMap((a) => {
      const rect = blockRect(session, a.pos);
      return rect ? [{ ...a, rect }] : [];
    }));
    const found = session.findParentNode("codeBlock") as Found | null;
    const rect = found ? blockRect(session, found.pos) : null;
    if (!found || !rect) {
      if (languageOpen()) languageOpen.set(false);
      return code.set(null);
    }
    const language = typeof found.node.attrs?.language === "string" ? found.node.attrs.language : null;
    code.set({ pos: found.pos, rect, language, text: textOf(found.node) });
  };
  /** 选区动了、排版变了：下一轮重量位置。 */
  const sync = () => {
    if (timer === undefined) timer = setTimeout(measure, 0);
  };
  /**
   * 滚过了：nsh 0.7.0 起长文档只挂视口附近的块，没挂上的块量不出位置（提示块标签就没了），滚到了才挂上，编辑器不为此报修订。
   * 停下来以后再量一次。编辑器不报滚动：滚轮由外层的 onWheel 报；拖滚动条、PageDown 这类没有滚轮的，靠滚到的那一片挂上后内容高跟着变（onContentSizeChange）来报
   * （2026-11-25 web host 实测：直接改 scrollTop 跳到远处，每次都报，标签都出来了）。挂上后量出的高恰好和估的一样时不报，标签要等下一次修订。
   */
  const scrolled = () => {
    if (scrollTimer !== undefined) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrollTimer = undefined;
      sync();
    }, SCROLL_SETTLE);
  };
  /** 文档改了：提示块的位置也要重找。 */
  const docChanged = () => {
    dirty = true;
    sync();
  };
  const setLanguage = (value: string | null) => {
    const target = code();
    if (!target || value === null) return;
    session.run(setNodeAttribute(target.pos, "language", value === PLAIN ? null : value));
    session.focus();
  };
  const flash = (state: "copied" | "selected") => {
    copied.set(state);
    if (flashTimer !== undefined) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => copied.set(null), COPIED_MS);
  };
  /**
   * 写剪贴板靠 nsh.json 的 `capabilities.clipboard`（2026-11-25 开了）；写不进去时（浏览器不让写）退一步：选中整块代码，让用户自己按复制键。
   */
  const copy = () => {
    const target = code();
    if (!target) return;
    writeClipboard(target.text).then(
      () => flash("copied"),
      (e: unknown) => {
        handleError(e, { context: "copy code failed, selecting it instead", severity: "warn" });
        session.run(setTextSelection(target.pos + 1, target.pos + 1 + target.text.length));
        session.focus();
        flash("selected");
      },
    );
  };
  /** 打开光标所在代码块的语言列表；光标不在代码块里时什么也不做。 */
  const chooseLanguage = () => {
    if (code()) languageOpen.set(true);
  };
  // 节点视图变高变矮（展开 front matter、目录变长）后面的块会挪，但编辑器不报修订
  effect(() => {
    nodeViewsLaidOut();
    untracked(sync);
  });
  cleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (scrollTimer !== undefined) clearTimeout(scrollTimer);
    if (flashTimer !== undefined) clearTimeout(flashTimer);
  });
  return { alerts, code, copied, languageOpen, sync, scrolled, docChanged, setLanguage, copy, chooseLanguage };
}

export type BlockOverlaysState = ReturnType<typeof createBlockOverlays>;

function copyLabel(state: "copied" | "selected" | null): string {
  if (state === "copied") return t("已复制", "Copied");
  if (state === "selected") return t(`已选中，按 ${keymap.label(toKeymapName("Mod-c"))} 复制`, `Selected. Press ${keymap.label(toKeymapName("Mod-c"))} to copy`);
  return t("复制", "Copy");
}

/** 代码块右上角那一排的宽度：放得下语言、「已选中，按 ⌘C 复制」。按钮靠右排，空着的部分不接点击。 */
const TOOLS_WIDTH = 240;

const TOOL = "h-6 flex-row items-center rounded-(--radius-sm) px-2 hover:bg-hover active:bg-pressed";

function CodeTools(props: { o: BlockOverlaysState; at: Placed & { language: string | null } }) {
  const value = () => props.at.language ?? PLAIN;
  const items = () => {
    const language = value();
    const options = [{ value: PLAIN, title: t("纯文本", "Plain text") }, ...LANGUAGES];
    return options.some((option) => option.value === language) ? options : [...options, { value: language, title: language }];
  };
  return (
    <View
      testID="code-tools"
      style={{ left: props.at.rect.x + props.at.rect.width - TOOLS_WIDTH - 4, top: props.at.rect.y + 4, width: TOOLS_WIDTH, pointerEvents: "box-none" }}
      class="absolute flex-row items-center justify-end gap-1"
    >
      <Select
        testID="code-language"
        accessibilityLabel={t("代码块的语言", "Code block language")}
        items={items()}
        value={value()}
        open={props.o.languageOpen()}
        onOpenChange={({ open }) => props.o.languageOpen.set(open)}
        onChange={({ value: v }) => props.o.setLanguage(v)}
        searchable
        searchPlaceholder={t("搜语言", "Search languages")}
        searchAccessibilityLabel={t("搜语言", "Search languages")}
        searchClass="mb-1 h-7 rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground"
        popupClass="w-[180px] rounded-(--radius) border border-border bg-popover p-1 shadow-md"
        listClass="max-h-[240px]"
        itemClass="h-7 justify-center rounded-(--radius-sm) px-2 text-[13px] text-popover-foreground focus:bg-hover selected:text-primary"
        trigger={
          <View class={`${TOOL} gap-1 bg-popover`} tooltip={tip(t("换代码块的语言（决定怎么上色）", "Change the language used for syntax highlighting"))}>
            <Text class="font-mono text-[11px] text-muted-foreground">{props.at.language ?? t("纯文本", "Plain text")}</Text>
            <Text class="text-[9px] text-muted-foreground">▾</Text>
          </View>
        }
      />
      <View testID="code-copy" role="button" accessibilityLabel={t("复制代码", "Copy code")} tooltip={tip(t("复制这个代码块的代码", "Copy this code block"))} onPress={props.o.copy} class={`${TOOL} bg-popover`}>
        <Text class="text-[11px] text-muted-foreground">{copyLabel(props.o.copied())}</Text>
      </View>
    </View>
  );
}

/** 放进 RichEditor 的 contentLayer：位置用正文内容框里的点。 */
export function BlockOverlays(props: { overlays: BlockOverlaysState }) {
  const o = props.overlays;
  return (
    <>
      <Each of={o.alerts()} key={(a) => `${a.pos}:${a.alert}`}>
        {(a) => (
          <Text
            testID="alert-label"
            style={{ left: a().rect.x + 19, top: a().rect.y + 6, pointerEvents: "none" }}
            class={`absolute text-[13px] font-semibold leading-[18px] ${ALERT_COLOR[a().alert]}`}
          >
            {ALERT_LABEL.get(a().alert)?.()}
          </Text>
        )}
      </Each>
      <If when={o.code()}>{(at) => <CodeTools o={o} at={at()} />}</If>
    </>
  );
}
