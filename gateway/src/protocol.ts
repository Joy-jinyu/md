/**
 * 网关协议：页面和网关共用这一份。这个文件只放类型和常量，不 import 任何东西（node 和 nsh 都要能直接读）。
 *
 * 传输：一条 WebSocket 文本消息 = 一个 JSON。页面发 Request，网关对每个请求回一个 Reply（id 相同），
 * 另外主动推 ChangedEvent / RelistEvent。连上后第一条必须是 hello，否则网关用 CLOSE_NO_HELLO 断开；
 * HELLO_TIMEOUT_MS 内不发 hello 也一样断开。
 */

/** 协议版本：页面和网关不一致就拒绝合作（hello 回 version-mismatch 并断开）。只有旧的一方处理不了的改动才加一。 */
export const PROTOCOL_VERSION = 1;

/** 网关默认端口，页面先试这个。 */
export const DEFAULT_PORT = 7341;

/** 网关只听这个地址，没有参数能改。 */
export const LISTEN_HOST = "127.0.0.1";

/** 单张图片（putAsset、transfer 下载）的上限：10 MiB。超过回 too-large。 */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/**
 * 单条 WebSocket 消息上限：图片按 base64 放进 JSON，10 MiB 图片约 13.4 MiB，留些余量。
 * 超过它的消息网关收不下，只能用 CLOSE_MESSAGE_TOO_BIG 断开连接，回不了 too-large：
 * 约 11.9 MiB 以上的图片 putAsset 会走到这一步，所以页面发之前先按 MAX_ASSET_BYTES 自己挡掉。
 */
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

/**
 * 单篇文档（read、write、create 的 UTF-8 字节数）上限：5 MiB。超过回 too-large，list 里标 problem: "too-large"。
 * 取 5 MiB：write 的 text 经 JSON 转义（换行、引号）最多约翻一倍，仍在 MAX_MESSAGE_BYTES 以内。
 */
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

/** 连上后多久内必须发 hello，否则用 CLOSE_NO_HELLO 断开。 */
export const HELLO_TIMEOUT_MS = 10_000;

/** 图片放在文档所在目录下的这个子目录里（`<文档目录>/assets/<哈希>.<扩展名>`）。 */
export const ASSET_DIR = "assets";

/** 网关认的图片类型（扩展名 → MIME）。不收 SVG：SVG 能带脚本，转成 blob 地址后被直接打开会在页面的源里执行。 */
export const IMAGE_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
} as const;
export type ImageExt = keyof typeof IMAGE_TYPES;

/** WebSocket 关闭码：第一条消息不是 hello。 */
export const CLOSE_NO_HELLO = 4000;
/** WebSocket 关闭码：协议版本不一致。 */
export const CLOSE_VERSION = 4002;
/** WebSocket 关闭码：Origin 不在白名单（或没有 Origin）。握手先完成再关，浏览器才看得到这个码。 */
export const CLOSE_ORIGIN = 4003;
/** WebSocket 关闭码：网关的连接数到上限了。握手先完成再关。 */
export const CLOSE_BUSY = 4004;
/** WebSocket 关闭码（标准码，ws 库发）：单条消息超过 MAX_MESSAGE_BYTES。非法帧是标准码 1002。 */
export const CLOSE_MESSAGE_TOO_BIG = 1009;

/** 错误码：发布后含义不变，页面按它分支，message 只给人看。 */
export type ErrorCode =
  | "bad-request" // 消息格式不对、缺字段、不认识的 op
  | "no-hello" // 没 hello 就发别的请求
  | "version-mismatch" // hello 里的协议版本和网关不同
  | "bad-path" // 路径不合规：..、绝对路径、隐藏文件、扩展名不对、跳出文库；符号链接指向文库外、隐藏文件或别的类型；上级是文件不是文件夹
  | "not-found"
  | "exists" // create / rename 的目标已存在
  | "conflict" // write / remove 的 baseVersion 和磁盘上不一致；error.version 是磁盘上的当前版本
  | "too-large" // 图片超过 MAX_ASSET_BYTES，文档超过 MAX_DOC_BYTES
  | "not-utf8" // read / write：磁盘上的文档不是合法 UTF-8（如 GBK），不读也不写，免得写回时弄坏
  | "busy" // transfer：同时进行的下载到上限了，稍后再试
  | "bad-type" // 不是认得的图片
  | "bad-url" // transfer：不是 http / https，或地址写错
  | "forbidden-address" // transfer：解析到回环 / 内网等地址（含重定向之后）
  | "fetch-failed" // transfer：下载失败、超时、状态码不是 2xx、重定向太多
  | "no-image-host" // uploadImage：还没设置图床
  | "upload-failed" // uploadImage：图床不回、超时、状态码不是 2xx，或返回里找不到图片地址
  | "not-supported"
  | "internal";

/** 打不开编辑的文档：不是 UTF-8，或超过 MAX_DOC_BYTES。照样列出来，但页面不能打开编辑（read 回同名错误码）。 */
export type DocProblem = "not-utf8" | "too-large";

/** list 里每篇文档带回的开头字节数上限（head）。 */
export const HEAD_BYTES = 512;

