/**
 * 正文里的图片：粘贴 / 拖入 / 选择框插图（存进文档库、正文写相对路径）、粘贴网页带来的 data: 图片转存、外链图片转存到本地。
 * 存哪、怎么存都交给 store 的 documentStore（putAsset / transfer）；这里只管拿字节、改正文里的地址、报结果。
 */
import { Picker, signal } from "nsh";
import { chain, command, type RichEditorSession, type RichNodeJSON, setMeta, setNodeAttribute } from "nsh/base";
import { messageOf } from "../../doc/message";
import { readImageFile } from "../../platform";
import { documentStore } from "../../store/backend";
import { AssetRejected, base64ToBytes, IMAGE_TYPES, isRelativeSrc } from "../../store/image-file";
import { currentDocId } from "../../store/library";
import { say } from "../library/receipt";
import { eachNode, type Node } from "./outline";
import { selectionRange } from "./selection";

/** 选择框、网页拖放一次最多读多大的图：各后端里最宽的上限（网关、浏览器本地 10 MiB）；更细的上限由存储再查一遍。 */
const PICK_MAX_BYTES = 10 * 1024 * 1024;
/** 报结果时地址最长显示多少字。 */
const URL_SHOWN = 60;

const EXTENSIONS = Object.keys(IMAGE_TYPES);
const IMAGE_PATH = new RegExp(`\\.(?:${EXTENSIONS.join("|")})$`, "i");
/** 粘贴网页带进来的 data: 图片：只认 base64 的。 */
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,/i;
const EXTERNAL = /^https?:\/\//i;

export const isExternalSrc = (src: string) => EXTERNAL.test(src.trim());

const shortUrl = (url: string) => (url.length > URL_SHOWN ? `${url.slice(0, URL_SHOWN)}…` : url);

/** 正文列的宽度（点）：图片按它算百分比宽度、限制最宽。编辑器的 onLayout 更新。 */
const column = signal(696);
export const columnWidth = () => column();
/** 正文列最宽 760、左右内边距各 32（editor-classes.ts 的 content）。 */
export function noteEditorWidth(width: number) {
  const next = Math.max(120, Math.min(760, width) - 64);
  if (next !== column()) column.set(next);
}

/** 文档里的每张图：位置和地址。 */
export function imagesIn(doc: Node): { pos: number; src: string }[] {
  const found: { pos: number; src: string }[] = [];
  eachNode(doc, (node, pos) => {
    if (node.type === "image") found.push({ pos, src: String(node.attrs?.src ?? "") });
  });
  return found;
}

/** Markdown 正文里存在文档库里（相对路径）的图片有几张。 */
export const localImageCount = (doc: Node) => imagesIn(doc).filter((i) => isRelativeSrc(i.src)).length;

/**
 * 把文档里地址是 `from` 的图都换成 `to`（一次撤销）。正文在转存期间可能又改过，所以按地址重新找位置。
 * `ownStep: false`：不单独占一步撤销，跟着前一步（粘贴）一起撤（ProseMirror 的 addToHistory）。
 */
function replaceSrc(session: RichEditorSession, from: string, to: string, ownStep = true): number {
  const hits = imagesIn(session.getJSON() as Node).filter((i) => i.src === from);
  const steps = hits.map((h) => setNodeAttribute(h.pos, "src", to));
  if (hits.length > 0) session.run(chain(ownStep ? steps : [setMeta("addToHistory", false), ...steps]));
  return hits.length;
}

/** 选中的那张图片（节点选区）的位置；没选中图片是 null。 */
export function selectedImage(session: RichEditorSession): number | null {
  const { from, type } = selectionRange(session);
  return type === "node" && session.nodeAt(from)?.type === "image" ? from : null;
}

/** 选中的图片能不能设宽度 / 对齐：链接里的不能（写不成读得回来的 Markdown，见 to-markdown.ts 的 imageMarkdown）。 */
export function canResize(session: RichEditorSession): boolean {
  const at = selectedImage(session);
  return at !== null && !(session.nodeAt(at)?.marks ?? []).some((m) => m.type === "link");
}

/** 改选中图片的一个属性（宽度、对齐、替代文字）；没选中图片什么也不做。 */
export function setImageAttr(session: RichEditorSession, name: "width" | "align" | "alt", value: string | null) {
  const at = selectedImage(session);
  if (at !== null) session.run(setNodeAttribute(at, name, value));
}

/** 删掉选中的图片。 */
export function deleteImage(session: RichEditorSession) {
  if (selectedImage(session) !== null) session.run(command("deleteSelection"));
}

/** 命令「编辑替代文字」要展开输入框：图片操作条看到后展开、复位（命令只在选中图片时能用，那时操作条在）。 */
export const altEditRequest = signal(false);

function docIdOrSay(): string | null {
  const id = currentDocId();
  if (!id) say("还没有打开的文档，没法存图片", "warn");
  return id;
}

