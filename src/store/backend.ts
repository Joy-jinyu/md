/**
 * 这次用的文档库存储，只在这里定（实施计划 10.2）：macOS 是文库文件夹；网页里连得上本机网关就用网关，连不上用浏览器本地。
 * 启动时由编辑页调一次 `chooseBackend`；之后只有「重新连网关」（`useGateway`）会换。在那之前（和测试里）是浏览器本地。
 */
import { signal, Storage } from "nsh";
import { type DocumentStore, NameTaken, type StoreChange } from "./document-store";
import { type Connect, type GatewayBackend, type GatewayLink, GatewayRefused, openGateway } from "./gateway-store";
import { dropHistory, moveHistory, setHistoryScope } from "./history";
import { assetSrc, IMAGE_TYPES } from "./image-file";
import { docsInIndexedDb, LOCAL_TAG } from "./kv";
import { createLocalStore } from "./local-store";
import { buryRecord, moveSyncRecord, setSyncScope } from "./sync-store";

/** 启动时等网关多久（毫秒）：本机连接通常几毫秒就回，连不上（拒绝）是立刻失败；只有浏览器在问「允许访问本机」时会等到超时，这时先用本地。 */
const GATEWAY_PROBE_MS = 600;
/** 上次用的是哪个后端（`backendTag`）：这次没连上网关、退回浏览器本地时用它提醒。 */
const LAST_BACKEND_KEY = "md.lastBackend";
const GATEWAY_TAG = "gateway:";
/** 复制时重名加序号最多试到几：再多多半是哪里不对，算没能复制。 */
const MAX_COPY_SUFFIX = 99;

/** macOS 的文库文件夹：后端本身，和给人看的位置（`~/Documents/Pairdown`）。 */
export interface FileLibrary {
  store: DocumentStore;
  folder: string;
}

export type StorageKind = { kind: "local" } | { kind: "gateway"; gateway: GatewayBackend } | { kind: "files"; folder: string };

const local = createLocalStore();
let active: DocumentStore = local;
const chosen = signal<StorageKind>({ kind: "local" });
const watchers = new Set<(change: StoreChange) => void>();
let unwatch: (() => void) | null = null;
/** 网关拒绝了这个页面（来源、版本、端口上不是网关）的原因；没拒绝是 null。 */
const refusal = signal<string | null>(null);
/** 上次用的网关文库名：这次没连上、退回了浏览器本地时才有。 */
const missedLibrary = signal<string | null>(null);
/** 第一次搬进文库时没能搬走、还留在应用里的文档。 */
const leftBehind = signal<string[]>([]);
/** 正在同步（`pinBackend`）的次数：这期间不换后端，不然同步记录、版本历史会写进另一个后端。 */
let pins = 0;
/** 正在换后端（`beginSwitch`）：这期间不开始同步。 */
let switching = false;

function use(store: DocumentStore, kind: StorageKind) {
  unwatch?.();
  active = store;
  unwatch = store.watch?.((change) => {
    // 外面（访达、别的标签页）改了名：同步记录和版本历史跟到新名字上，不然旧记录被当成「本机删了」、新名字又建一个 Gist
    for (const r of change.renamed ?? []) {
      moveSyncRecord(r.from, r.to).catch((e: unknown) => console.warn("sync record not moved", e));
      moveHistory(r.from, r.to).catch((e: unknown) => console.warn("history not moved", e));
    }
    for (const w of watchers) w(change);
  }) ?? null;
  chosen.set(kind);
  setHistoryScope(backendTag());
  setSyncScope(backendTag());
}

export const documentStore: DocumentStore = {
  list: () => active.list(),
  read: (id) => active.read(id),
  write: (id, text, baseVersion) => active.write(id, text, baseVersion),
  create: (name, text) => active.create(name, text),
  rename: (id, name) => active.rename(id, name),
  remove: (id) => active.remove(id),
  putAsset: (docId, bytes) => active.putAsset(docId, bytes),
  getAsset: (docId, src) => active.getAsset(docId, src),
  sweepAssets: (docId, text) => active.sweepAssets?.(docId, text) ?? Promise.resolve(),
  /** 只有本机网关能转存（`canTransfer`）：浏览器本地跨不了域，macOS 应用要放行任意域名才下得了。 */
  transfer: (docId, url) => (active.transfer ? active.transfer(docId, url) : Promise.reject(new Error("现在的存储不能转存外链图片（要连着本机网关）"))),
  /** 跟着存储走：换了后端（重新连上网关）以后照样收到。 */
  watch(onChange: (change: StoreChange) => void) {
    watchers.add(onChange);
    return () => watchers.delete(onChange);
  },
};

