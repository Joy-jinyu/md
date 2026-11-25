/** 设置页的分类：宽屏是左栏，窄屏是第一层的列表。顺序、说明见 DESIGN.md「屏幕：设置」。 */
import { IN_BROWSER } from "../../platform";
import type { IconName } from "../../ui/icon";

export type SectionId = "shortcuts" | "storage" | "gateway" | "image-host" | "sync";

export interface Section {
  id: SectionId;
  icon: IconName;
  title: string;
  description: string;
}

const ALL: Section[] = [
  { id: "shortcuts", icon: "keyboard", title: "快捷键", description: "改命令的快捷键。回到编辑页时生效：编辑页会重新载入，撤销记录清空。" },
  { id: "storage", icon: "hardDrive", title: "存储", description: "文档和图片存在哪。" },
  { id: "gateway", icon: "plug", title: "本机网关", description: "让网页版把文档存成你电脑上的 .md 文件。" },
  { id: "image-host", icon: "image", title: "图床", description: "粘贴、插入的图片传到你的图床，正文写图床给的外链地址。" },
  { id: "sync", icon: "refresh", title: "同步", description: "登录 GitHub，把文档同步到你的私有 Gist。" },
];

/** 本机网关只有网页版能连，macOS 里不列这一类。 */
export const SECTIONS: Section[] = ALL.filter((s) => IN_BROWSER || s.id !== "gateway");

export const sectionOf = (id: SectionId): Section => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
