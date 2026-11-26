/**
 * 原子节点的节点视图（只改显示，不改文档）：公式排版、目录、脚注、front matter 折叠、HTML 预览；
 * 改源码走编辑框（AtomPrompt），选中后操作条上点「编辑」。
 */
import { Image, type JSX, signal, Text, View } from "nsh";
import { type RichNodeViewProps, TextView } from "nsh/base";
import { phrase, t } from "../../i18n";
import { Button } from "../../ui/button";
import { tip } from "../../ui/tooltip";
import { buildIndex, docIndex, footnoteLabel, noteNodeViewLayout, revealNode, revealText } from "./doc-index";
import { columnWidth } from "./images";
import { nodePress } from "./node-press";
import { diagramShown } from "./mermaid";
import { type HeadingEntry, headingStarts, type Node } from "./outline";
import type { AtomNodeName, AtomNodeView } from "./schema";

const attr = (props: RichNodeViewProps, name: string): string => {
  const value = props.node.attrs[name];
  return typeof value === "string" ? value : "";
};

/** front matter 的一行摘要：「Front matter · N 行 · 第一行」。 */
export function frontMatterSummary(yaml: string): string {
  const lines = yaml.split("\n").filter((line) => line.trim() !== "");
  return lines.length === 0 ? t("Front matter · 空", "Front matter · Empty") : t(`Front matter · ${lines.length} 行 · ${lines[0].trim()}`, `Front matter · ${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${lines[0].trim()}`);
}

/** 块的外框：浅底、圆角；被选中时边框换成主色。`dashed` 是还没画出来、显示源码的块（Mermaid 渲染中、出错）。 */
function Frame(props: { selected: boolean; dashed?: boolean; children: JSX.Element }) {
  return (
    <View
      onLayout={noteNodeViewLayout}
      class="gap-1 rounded-(--radius-sm) border bg-muted px-4 py-3"
      classList={{ "border-primary": props.selected, "border-transparent": !props.selected && !props.dashed, "border-dashed border-border-strong": !props.selected && !!props.dashed }}
    >
      {props.children}
    </View>
  );
}

function Label(props: { text: string }) {
  return <Text class="text-[11px] text-muted-foreground">{props.text}</Text>;
}

function Source(props: { text: string; faint?: boolean; oneLine?: boolean }) {
  return (
    <Text
      style={props.oneLine ? { numberOfLines: 1 } : undefined}
      class="font-mono text-[14px] leading-[22px]"
      classList={{ "text-faint": !!props.faint, "text-muted-foreground": !props.faint }}
    >
      {props.text}
    </Text>
  );
}

/** 行内源码：等宽、浅底的小块。 */
function SourceInline(props: { selected: boolean; source: string }) {
  return (
    <View class="rounded-(--radius-sm) border bg-muted px-1" classList={{ "border-primary": props.selected, "border-transparent": !props.selected }}>
      <Text class="font-mono text-[15px] text-muted-foreground">{props.source}</Text>
    </View>
  );
}

/** 公式交给 TextView 排版（nsh 0.6.0 不给 renderMath 也会排，web host 实测）；它读不懂的 TeX 自己显示成等宽源码。 */
const MATH_CLASSES = { root: "text-[17px] text-foreground" };

/**
 * 行内公式排出来比正文小一圈：x、M 的字高约是正文的 0.9，分数、上下标更小；
 * 类和 styles 里的字号对公式都不起作用（2026-11-25 nsh 0.6.0 web host 实测，root / paragraph / math 设 8px 或 30px 都不变），只能整体放大。
 */
const INLINE_MATH_SCALE = 1.1;

/** 把里面的东西按 `scale` 放大，并用外边距把放大后的大小让出来（变换本身不占排版位置）。 */
function Scaled(props: { scale: number; children: JSX.Element }) {
  const size = signal({ width: 0, height: 0 });
  const extra = (n: number) => n * (props.scale - 1);
  return (
    <View
      onLayout={(e) => size.set({ width: e.bounds.size.width, height: e.bounds.size.height })}
      style={{ scale: props.scale, transformOrigin: "left top", marginRight: extra(size().width), marginBottom: extra(size().height) }}
    >
      {props.children}
    </View>
  );
}