/** 现在用的是哪种存储（设置页显示）。 */
export const storageKind = () => chosen();

/**
 * 「别处」在现在的存储上指什么，冲突条、回执、保存出错的说明共用（DESIGN.md「冲突条」）：
 * 浏览器本地只可能是另一个标签页；文库文件夹和网关是文件，改它的是别的程序（编辑器、同步盘，也包括开着同一个文库的另一个标签页）。
 */
export function elsewhereWords(): { changed: string; deleted: string } {
  return chosen().kind === "local"
    ? { changed: "这篇在另一个标签页里改过", deleted: "这篇已经在另一个标签页里删除了" }
    : { changed: "文库里的文件被别的程序改了", deleted: "文库里的这个文件被别的程序删除或挪走了" };
}

/** 现在的存储能不能把外链图片转存到本地（随换后端变）。 */
export function canTransfer(): boolean {
  void chosen();
  return active.transfer !== undefined;
}

/** 网关后端的连接状况；不是网关后端时是 null。 */
export function gatewayLink(): GatewayLink | null {
  const k = chosen();
  return k.kind === "gateway" ? k.gateway.link() : null;
}

/**
 * 一个 id 要给一篇新的用了（新建、导入，`target.create` 建出来的），或者那篇删了：版本历史删掉，同步记录挪成墓碑。
 * 文件类后端的 id 是路径，删掉的那篇的键留在上面，同名的新文档就会接着旧文档的历史、推进旧文档的 Gist。
 */
export async function releaseKeys(id: string) {
  await Promise.all([buryRecord(id), dropHistory(id)]);
}

/** 同步开跑时调：这期间不换后端（「重新连接网关」会等它跑完）。返回解除的函数；正在换后端时是 null，这次不同步。 */
export function pinBackend(): (() => void) | null {
  if (switching) return null;
  pins++;
  let done = false;
  return () => {
    if (!done) pins--;
    done = true;
  };
}

/** 要换后端时先调：正在同步时是 null，不换；不然返回换完（或不换了）时调的函数。 */
export function beginSwitch(): (() => void) | null {
  if (pins > 0 || switching) return null;
  switching = true;
  return () => {
    switching = false;
  };
}

/** 网关拒绝了这个页面的原因（设置页「存储」里显示）；没有是 null。 */
export const gatewayRefusal = () => refusal();

/** 上次用的是本机网关的这个文库、这次没连上，用的是浏览器本地：文库名；不是这种情况是 null。 */
export const missedGatewayLibrary = () => missedLibrary();

/** 搬进 macOS 文库时没搬走的文档（名字）。 */
export const documentsLeftBehind = () => leftBehind();

/** 应急键、版本历史属于哪个后端：同一个 id 在不同后端里不是同一篇，只认这次用的这个后端的。 */
export function backendTag(): string {
  const k = chosen();
  return k.kind === "gateway" ? `${GATEWAY_TAG}${k.gateway.library()}` : k.kind;
}

/** 别的后端的标签 → 给人看的名字。 */
export function backendLabel(tag: string): string {
  if (tag.startsWith(GATEWAY_TAG)) return `本机网关的文库「${tag.slice(GATEWAY_TAG.length)}」`;
  return tag === "files" ? "文库文件夹" : "浏览器本地";
}

/** 文档正文和 Storage 里的小键挤在同一个 5MB 里（浏览器本地、IndexedDB 没用上）：这时应急键不一定放得下。 */
export const docsShareStorage = () => chosen().kind === "local" && !docsInIndexedDb();

export interface CopyReport {
  /** 建进文库的（名字是文库里的名字）。 */
  copied: string[];
  /** 文库里已经有一样内容的，不用再建。 */
  same: string[];
  failed: string[];
  /** 文档复制过去了、图片没能全部复制过去的（「名字（N 张）」）。 */
  imagesFailed: string[];
}

