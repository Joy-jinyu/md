/** 编辑器 JSON 里的 mark（ProseMirror 形状） */
export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

/** 编辑器 JSON 里的节点（ProseMirror 形状，和 nsh 的 RichNodeJSON 结构相同） */
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

/** 整篇文档的编辑器 JSON（type 为 "doc"） */
export type DocJSON = PMNode;

/**
 * TextView.parse 结果里用到的行内形状。
 * doc/ 不能引 nsh，这里按 .nsh/types/nsh/base.d.ts 的 TextViewInline 抄一份结构。
 */
export type MdInline =
  | { type: "text"; text: string }
  | {
      type: "strong" | "emphasis" | "strikethrough" | "underline" | "superscript" | "subscript" | "small" | "highlight";
      content: MdInline[];
    }
  | { type: "code"; code: string }
  | { type: "keyboard"; text: string }
  | { type: "link"; url: string; title?: string; content: MdInline[] }
  | { type: "image"; src: string; alt?: string; title?: string }
  | { type: "math"; tex: string }
  | { type: "break" }
  | { type: "footnoteReference"; label: string; index?: number }
  | { type: "custom"; name: string; text?: string; attributes?: Record<string, string> };

/** TextView.parse 结果里列表的一项 */
export interface MdListItem {
  checked?: boolean;
  children: MdBlock[];
}

/** 表格单元格 */
export interface MdCell {
  content: MdInline[];
}

/** TextView.parse 结果里的顶层块（同上，按 TextViewBlock 抄） */
export type MdBlock =
  | { type: "paragraph"; content: MdInline[] }
  | { type: "heading"; level: number; content: MdInline[]; anchor?: string }
  | { type: "blockquote"; children: MdBlock[]; alert?: string }
  | { type: "list"; ordered?: boolean; start?: number; loose?: boolean; items: MdListItem[] }
  | { type: "codeBlock"; language?: string; meta?: string; code: string }
  | { type: "math"; tex: string }
  | { type: "table"; align?: string[]; head: MdCell[]; rows?: MdCell[][] }
  | { type: "rule" }
  | { type: "details"; summary: MdInline[]; children: MdBlock[] }
  | { type: "custom"; name: string; text?: string; children?: MdBlock[]; content?: MdInline[] };

/** 一段原文切片：没改过时逐字节写回的单位 */
export interface SourceSlice {
  /** 切片原文，不含末尾换行 */
  text: string;
  /** 切片后面的换行和空行；最后一片的是文件结尾 */
  sep: string;
  /** parsed：blocks 是它解析出的顶层块（一块对应一个编辑器节点）；raw：整片原样放进一个 rawBlock */
  kind: "parsed" | "raw";
  blocks: MdBlock[];
  /** 原文里出现过的 [标签]（规范化后），定义行变了时据此强制重写 */
  labels: string[];
}

/** parseMarkdown 的结果：按顺序的切片，加上文件级的 BOM、换行风格、开头空行 */
export interface ParsedSource {
  bom: boolean;
  /** 全文都是 CRLF：切片里已换成 LF，写出时换回 */
  crlf: boolean;
  /** 第一块前面的空行 */
  lead: string;
  slices: SourceSlice[];
  /** 有一段没能逐块对上，从那里到文末合成了一个切片 */
  degraded: boolean;
}
