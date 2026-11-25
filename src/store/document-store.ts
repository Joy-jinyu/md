/**
 * 文档库的存储接口（实施计划 10.2）：功能代码只认它，不知道后面是浏览器本地、本机网关还是 macOS 的文件。
 * 三种实现：浏览器本地（local-store.ts）、本机网关（gateway-store.ts）、macOS 文库文件夹（platform/macos/file-store.ts）；用哪一种只在 backend.ts 定。
 */
import type { GithubHostSettings, ImageHostInput, ImageHostView } from "../../gateway/src/protocol";
import type { AssetData } from "./image-file";

/** 图床配置（上传接口、GitHub 仓库两种，定义在网关协议里）：features 经这里拿，不直接引 gateway/。 */
export type { GithubHostSettings, ImageHostInput, ImageHostView };

/** 版本：只拿来比相等。浏览器本地是每写一次加一的数，网关和文件是内容的 SHA-256。 */
export type Version = number | string;

/** 打不开编辑的文档：不是 UTF-8，或者太大。照样列出来，但不能打开。 */
export type DocProblem = "not-utf8" | "too-large";

/**
 * 列表里的一篇：名字（文件名，不含扩展名）、标题（正文第一个标题，没有是空串；文件类后端列表时不读正文，一律空串）、
 * 改动时间（毫秒，0 是不知道）、版本、大小。列表里的版本只有浏览器本地的可信，文件类后端给空串，读写时以 read / write 返回的为准。
 */
export interface DocMeta {
  id: string;
  name: string;
  title: string;
  updatedAt: number;
  version: Version;
  size: number;
  problem?: DocProblem;
}

export interface ReadResult {
  text: string;
  version: Version;
}

/** 写的结果：版本对不上时不覆盖，带回存储里现在的版本（这篇不在了是空串），交给界面让用户选。 */
export type WriteResult = { ok: true; meta: DocMeta } | { ok: false; version: Version };

/**
 * 外面改了文档：`ids` 是改了哪几篇（只是列表变了时为空）；`all` 是说不清改了哪些（目录改名、网关重连），全部重新比对。
 * `renamed`：认得出是别处改了名的（旧的消失、新的内容一样）。
 */
export type StoreChange = { ids: string[]; all: boolean; renamed?: { from: string; to: string }[] };

/** create / rename 的目标名字已经被占用：不覆盖，调用方按需换名或跳过。 */
export class NameTaken extends Error {
  /** 占着这个名字的那一篇的 id。 */
  constructor(
    message: string,
    readonly id: string,
  ) {
    super(message);
  }
}

/** 网关太旧，不认图床的请求：调用方当没有图床，图片照旧存本地。 */
export class ImageHostUnsupported extends Error {}

/** 图床：经本机网关转发的自定义上传接口。失败都抛给人看的错。 */
export interface ImageHostApi {
  /** 现在的配置，没设置是 null；网关太旧抛 `ImageHostUnsupported`。 */
  get(): Promise<ImageHostView | null>;
  /** 存配置；null 是清掉。 */
  set(host: ImageHostInput | null): Promise<void>;
  /** 传一张图，返回图床给的 http(s) 地址。 */
  upload(bytes: Uint8Array): Promise<string>;
}

export interface DocumentStore {
  list(): Promise<DocMeta[]>;
  /** 没有这一篇是 null。打不开（不是 UTF-8、太大、读不了）抛带说明的错。 */
  read(id: string): Promise<ReadResult | null>;
  /** 存储里的版本等于 `baseVersion` 才写。写不进去（存储满了、断开了等）抛错，原文不变。 */
  write(id: string, text: string, baseVersion: Version): Promise<WriteResult>;
  /** 名字已被占用时抛错，不覆盖。文件类后端会把名字过滤成合法文件名，以返回的 `name` 为准。 */
  create(name: string, text: string): Promise<DocMeta>;
  rename(id: string, name: string): Promise<DocMeta>;
  /** 浏览器本地连同它的图片一起删；文件类后端只删这个 .md（assets/ 里的图片可能别的文档也在用）。 */
  remove(id: string): Promise<void>;
  /**
   * 存一张图片，返回写进正文的相对路径（`assets/<内容哈希>.<扩展名>`，同一张图不存两份）。
   * 只收 png、jpg、gif、webp、avif（按文件头认），太大或类型不对抛 AssetRejected；存不了二进制的后端抛错。
   */
  putAsset(docId: string, bytes: Uint8Array): Promise<string>;
  /** 按正文里的相对地址取图片字节；没有、地址不合规（跳出文库等）是 null。 */
  getAsset(docId: string, src: string): Promise<AssetData | null>;
  /** 这篇打开成当前文档时调：清掉它不再用的图片（`text` 是读出的正文）。只有按文档存图片的浏览器本地有这一项。 */
  sweepAssets?(docId: string, text: string): Promise<void>;
  /** 把外链图片下载进文档旁边的 assets/，返回写进正文的相对路径；做不到的后端没有这一项。失败抛给人看的错。 */
  transfer?(docId: string, url: string): Promise<string>;
  /** 图床；只有本机网关后端有。 */
  imageHost?: ImageHostApi;
  /** 外面改了文档时通知；做不到的后端没有这一项（靠窗口重新获得焦点时比对版本）。返回停止监听的函数。 */
  watch?(onChange: (change: StoreChange) => void): () => void;
}
