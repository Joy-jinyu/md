/**
 * 插图时图片放哪（DESIGN.md「M3：图片」的「图床」）：设置了图床，先问要不要传（「上传到图床」确认框；用户选过「以后不再问」就直接传），传不上的那张存本地；
 * 连着网关但没设置时，问一次（「设置图床」对话框），用户选过「不用图床」就不再问。没有图床接口（浏览器本地、macOS、旧网关）一律存本地。
 */
import { signal } from "nsh";
import { messageOf } from "../../doc/message";
import { documentStore, imageHost } from "../../store/backend";
import { type ImageHostApi, ImageHostUnsupported, type ImageHostView } from "../../store/document-store";
import { loadAutoUpload, loadSkipImageHost, saveAutoUpload, saveSkipImageHost } from "../../store/settings";

/** 对话框里选了什么：存好了图床、这次存本地、不用图床（以后别问）。 */
export type HostChoice = "saved" | "local" | "never";

/** 「设置图床」对话框开着时是交回选择的函数；关着是 null。 */
export const hostAsk = signal<((choice: HostChoice) => void) | null>(null);

let asking: Promise<HostChoice> | null = null;

/** 弹「设置图床」等用户选。已经在问时，这一批跟着那一次的答案，不叠第二个框。 */
function askImageHost(): Promise<HostChoice> {
  if (!asking) {
    asking = new Promise<HostChoice>((resolve) =>
      hostAsk.set((choice) => {
        hostAsk.set(null);
        asking = null;
        resolve(choice);
      }),
    );
  }
  return asking;
}

/** 没设置图床时这批怎么办：问用户（`ask`），或者直接存本地。选了「不用图床」记进设置。 */
async function decide(api: ImageHostApi, ask: boolean): Promise<ImageHostApi | null> {
  if (!ask || (await loadSkipImageHost())) return null;
  const choice = await askImageHost();
  if (choice === "never") {
    const why = await saveSkipImageHost(true);
    if (why) console.warn("skip image host not saved", why);
  }
  return choice === "saved" ? api : null;
}

/** 确认框里选了什么：上传、上传并且以后不再问、这次存本地。 */
export type UploadChoice = "upload" | "always" | "local";

/** 图床叫什么（确认框、回执里用）：GitHub 仓库名，或上传接口的域名。 */
export function hostName(host: ImageHostView): string {
  if (host.kind === "github") return `GitHub 仓库 ${host.repo}`;
  return URL.canParse(host.url) ? new URL(host.url).host : host.url;
}

/** 「上传到图床」确认框开着时是这一批的张数、图床名和交回选择的函数；关着是 null。 */
export const uploadAsk = signal<{ count: number; where: string; reply: (choice: UploadChoice) => void } | null>(null);

let confirming: Promise<UploadChoice> | null = null;

/** 弹确认框等用户选。已经在问时（用户又贴了一次），后一批跟着这一次的答案，不叠第二个框。 */
function confirmUpload(count: number, where: string): Promise<UploadChoice> {
  if (!confirming) {
    confirming = new Promise<UploadChoice>((resolve) =>
      uploadAsk.set({
        count,
        where,
        reply: (choice) => {
          uploadAsk.set(null);
          confirming = null;
          resolve(choice);
        },
      }),
    );
  }
  return confirming;
}

/** 已经设置了图床：这批传不传。用户选过「以后不再问」直接传；不能问的（`ask` 为 false）没选过就存本地。 */
async function confirmed(api: ImageHostApi, host: ImageHostView, ask: boolean, count: number): Promise<ImageHostApi | null> {
  if (await loadAutoUpload()) return api;
  if (!ask) return null;
  const choice = await confirmUpload(count, hostName(host));
  if (choice === "always") {
    const why = await saveAutoUpload(true);
    if (why) console.warn("auto upload not saved", why);
  }
  return choice === "local" ? null : api;
}

/**
 * 这批图片（`count` 张）往哪传：图床接口，或者 null（存本地）。`ask`：能不能弹框问（粘贴网页带来的 data: 图片不问：没设置图床、或没选过「以后不再问」就存本地）。
 * 读不到配置（旧网关、断开）不报错，存本地：断开时存本地也会失败，原因由存本地那一步报。
 */
export async function uploadTarget(ask: boolean, count: number): Promise<ImageHostApi | null> {
  const api = imageHost();
  if (!api) return null;
  try {
    const host = await api.get();
    // 刚在「设置图床」里点了「保存并上传」的，不再问第二遍
    return host ? await confirmed(api, host, ask, count) : await decide(api, ask);
  } catch (e) {
    console.warn(e instanceof ImageHostUnsupported ? "gateway has no image host, storing locally" : "image host unreadable, storing locally", e);
    return null;
  }
}

/** 一张图放好后的正文地址；`notUploaded`：传图床失败、改存本地时的原因。存本地也失败就抛错。 */
export async function placeImage(target: ImageHostApi | null, docId: string, bytes: Uint8Array): Promise<{ src: string; notUploaded?: string }> {
  if (!target) return { src: await documentStore.putAsset(docId, bytes) };
  try {
    return { src: await target.upload(bytes) };
  } catch (e) {
    console.warn("image not uploaded, storing locally", e);
    return { src: await documentStore.putAsset(docId, bytes), notUploaded: messageOf(e) };
  }
}

/** 回执里「没传上图床」那一句；都传上了是空串。 */
export const notUploadedText = (reasons: string[]) => (reasons.length > 0 ? `${reasons.length} 张没传上图床，先存在本地：${[...new Set(reasons)].join("；")}` : "");