type CopyOutcome = { kind: "copied"; name: string; id: string } | { kind: "same"; id: string };

/** 浏览器本地存的图片在正文里一律写成 `assets/<内容哈希 16 位>.<扩展名>`（local-store 的 putAsset）。 */
const LOCAL_ASSET = new RegExp(`assets/([0-9a-f]{16}\\.(?:${Object.keys(IMAGE_TYPES).join("|")}))`, "g");

/**
 * 建一篇。名字被内容不同的文档占着就加序号（`名字 2`、` 名字 3`……）再建；占着名字的那篇内容和它一样，算已经在了。
 * 序号版本里有一样的也算已经在了，所以跑几次都一样。`keep`：本地那篇不删，版本历史复制一份、同步记录见 `moveSyncRecord`。
 */
async function copyOne(target: DocumentStore, id: string, label: string, text: string, keep: boolean): Promise<CopyOutcome> {
  for (let n = 1; n <= MAX_COPY_SUFFIX; n++) {
    const name = n === 1 ? label : `${label} ${n}`;
    try {
      const created = await target.create(name, text);
      await releaseKeys(created.id).catch((e: unknown) => console.warn("old keys not released", e));
      await moveHistory(id, created.id, LOCAL_TAG, keep).catch((e: unknown) => console.warn("history not moved", e));
      await moveSyncRecord(id, created.id, LOCAL_TAG, keep).catch((e: unknown) => console.warn("sync record not moved", e));
      return { kind: "copied", name: created.name, id: created.id };
    } catch (e) {
      if (!(e instanceof NameTaken)) throw e;
      if ((await target.read(e.id))?.text !== text) continue;
      await moveSyncRecord(id, e.id, LOCAL_TAG, keep).catch((err: unknown) => console.warn("sync record not moved", err));
      return { kind: "same", id: e.id };
    }
  }
  throw new Error(`「${label}」重名太多`);
}

/**
 * 把本地文档 `fromId` 正文里用到的图片逐张复制给 `target` 里的 `toId`。目标给的文件名一样（三种后端都按内容哈希取名）正文就不用改；
 * 不一样时把正文里的地址换掉再写回。返回没复制成的张数（本地也找不到的不算：它本来就显示不出来）。
 */
async function copyImages(source: DocumentStore, target: DocumentStore, fromId: string, toId: string, text: string): Promise<number> {
  let next = text;
  let failed = 0;
  for (const name of new Set([...text.matchAll(LOCAL_ASSET)].map((m) => m[1]))) {
    try {
      const asset = await source.getAsset(fromId, assetSrc(name));
      if (!asset) continue;
      const src = await target.putAsset(toId, asset.bytes);
      if (src !== assetSrc(name)) next = next.split(assetSrc(name)).join(src);
    } catch (e) {
      console.error("image not copied", fromId, name, e);
      failed++;
    }
  }
  if (next !== text) {
    const now = await target.read(toId);
    const written = now ? await target.write(toId, next, now.version) : { ok: false };
    if (!written.ok) throw new Error("图片复制过去了，但没能改正文里的地址");
  }
  return failed;
}

/**
 * 把浏览器本地（IndexedDB / Storage）里的文档逐篇建到 `target`：文件名取标题（没有取名字），重名不覆盖（见 `copyOne`）。
 * `move`：建成了（或者文库里已经有一样的）就删掉本地那篇（版本历史跟到新 id 下）；不删时版本历史复制一份。
 * 同步记录不管删不删都跟到文库那篇上（一个 Gist 只连一篇），不删时本地那篇记成「不同步」。跑几次都一样。
 * 正文里用到的图片一起复制（`copyImages`）。`source` 只在测试里换（测试环境没有 IndexedDB，浏览器本地存不了图片）。
 */
