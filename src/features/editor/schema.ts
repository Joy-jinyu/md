import type { JSX } from "nsh";
import { Code, defineExtension, RichImage, StarterKit, TableKit, type RichExtension, type RichExtensionClass, type RichNodeViewProps } from "nsh/base";

/** 转换层加的原子节点（编辑器里不能直接打字，由节点视图显示） */
export type AtomNodeName = "frontmatter" | "mathBlock" | "mathInline" | "diagram" | "rawBlock" | "htmlInline" | "footnoteRef" | "toc";

/** 原子节点的视图，签名同 addNodeView 返回的渲染函数 */
export type AtomNodeView = (props: RichNodeViewProps) => JSX.Element;

const ATOMS: Record<AtomNodeName, { inline: boolean; attrs: Record<string, { default: unknown }> }> = {
  frontmatter: { inline: false, attrs: { yaml: { default: "" } } },
  mathBlock: { inline: false, attrs: { tex: { default: "" } } },
  diagram: { inline: false, attrs: { code: { default: "" } } },
  rawBlock: { inline: false, attrs: { src: { default: "" } } },
  toc: { inline: false, attrs: {} },
  mathInline: { inline: true, attrs: { tex: { default: "" } } },
  htmlInline: { inline: true, attrs: { html: { default: "" } } },
  footnoteRef: { inline: true, attrs: { label: { default: "" } } },
};

function atomExtension(name: AtomNodeName, view: AtomNodeView | undefined): RichExtension {
  const spec = ATOMS[name];
  const node = { group: spec.inline ? "inline" : "block", inline: spec.inline, atom: true, selectable: true, attrs: spec.attrs };
  return defineExtension(view ? { name, node, addNodeView: () => view } : { name, node });
}

/** Markdown 往返要用、StarterKit / TableKit 没有的属性 */
function markdownAttributes(): RichExtension {
  return defineExtension({
    name: "markdownAttributes",
    addGlobalAttributes: () => [
      { types: ["codeBlock"], attributes: { meta: { default: null } } },
      { types: ["blockquote"], attributes: { alert: { default: null } } },
      { types: ["bulletList", "orderedList", "taskList"], attributes: { loose: { default: false } } },
      { types: ["listItem"], attributes: { checked: { default: null } } },
      { types: ["tableCell", "tableHeader"], attributes: { align: { default: null } } },
      // 图片的对齐（left / center / right），写出成 <img align>；宽度用图片节点自带的 width
      { types: ["image"], attributes: { align: { default: null } } },
    ],
  });
}

/**
 * 图片节点：换掉 StarterKit 自带的那个，好挂自己的视图（相对路径向存储要字节、外链不自动加载）。
 * inline：Markdown 的图片在段落里；allowBase64：粘贴网页 HTML 里的 data: 图片先留下，再转存进文档库。
 */
function imageExtension(view: AtomNodeView | undefined): RichExtension {
  const image = RichImage.configure({ inline: true, allowBase64: true });
  return view ? image.extend({ addNodeView: () => view }) : image;
}

/** 编辑器的全部扩展：StarterKit + TableKit + Markdown 属性 + 原子节点；nodeViews 由 UI 层给各原子节点和图片的视图 */
export function editorExtensions(nodeViews: Partial<Record<AtomNodeName | "image", AtomNodeView>> = {}): (RichExtension | RichExtensionClass)[] {
  const atoms = (Object.keys(ATOMS) as AtomNodeName[]).map((name) => atomExtension(name, nodeViews[name]));
  return [
    // typography 会把打的字换掉（2*3 → 2×3、-- → —、... → …、直引号 → 弯引号），Markdown 原文不能被这样改
    // textStyle（字色、字号、字体）Markdown 存不下：关掉后从网页、Word 粘贴进来的这些样式直接丢掉
    StarterKit.configure({ code: false, typography: false, textStyle: false, image: false }),
    imageExtension(nodeViews.image),
    // 内置的 code mark 排斥其他所有 mark（实测 nsh 0.6.0），[`x`](url) 会丢链接；放开排斥，Markdown 里行内代码可以带链接、加粗
    // inclusive: false：光标在行内代码右边紧挨着时打的字不算代码。不关的话代码在段尾时光标出不去，后面再也打不了普通字（2026-11-24 web host 实测）
    Code.extend({ mark: { excludes: "", inclusive: false, code: true, exitable: true, parseDOM: [{ tag: "code" }], toDOM: ["code", 0] } }),
    // 列宽拖拽关掉：开着时 web host 表格一多就卡死甚至崩（nsh 0.6.0 实测：60 张表 wasm 崩溃，关掉后 300 张 1.7 秒）；Markdown 也存不下列宽
    TableKit.configure({ table: { resizable: false } }),
    markdownAttributes(),
    ...atoms,
  ];
}