/** 一批图片字节存进文档库，在光标处插成图片。存不进去的逐张报原因，存进去的照样插。`earlier`：之前就没读出来的几张的原因，和这里的一起报（回执只留最后一句）。 */
export async function insertImageBytes(session: RichEditorSession, files: { name: string; data: Uint8Array }[], earlier: string[] = []) {
  if (files.length === 0) {
    if (earlier.length > 0) say(`没能插入图片：${earlier.join("；")}`, "warn");
    return;
  }
  const docId = docIdOrSay();
  if (!docId) return;
  const nodes: RichNodeJSON[] = [];
  const failed = [...earlier];
  for (const f of files) {
    try {
      const src = await documentStore.putAsset(docId, f.data);
      nodes.push({ type: "image", attrs: { src, alt: "" } });
    } catch (e) {
      console.warn("image not stored", e);
      failed.push(`「${f.name}」${messageOf(e)}`);
    }
  }
  if (nodes.length > 0 && !session.insertContent(nodes)) failed.push("图片存好了，但插不进光标所在的位置");
  if (failed.length > 0) say(`没能插入图片：${failed.join("；")}`, "warn");
}

/** 「插入图片」：弹系统的选择框选图（可以多选），存进文档库后插到光标处。 */
export async function pickImages(session: RichEditorSession) {
  try {
    const picked = await Picker.pickFiles({ multiple: true, filters: [{ name: "图片", extensions: EXTENSIONS }], maxSize: PICK_MAX_BYTES });
    const tooBig = picked.filter((p) => p.status === "tooLarge" || !p.file).map((p) => p.name);
    if (tooBig.length > 0) say(`「${tooBig.join("」「")}」超过 10 MB，先压缩一下再插入`, "warn");
    const files = await Promise.all(picked.filter((p) => p.file).map(async (p) => ({ name: p.name, data: new Uint8Array(await p.file!.arrayBuffer()) })));
    await insertImageBytes(session, files);
  } catch (e) {
    console.error("pick images failed", e);
    say(`没能打开选择框：${messageOf(e)}`, "warn");
  }
}

/** 系统交来的本地图片（拖进窗口、访达里复制的文件，绝对路径）：读出字节再插。读不了的报原因。 */
export async function insertImageFiles(session: RichEditorSession, paths: string[]) {
  const files: { name: string; data: Uint8Array }[] = [];
  const failed: string[] = [];
  const tooBig: string[] = [];
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    try {
      files.push({ name, data: await readImageFile(path) });
    } catch (e) {
      console.warn("dropped image unreadable", e);
      if (e instanceof AssetRejected) tooBig.push(`「${name}」${e.message}`);
      else failed.push(name);
    }
  }
  if (tooBig.length > 0) say(`没能插入图片：${tooBig.join("；")}`, "warn");
  if (failed.length > 0) say(`读不了「${failed.join("」「")}」：应用只能读文库和「下载」文件夹里的文件。先把图片放进这两处之一，或者复制图片本身再粘贴`, "warn");
  await insertImageBytes(session, files);
}

export const isImagePath = (path: string) => IMAGE_PATH.test(path);

/** 粘贴后多久内去找贴进来的 data: 图片（毫秒）：编辑器什么时候把粘贴落进文档不确定（钩子返回以后的某一轮），找到为止。 */
const DATA_IMAGE_TRIES = [0, 50, 200, 600];

const dataSources = (session: RichEditorSession) => new Set(imagesIn(session.getJSON() as Node).map((i) => i.src).filter((s) => DATA_IMAGE.test(s)));

/**
 * 粘贴网页 / Word 带进来的 data: 图片：贴进来以后逐张存进文档库，地址换成相对路径，替换跟着粘贴那一步一起撤销。存不进去的（SVG、太大）留着原样并报原因。
 * 在粘贴落进文档之前调（handlePaste 里）：只处理这次贴进来的，文档里原来就有的 data: 图片不动（`before`）。
 * 原来就有一张一模一样的 data: 图片时，这次贴进来的那张也不动（按地址分不出是哪一张）。
 */
export function storeDataImages(session: RichEditorSession, tries = DATA_IMAGE_TRIES, before = dataSources(session)) {
  const [wait, ...rest] = tries;
  if (wait === undefined) return;
  setTimeout(() => {
    const sources = [...dataSources(session)].filter((s) => !before.has(s));
    if (sources.length === 0) storeDataImages(session, rest, before);
    else void storeSources(session, sources);
  }, wait);
}

async function storeSources(session: RichEditorSession, sources: string[]) {
  const docId = docIdOrSay();
  if (!docId) return;
  const failed: string[] = [];
  for (const src of sources) {
    try {
      const bytes = base64ToBytes(src.slice(src.indexOf(",") + 1));
      replaceSrc(session, src, await documentStore.putAsset(docId, bytes), false);
    } catch (e) {
      console.warn("pasted data image not stored", e);
      failed.push(messageOf(e));
    }
  }
  if (failed.length > 0) say(`粘贴进来的图片有 ${failed.length} 张没能存进文档库，正文里还是原来的内嵌数据：${[...new Set(failed)].join("；")}`, "warn");
}