/** 以 `$$` 开头的行：公式块的源码里有它，拼成 `$$…$$` 交给 TextView 时会提前收尾，后面的内容被当成 Markdown 排版。 */
export const MATH_FENCE_LINE = /^[ \t]*\$\$/m;

function MathBlockView(p: RichNodeViewProps) {
  const tex = () => attr(p, "tex").trim();
  return (
    <View
      onLayout={noteNodeViewLayout}
      accessibilityLabel={t(`公式：${tex()}`, `Formula: ${tex()}`)}
      class="min-h-11 justify-center rounded-(--radius-sm) border px-4 py-2"
      classList={{ "border-primary": p.selected, "border-transparent": !p.selected }}
    >
      <If when={tex() !== ""} else={<Text class="text-[14px] text-faint">{t("空公式，选中后点「编辑」写 LaTeX", "Empty formula. Select it and choose Edit to enter LaTeX.")}</Text>}>
        <If when={!MATH_FENCE_LINE.test(tex())} else={<Source text={tex()} />}>
          <TextView markdown={`$$\n${tex()}\n$$`} classes={MATH_CLASSES} />
        </If>
      </If>
    </View>
  );
}

function MathInlineView(p: RichNodeViewProps) {
  const tex = () => attr(p, "tex").trim();
  // 源码里有 `$` 时拼成 `$…$` 会提前收尾，剩下的被当成 Markdown：直接显示源码
  return (
    <If when={!tex().includes("$")} else={<SourceInline selected={p.selected} source={tex()} />}>
      <View accessibilityLabel={t(`公式：${tex()}`, `Formula: ${tex()}`)} class="rounded-(--radius-sm) border" classList={{ "border-primary": p.selected, "border-transparent": !p.selected }}>
        <Scaled scale={INLINE_MATH_SCALE}>
          <TextView markdown={tex() === "" ? "`$$`" : `$${tex()}$`} classes={MATH_CLASSES} />
        </Scaled>
      </View>
    </If>
  );
}

/** 外框左右内边距（px-4）和边框加起来：图最宽到正文列减去它。 */
const FRAME_INSET = 34;

/** Mermaid 图：画好的显示图（居中，宽过框时等比缩小）；渲染中、出错、画不了时显示状态和源码，不留空白。 */
function DiagramView(p: RichNodeViewProps) {
  const code = () => attr(p, "code");
  const shown = diagramShown(code);
  const body = (): JSX.Element => {
    const s = shown();
    switch (s.kind) {
      case "ready": {
        const width = Math.min(s.width, Math.max(16, columnWidth() - FRAME_INSET));
        return (
          <View class="items-center">
            <Image
              testID="diagram-image"
              src={s.url}
              role="image"
              accessibilityLabel={t(`Mermaid 图：${code().trim().split("\n")[0]}`, `Mermaid diagram: ${code().trim().split("\n")[0]}`)}
              style={{ width, height: Math.round((width * s.height) / s.width) }}
            />
          </View>
        );
      }
      case "empty":
        return <Text class="text-[14px] text-faint">{t("空 Mermaid 图，选中后点「编辑」写代码", "Empty Mermaid diagram. Select it and choose Edit to enter Mermaid code.")}</Text>;
      case "loading":
        return (
          <>
            <Label text={t("Mermaid 图 · 正在渲染…", "Mermaid diagram · Rendering…")} />
            <Source text={code()} faint />
          </>
        );
      default:
        return (
          <>
            <Label text={t("Mermaid 图 · 没能渲染", "Mermaid diagram · Rendering failed")} />
            <Text testID="diagram-error" class="text-[12px] leading-[18px] text-destructive">
              {phrase(s.message)}
            </Text>
            <Source text={code()} />
          </>
        );
    }
  };
  return (
    <Frame selected={p.selected} dashed={shown().kind !== "ready"}>
      {body()}
    </Frame>
  );
}

