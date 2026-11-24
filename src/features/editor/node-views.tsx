/** 原子节点的节点视图：M1 只显示源码（公式、Mermaid 不渲染，也不能点开编辑）。 */
import { Text, View } from "nsh";
import type { RichNodeViewProps } from "nsh/base";
import type { AtomNodeName, AtomNodeView } from "./schema";

const attr = (props: RichNodeViewProps, name: string): string => {
  const value = props.node.attrs[name];
  return typeof value === "string" ? value : "";
};

/** front matter 的一行摘要：「Front matter · N 行 · 第一行」。 */
export function frontMatterSummary(yaml: string): string {
  const lines = yaml.split("\n").filter((line) => line.trim() !== "");
  return lines.length === 0 ? "Front matter · 空" : `Front matter · ${lines.length} 行 · ${lines[0].trim()}`;
}

/** 块级源码：等宽、浅底；被选中时边框换成主色。 */
function SourceBlock(props: { selected: boolean; source: string; label?: string; faint?: boolean; oneLine?: boolean }) {
  return (
    <View
      class="gap-1 rounded-(--radius-sm) border bg-muted px-4 py-3"
      classList={{ "border-primary": props.selected, "border-transparent": !props.selected }}
    >
      <If when={props.label}>{(label) => <Text class="text-[11px] text-muted-foreground">{label()}</Text>}</If>
      <Text
        style={props.oneLine ? { numberOfLines: 1 } : undefined}
        class="font-mono text-[14px] leading-[22px]"
        classList={{ "text-faint": !!props.faint, "text-muted-foreground": !props.faint }}
      >
        {props.source}
      </Text>
    </View>
  );
}

/** 行内源码：等宽、浅底的小块。 */
function SourceInline(props: { selected: boolean; source: string; tone?: "primary" }) {
  return (
    <View
      class="rounded-(--radius-sm) border px-1"
      classList={{ "border-primary": props.selected, "border-transparent": !props.selected, "bg-muted": props.tone !== "primary" }}
    >
      <Text
        class="font-mono"
        classList={{ "text-[15px] text-muted-foreground": props.tone !== "primary", "text-xs text-primary": props.tone === "primary" }}
      >
        {props.source}
      </Text>
    </View>
  );
}

/** 每种原子节点的节点视图，交给 `editorExtensions`。 */
export const NODE_VIEWS: Partial<Record<AtomNodeName, AtomNodeView>> = {
  frontmatter: (p) => <SourceBlock selected={p.selected} source={frontMatterSummary(attr(p, "yaml"))} oneLine />,
  mathBlock: (p) => <SourceBlock selected={p.selected} label="公式" source={attr(p, "tex")} />,
  diagram: (p) => <SourceBlock selected={p.selected} label="mermaid" source={attr(p, "code")} />,
  rawBlock: (p) => <SourceBlock selected={p.selected} source={attr(p, "src")} faint />,
  toc: (p) => <SourceBlock selected={p.selected} source="目录（以后在这里列出标题）" />,
  mathInline: (p) => <SourceInline selected={p.selected} source={`$${attr(p, "tex")}$`} />,
  htmlInline: (p) => <SourceInline selected={p.selected} source={attr(p, "html")} />,
  footnoteRef: (p) => <SourceInline selected={p.selected} source={`[^${attr(p, "label")}]`} tone="primary" />,
};