/** 下好了、正文里却一处都没换成（转存期间那张图被删了、地址改了）。 */
const NOT_FOUND = "图片已下到本地，但正文里没找到原地址（转存期间改过），正文没有改";

/** 转存一张外链图片：成了把正文里这个地址都换成相对路径；失败不改正文，返回原因。正文里一处都没换成也算没成。 */
async function transferOne(session: RichEditorSession, docId: string, url: string): Promise<string | null> {
  try {
    return replaceSrc(session, url, await documentStore.transfer!(docId, url)) > 0 ? null : NOT_FOUND;
  } catch (e) {
    console.warn("image not transferred", e);
    return messageOf(e);
  }
}

/** 「转存到本地」：选中的那张外链图片。 */
export async function transferImage(session: RichEditorSession, url: string) {
  const docId = docIdOrSay();
  if (!docId) return;
  const why = await transferOne(session, docId, url);
  if (why === NOT_FOUND) say(`${shortUrl(url)}：${NOT_FOUND}`, "warn");
  else if (why) say(`没能转存 ${shortUrl(url)}：${why}。正文没有改`, "warn");
  else say("已转存到本地，正文里的地址换成了相对路径", "info");
}

/** 「把这篇的外链图片都转存到本地」：一张张转，逐张报结果。 */
export async function transferAllImages(session: RichEditorSession) {
  const docId = docIdOrSay();
  if (!docId) return;
  const urls = [...new Set(imagesIn(session.getJSON() as Node).map((i) => i.src.trim()))].filter(isExternalSrc);
  if (urls.length === 0) return say("这篇没有外链图片", "info");
  const failed: string[] = [];
  for (const url of urls) {
    const why = await transferOne(session, docId, url);
    if (why) failed.push(`${shortUrl(url)}：${why}`);
  }
  const done = urls.length - failed.length;
  if (failed.length === 0) say(`${done} 张外链图片都转存到本地了`, "info");
  else say(`转存了 ${done} 张，${failed.length} 张没转成（正文里还是原地址）：${failed.join("；")}`, "warn");
}

/** 开着的所见即所得编辑页（源码视图里是 null）：编辑页外层收到拖进窗口的图片时交给它。 */
let target: (() => RichEditorSession | null) | null = null;

/** 编辑页挂上时登记自己；返回撤销登记的函数（切文档时旧页撤掉）。 */
export function attachImageTarget(get: () => RichEditorSession | null): () => void {
  target = get;
  return () => {
    if (target === get) target = null;
  };
}

/** 拖进窗口的本地图片（macOS 应用，绝对路径）：插到开着的文档里光标处。 */
export function dropImages(paths: string[]) {
  const session = target?.();
  if (!session) return say("现在不能插入图片（源码视图里，或者还没有打开文档）。切回所见即所得再拖进来", "warn");
  void insertImageFiles(session, paths);
}

/** 网页里拖进来的一个文件：浏览器只给文件本身、不给路径（`onFileDrop` 的 `files`，nsh 0.7.0 起有）。 */
export interface DroppedFile {
  file: File | null;
  name: string;
  status: "read" | "tooLarge";
}

/** 网页里拖进窗口的文件：图片插到开着的文档里光标处，别的文件不管。 */
export function dropImageFiles(files: DroppedFile[]) {
  const images = files.filter((f) => isImagePath(f.name));
  if (images.length === 0) return;
  const session = target?.();
  if (!session) return say("现在不能插入图片（源码视图里，或者还没有打开文档）。切回所见即所得再拖进来", "warn");
  void readDropped(session, images);
}

/** 一张张读：太大的先按大小拒（不读进内存），读不出来的只少这一张，原因和存不进去的一起报。 */
async function readDropped(session: RichEditorSession, files: DroppedFile[]) {
  const read: { name: string; data: Uint8Array }[] = [];
  const failed: string[] = [];
  for (const f of files) {
    if (f.status !== "read" || !f.file) {
      failed.push(`「${f.name}」太大，浏览器没读进来`);
      continue;
    }
    if (f.file.size > PICK_MAX_BYTES) {
      failed.push(`「${f.name}」超过 10 MB，先压缩一下再插入`);
      continue;
    }
    try {
      read.push({ name: f.name, data: new Uint8Array(await f.file.arrayBuffer()) });
    } catch (e) {
      console.warn("dropped image unreadable", e);
      failed.push(`「${f.name}」读不出来（${messageOf(e)}）`);
    }
  }
  await insertImageBytes(session, read, failed);
}

/** 粘贴的内容里有 data: 图片（网页、Word 里复制的）：编辑器照常贴进来以后，由 `storeDataImages` 存进文档库。 */
export const carriesDataImages = (clipboard: { text: string; html: string }) => /data:image\//i.test(clipboard.html || clipboard.text);