/** 文档列表里的一项。path 是文库内的相对路径，用 / 分隔，也是文档的 id。能正常编辑的文档没有 problem 字段。 */
export type DocMeta = {
  path: string;
  size: number;
  mtimeMs: number;
  problem?: DocProblem;
  /** 文件开头最多 HEAD_BYTES 字节的原文，按字符边界截断，去掉开头的 BOM；有 problem 时不发；旧网关不发。 */
  head?: string;
};

/**
 * 图床有两种，配置都存在网关的 config.json 里，上传由网关发。
 *
 * 上传接口（kind 不写或 "upload"）：一个收 multipart/form-data 的接口（PicGo 的自定义图床那种）。
 * url：上传地址（http / https）。field：放图片的表单字段名。urlPath：返回的 JSON 里图片地址在哪（`data.url` 这样的点路径）；
 * 空串是自动找（url、data.url、data.links.url、result.0、data.0 里第一个是 http(s) 地址的）。
 */
export type ImageHostSettings = { kind?: "upload"; url: string; field: string; urlPath: string };

/**
 * GitHub 仓库当图床：图片提交到 `repo`（`用户/仓库`）的 `branch` 分支、`dir` 目录下（文件名是内容哈希），
 * 正文写 `https://raw.githubusercontent.com/<repo>/<branch>/<dir>/<文件>`，所以仓库要是公开的。
 */
export type GithubHostSettings = { kind: "github"; repo: string; branch: string; dir: string };

/** 页面看到的图床配置：请求头、令牌是密钥，只说有没有、不给值。 */
export type ImageHostView = (ImageHostSettings & { headerNames: string[] }) | (GithubHostSettings & { hasToken: boolean });

/** 页面要存的图床配置：headers / token 不给就保留网关里原来的（页面拿不到原值，改别的项时不用重填）；换了种类不保留。 */
export type ImageHostInput = (ImageHostSettings & { headers?: Record<string, string> }) | (GithubHostSettings & { token?: string });

/**
 * 每种请求的参数和成功结果。
 *
 * version：文档内容的 SHA-256（十六进制）。只要内容变了 version 就变，和改动时间无关，所以别的程序改过文件一定能发现。
 * 图片的 doc + src：src 是写在正文里的地址，相对 doc 所在目录；不给 doc 时相对文库根目录。
 */
export type RequestMap = {
  hello: { params: { version: number }; result: { version: number; library: string } };
  list: { params: {}; result: { docs: DocMeta[] } };
  read: { params: { path: string }; result: { text: string; version: string } };
  /** baseVersion 和磁盘上不一致时不写，回 conflict（带当前 version）。 */
  write: { params: { path: string; text: string; baseVersion: string }; result: { version: string } };
  /** 新建文档，目标已存在回 exists，不覆盖。 */
  create: { params: { path: string; text?: string }; result: { version: string } };
  /** 目标已存在回 exists，不覆盖。只改名文档本身，不搬图片。 */
  rename: { params: { path: string; to: string }; result: {} };
  /** 给了 baseVersion 且和磁盘上不一致时不删，回 conflict。 */
  remove: { params: { path: string; baseVersion?: string }; result: {} };
  /** data 是图片字节的 base64。存到 `<doc 目录>/assets/<内容哈希>.<扩展名>`，同一张图只存一份（existed 为 true）。 */
  putAsset: { params: { doc?: string; data: string }; result: { path: string; src: string; existed: boolean } };
  /** 取图片字节（base64），页面转成 blob 地址显示。 */
  getAsset: { params: { doc?: string; src: string }; result: { path: string; mime: string; data: string } };
  /** download：外链图片下载进 assets/。upload（本地 → 图床）还没做，回 not-supported。 */
  transfer: { params: { direction: "download" | "upload"; url: string; doc?: string }; result: { path: string; src: string } };
  /** 现在的图床配置，没设置是 null。旧网关不认这三个 op，回 bad-request。 */
  imageHost: { params: {}; result: { host: ImageHostView | null } };
  /** 设置图床；host 为 null 是清掉。地址不是 http(s) 回 bad-url。 */
  setImageHost: { params: { host: ImageHostInput | null }; result: {} };
  /** data 是图片字节的 base64：按文件头认类型后传到图床，返回图床给的图片地址。没设置图床回 no-image-host。 */
  uploadImage: { params: { data: string }; result: { url: string } };
};

export type Op = keyof RequestMap;

/** 页面发给网关的请求：id 由页面自增，网关原样带回。 */
export type Request<K extends Op = Op> = { [P in K]: { id: number; op: P } & RequestMap[P]["params"] }[K];

export type ErrorBody = { code: ErrorCode; message: string; version?: string };

export type Reply<K extends Op = Op> =
  | { type: "reply"; id: number; ok: true; result: RequestMap[K]["result"] }
  | { type: "reply"; id: number; ok: false; error: ErrorBody };

/**
 * 文库文件夹里的文件变了（含网关自己写的）。version 是文档的当前内容哈希，文件不在了为 null；
 * 图片的 version 也为 null。页面拿 version 和自己手上的比，一样就是自己刚写的，不用处理。
 */
export type ChangedEvent = { type: "changed"; changes: { path: string; version: string | null }[] };

/**
 * 文库里有目录改名、删除、新建这类说不清影响了哪些文档的改动：页面重新 list 一遍，以新列表为准。
 * 目录里的文档不一定会再单独推 changed。
 */
export type RelistEvent = { type: "relist" };

export type ServerMessage = Reply | ChangedEvent | RelistEvent;
