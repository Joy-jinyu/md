/** 「打开文件」「另存为」「导出为 HTML」：接请求、选文件、另存。打开的文件存成文档库里的一篇新文档（交给编辑页那一层去建、去切换）。 */
import { effect, Picker, untracked } from "nsh";
import { messageOf } from "../../doc/message";
import { saveTextFile } from "../../platform";
import { storageKind } from "../../store/backend";
import { latestDocument } from "../../store/document";
import { currentDocId, openDocName } from "../../store/library";
import { say } from "../library/receipt";
import { requestLibrary } from "../library/requests";
import { loadMarkdown } from "../editor/convert";
import { localImageCount } from "../editor/images";
import { markdownToHtmlWithImages, tooLongToConvert } from "./export-html";
import { fileNameFor } from "./file-name";
import { fileRequest } from "./requests";

/** 能打开的文件最大多少字节。存储和编辑器都按一整篇字符串处理，再大读进来也用不了。 */
const MAX_OPEN_BYTES = 32 * 1024 * 1024;
const MARKDOWN_FILES = [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] }];

/** 读出来的文字里有这些，说明文件不是 UTF-8 文本（解码不了的字节会变成 U+FFFD；正常文本里不会有 NUL）。 */
const NOT_TEXT = /[\uFFFD\u0000]/;

/** 文件名去掉 Markdown 的扩展名，当文档名。 */
const stem = (name: string) => name.replace(/\.(md|markdown|mdown|txt)$/i, "") || name;

/**
 * 弹系统的文件选择框，读出选中的那个文件。用户取消时是 null；读不了、太大、不是文本时抛带说明的错。
 * 选择框的类型过滤只是建议（系统可能让用户选别的），所以读出来还要自己查是不是文本。
 */
async function pickMarkdown(): Promise<{ name: string; text: string } | null> {
  const first = (await Picker.pickFiles({ filters: MARKDOWN_FILES, maxSize: MAX_OPEN_BYTES }))[0];
  if (!first) return null;
  if (first.status === "tooLarge" || !first.file) throw new Error(`「${first.name}」太大了（超过 32 MB）`);
  const text = await first.file.text();
  if (NOT_TEXT.test(text)) throw new Error(`「${first.name}」不是 UTF-8 编码的文本（可能是别的编码，或者不是文本文件）。先用别的工具转成 UTF-8 再打开`);
  return { name: first.name, text };
}

async function openFile() {
  try {
    const file = await pickMarkdown();
    if (file) requestLibrary({ kind: "import", name: stem(file.name), text: file.text });
  } catch (e) {
    console.error("open file failed", e);
    say(`没有打开：${messageOf(e)}。文档库没有变。`, "warn");
  }
}

/**
 * 另存的只有 .md 本身，正文里相对路径的图片（文档库里的）没有跟过去：说一声，免得以为图片跟着走了。
 * 浏览器本地的图片在 IndexedDB 里，文库文件夹和网关的在文库的 assets/ 里。
 */
function imagesLeftBehind(text: string): string {
  const where = storageKind().kind === "local" ? "存在浏览器里" : "在文库的 assets/ 里";
  if (tooLongToConvert(text)) return `。如果这篇有文档库里的图片，没有一起存过去，图片${where}`;
  const n = localImageCount(loadMarkdown(text).json);
  return n > 0 ? `。这篇有 ${n} 张图片没有一起存过去，图片${where}` : "";
}

async function saveAs() {
  try {
    const text = latestDocument();
    say(`${(await saveTextFile(fileNameFor(text, "md", openDocName()), text)).message}${imagesLeftBehind(text)}`, "info");
  } catch (e) {
    console.error("save as failed", e);
    say(`没能另存：${messageOf(e)}`, "warn");
  }
}

/** 导出的 HTML 和另存为存在同一个地方（浏览器下载 / 「下载」文件夹），文件名同样取标题。 */
async function exportHtml() {
  try {
    const text = latestDocument();
    if (tooLongToConvert(text)) return say("这篇太长，导出不了 HTML；可以另存为 .md。", "warn");
    const out = await markdownToHtmlWithImages(text, currentDocId());
    const saved = await saveTextFile(fileNameFor(text, "html", openDocName()), out.html, "text/html;charset=utf-8");
    say(`${saved.message}。${out.note}用浏览器打开它，可以再打印或存成 PDF。`, out.note ? "warn" : "info");
  } catch (e) {
    console.error("export html failed", e);
    say(`没能导出：${messageOf(e)}`, "warn");
  }
}

const HANDLERS = { open: openFile, saveAs, exportHtml };

/** 放在编辑页最外层：只接请求，没有自己的界面（回执由编辑页统一显示）。 */
export function FileActions() {
  effect(() => {
    const request = fileRequest();
    if (!request) return;
    untracked(() => {
      fileRequest.set(null);
      void HANDLERS[request.kind]();
    });
  });
  return null;
}
