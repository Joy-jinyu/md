/** 设置页的分类：宽屏是左栏，窄屏是第一层的列表。 */
import { t } from "../../i18n";
import { IN_BROWSER } from "../../platform";
import type { IconName } from "../../ui/icon";

export type SectionId = "shortcuts" | "language" | "storage" | "gateway" | "image-host" | "sync";

export interface Section {
  id: SectionId;
  icon: IconName;
  title: string;
  description: string;
}

function section(id: SectionId, icon: IconName, zh: string, en: string, descriptionZh: string, descriptionEn: string): Section {
  return {
    id,
    icon,
    get title() { return t(zh, en); },
    get description() { return t(descriptionZh, descriptionEn); },
  };
}

const ALL: Section[] = [
  section("shortcuts", "keyboard", "快捷键", "Keyboard shortcuts", "改命令的快捷键。回到编辑页时生效：编辑页会重新载入，撤销记录清空。", "Change command shortcuts. Returning to the editor reloads the document and clears undo history."),
  section("language", "settings", "语言", "Language", "选择编辑器界面的显示语言。", "Choose the display language for the editor."),
  section("storage", "hardDrive", "存储", "Storage", "文档和图片存在哪。", "See where documents and images are stored."),
  section("gateway", "plug", "本机网关", "Local gateway", "让网页版把文档存成你电脑上的 .md 文件。", "Save documents from the web editor as local .md files."),
  section("image-host", "image", "图床", "Image hosting", "粘贴、插入的图片传到你的图床，正文写图床给的外链地址。", "Upload inserted images to your image host and write their URLs into the document."),
  section("sync", "refresh", "同步", "Sync", "登录 GitHub，把文档同步到你的私有 Gist。", "Sign in to GitHub to sync your documents to private Gists."),
];

export const SECTIONS: Section[] = ALL.filter((s) => IN_BROWSER || s.id !== "gateway");

export const sectionOf = (id: SectionId): Section => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