export async function copyLocalDocs(target: DocumentStore, move: boolean, source: DocumentStore = local): Promise<CopyReport> {
  const report: CopyReport = { copied: [], same: [], failed: [], imagesFailed: [] };
  for (const meta of await source.list()) {
    const label = meta.title || meta.name;
    try {
      const text = (await source.read(meta.id))?.text;
      if (text === undefined) continue;
      const outcome = await copyOne(target, meta.id, label, text, !move);
      if (outcome.kind === "copied") report.copied.push(outcome.name);
      else report.same.push(label);
      const missing = await copyImages(source, target, meta.id, outcome.id, text);
      // 图片没复制全时本地那篇不删（删文档会连图片一起删），下次再复制：正文一样算已经在了，只补图片
      if (missing > 0 && move) throw new Error(`${missing} 张图片没能复制`);
      if (missing > 0) report.imagesFailed.push(`${label}（${missing} 张）`);
      if (move) await source.remove(meta.id);
    } catch (e) {
      console.error("document not copied", meta.id, e);
      report.failed.push(label);
    }
  }
  return report;
}

/** 用着网关时，把浏览器本地的文档复制进网关的文库（设置页的按钮）：逐篇建，重名加序号，本地的不删（连着 Gist 的改成「不同步」）。 */
export function copyBrowserDocsToLibrary(): Promise<CopyReport> {
  if (chosen().kind !== "gateway") return Promise.reject(new Error("现在没有连着本机网关"));
  return copyLocalDocs(active, false);
}

/** 试着连网关；连不上是 null。网关拒绝了这个页面时记下原因（设置页显示），也是 null。 */
async function probeGateway(connect?: Connect): Promise<GatewayBackend | null> {
  try {
    const gateway = await openGateway(GATEWAY_PROBE_MS, connect);
    refusal.set(null);
    return gateway;
  } catch (e) {
    if (!(e instanceof GatewayRefused)) throw e;
    console.warn("gateway refused this page", e.message);
    refusal.set(e.message);
    return null;
  }
}

function remember(tag: string) {
  Storage.setItem(LAST_BACKEND_KEY, tag).catch((e: unknown) => console.warn("backend not remembered", e));
}

/** 记下这次用的后端；这次退回了浏览器本地、上次用的是网关时不记（不然下次就不提醒了），改成标出来。 */
async function noteBackend() {
  const tag = backendTag();
  const last = await Storage.getItem(LAST_BACKEND_KEY).catch((e: unknown) => {
    console.warn("last backend unreadable", e);
    return null;
  });
  if (tag === LOCAL_TAG && last?.startsWith(GATEWAY_TAG)) return missedLibrary.set(last.slice(GATEWAY_TAG.length));
  missedLibrary.set(null);
  if (last !== tag) remember(tag);
}

/** 不再提醒上次用的网关（用户选了就用浏览器里的）。 */
export function forgetMissedGateway() {
  missedLibrary.set(null);
  remember(backendTag());
}

/** 网关没连上、正在用浏览器本地时，再试一次网关：连上了返回它（还没换过去，见 `useGateway`）。 */
export function probeGatewayAgain(): Promise<GatewayBackend | null> {
  return probeGateway();
}

/** 换成这个网关（调用方先把开着的那篇存好、关掉）。 */
export async function useGateway(gateway: GatewayBackend) {
  use(gateway.store, { kind: "gateway", gateway });
  await noteBackend();
}

/**
 * 启动时定下用哪种存储。`files`：macOS 的文库文件夹（第一次用时把 Storage 里的文档搬进去）；`probeGateway`：网页里先试网关。
 * 搬文档出错不挡启动：没搬走的留在本地，下次再搬，界面上提一句。`connect` 只在测试里换。
 */
export async function chooseBackend(files: FileLibrary | null, probe: boolean, connect?: Connect): Promise<void> {
  if (files) {
    use(files.store, { kind: "files", folder: files.folder });
    await noteBackend();
    const report = await copyLocalDocs(files.store, true).catch((e: unknown) => {
      console.error("documents not moved into the library", e);
      return null;
    });
    if (report && report.failed.length > 0) console.warn("some documents stay in Storage", report);
    leftBehind.set(report?.failed ?? []);
    return;
  }
  const gateway = probe ? await probeGateway(connect) : null;
  if (gateway) use(gateway.store, { kind: "gateway", gateway });
  else {
    setHistoryScope(backendTag());
    setSyncScope(backendTag());
  }
  await noteBackend();
}