function FrontMatterView(p: RichNodeViewProps) {
  const open = signal(false);
  const toggle = nodePress(() => open.set(!open()));
  return (
    <Frame selected={p.selected}>
      <View class="flex-row items-center gap-2">
        <View class="flex-1">
          <Source text={frontMatterSummary(attr(p, "yaml"))} oneLine />
        </View>
        <View {...toggle.mouse}>
          <Button testID="frontmatter-toggle" label={open() ? t("收起", "Collapse") : t("展开", "Expand")} accessibilityLabel={open() ? t("收起 front matter", "Collapse front matter") : t("展开 front matter", "Expand front matter")} onPress={toggle.onPress} />
        </View>
      </View>
      <If when={open()}>
        <Source text={attr(p, "yaml")} />
      </If>
    </Frame>
  );
}

/** 只有 HTML 注释的块：预览里什么也看不到，照旧显示淡色源码。 */
const ONLY_COMMENT = /^\s*<!--[\s\S]*-->\s*$/;
const HTML_START = /^ {0,3}</;
const HTML_CLASSES = { root: "gap-2 text-[17px] leading-[30px] text-foreground", link: "text-primary-text underline" };

/** 预览里显示不出东西的元素（脚本、样式、嵌入、图片这类），连同里面的内容。 */
const INVISIBLE_ELEMENTS = /<(script|style|iframe|svg|template|noscript|object|embed|video|audio|canvas|math|textarea|select)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;

/** HTML 预览里有没有能看到的字：去掉看不见的元素、注释、标签和空白实体后还剩字才算。 */
export function htmlHasVisibleText(src: string): boolean {
  const text = src
    .replace(INVISIBLE_ELEMENTS, "")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<[^>]*>?/g, "")
    .replace(/&(?:nbsp|#0*160|#x0*a0|ensp|emsp|thinsp|zwnj|zwj);/gi, "");
  return text.trim() !== "";
}

/**
 * HTML 块：TextView html 预览（类型注释：按阅读器的样子显示简单标记，不跑 CSS 和脚本；链接只报告不打开）；选中时显示源码。
 * 预览里看不到字的（只有脚本、样式、iframe、svg、图片……）也显示源码，不留一个空框。
 */
function HtmlBlockView(props: { p: RichNodeViewProps }) {
  const p = props.p;
  const preview = () => !p.selected && htmlHasVisibleText(attr(p, "src"));
  return (
    <Frame selected={p.selected}>
      <Label text={preview() ? t("HTML 预览", "HTML Preview") : t("HTML 源码", "HTML Source")} />
      <If when={preview()} else={<Source text={attr(p, "src")} />}>
        <TextView testID="html-preview" html={attr(p, "src")} classes={HTML_CLASSES} />
      </If>
    </Frame>
  );
}

/** 脚注定义：内容（`muted-foreground` 的源码），和跳回正文里第一个引用的按钮。 */
function FootnoteDefView(props: { p: RichNodeViewProps; label: string }) {
  const p = props.p;
  const back = nodePress(() => {
    const pos = buildIndex(p.editor.getJSON() as Node).firstRefs.get(props.label);
    if (pos !== undefined) revealText(p.editor, pos + 1);
  });
  return (
    <Frame selected={p.selected}>
      <View class="flex-row items-center gap-2">
        <View class="flex-1">
          <Source text={attr(p, "src")} />
        </View>
        <If when={docIndex().firstRefs.has(props.label)}>
          <View {...back.mouse}>
            <Button testID={`footnote-back-${props.label}`} label="↩" accessibilityLabel={t(`回到脚注 ${props.label} 的引用处`, `Go back to the reference for footnote ${props.label}`)} onPress={back.onPress} />
          </View>
        </If>
      </View>
    </Frame>
  );
}

/** 透传块：脚注定义、HTML 块各有样子，其余（引用式链接的定义行等）是淡色源码。 */
function RawBlockView(p: RichNodeViewProps) {
  const src = () => attr(p, "src");
  const label = () => footnoteLabel(src());
  const html = () => HTML_START.test(src()) && !ONLY_COMMENT.test(src());
  const plain = (
    <Frame selected={p.selected}>
      <Source text={src()} faint />
    </Frame>
  );
  return (
    <If when={label()} else={<If when={html()} else={plain}><HtmlBlockView p={p} /></If>}>
      {(l) => <FootnoteDefView p={p} label={l()} />}
    </If>
  );
}

/** 目录：按当前的顶层标题列出，点一条跳过去；保存时仍写回 `[toc]`。 */
function TocView(p: RichNodeViewProps) {
  const headings = () => docIndex().headings;
  /** 目录是停手后才刷新的，点的那条可能已经挪了位置：在文字一样的标题里取位置对得上的，没有就取离原位置最近的。 */
  const jump = (entry: HeadingEntry) => {
    const same = headingStarts(p.editor.getJSON() as Node).filter((h) => h.text === entry.text);
    const target = same.reduce<HeadingEntry | null>((best, h) => (!best || Math.abs(h.pos - entry.pos) < Math.abs(best.pos - entry.pos) ? h : best), null);
    if (target) revealText(p.editor, target.pos + 1);
  };
  return (
    <Frame selected={p.selected}>
      <Label text={t("目录", "Table of Contents")} />
      <If when={headings().length > 0} else={<Text class="text-[14px] text-faint">{t("还没有标题", "No headings yet")}</Text>}>
        <Each of={headings()} key={(h) => `${h.pos}:${h.text}`}>
          {(h) => {
            const press = nodePress(() => jump(h()));
            return (
              <View
                testID="toc-item"
                role="button"
                accessibilityLabel={t(`跳到「${h().text}」`, `Go to “${h().text}”`)}
                onPress={press.onPress}
                {...press.mouse}
                style={{ paddingLeft: (h().level - 1) * 16 }}
                class="min-h-7 justify-center rounded-(--radius-sm) px-1 hover:bg-hover"
              >
                <Text style={{ numberOfLines: 1 }} class="text-[15px] text-primary-text">
                  {h().text || t("（空标题）", "(Empty heading)")}
                </Text>
              </View>
            );
          }}
        </Each>
      </If>
    </Frame>
  );
}

/** 脚注引用：上标样的 `[标签]`；悬停显示脚注内容，点一下跳到定义。 */
function FootnoteRefView(p: RichNodeViewProps) {
  const label = () => attr(p, "label");
  const text = () => docIndex().footnotes.get(label())?.text ?? t("没有找到这个脚注的定义", "No definition found for this footnote");
  const jump = nodePress(() => {
    const def = buildIndex(p.editor.getJSON() as Node).footnotes.get(label());
    if (def) revealNode(p.editor, def.pos);
  });
  return (
    <View
      testID={`footnote-ref-${label()}`}
      role="button"
      accessibilityLabel={t(`脚注 ${label()}：${text()}`, `Footnote ${label()}: ${text()}`)}
      tooltip={tip(text())}
      onPress={jump.onPress}
      {...jump.mouse}
      class="rounded-(--radius-sm) border px-0.5"
      classList={{ "border-primary": p.selected, "border-transparent": !p.selected }}
    >
      <Text class="font-mono text-xs text-primary">{`[${label()}]`}</Text>
    </View>
  );
}

/** 每种原子节点的节点视图，交给 `editorExtensions`。 */
export const NODE_VIEWS: Partial<Record<AtomNodeName, AtomNodeView>> = {
  frontmatter: FrontMatterView,
  mathBlock: MathBlockView,
  diagram: DiagramView,
  rawBlock: RawBlockView,
  toc: TocView,
  mathInline: MathInlineView,
  htmlInline: (p) => <SourceInline selected={p.selected} source={attr(p, "html")} />,
  footnoteRef: FootnoteRefView,
};
