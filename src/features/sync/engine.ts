/**
 * 手动同步一次（实施计划 4.8，MVP 不自动）：逐篇按 src/sync/plan.ts 的判定推、拉，或者记下要用户选的事。
 * 不静默丢任何一边：两边都改了、一边删了，都放进「要你选的事」；拉之前本机那版先存进版本历史。
 */
import { signal } from "nsh";
import { messageOf } from "../../doc/message";
import { pinBackend } from "../../store/backend";
import type { DocMeta } from "../../store/document-store";
import { currentDocId, displayName, refreshLibrary } from "../../store/library";
import {
  buryRecord,
  type GistLink,
  goneRecords,
  linkedGistIds,
  putGoneRecord,
  readLastSync,
  saveLastSync,
  type SyncRecord,
  syncRecords,
} from "../../store/sync-store";
import { currentAccount, github } from "../../sync/account";
import { type Gist, type GistSummary, type GitHub, gistFileName, gistTitle, SyncError } from "../../sync/github";
import { decide, same } from "../../sync/plan";
import { problemText } from "../library/external";
import { linkTo, localText, replaceLocal } from "./apply";

/**
 * 要用户选的事。`id` 是本机文档的 id；本机删了的那种（`local-deleted`）是它连着的 Gist 的 id（记录已经挪成墓碑，见 sync-store 的 `buryRecord`）。
 * `name-match`：这篇没同步过，GitHub 上有一个同名、内容不一样的 Pairdown 文档，问连上它还是另建一个。
 * `upload`：这一轮要新建 Gist 的那些篇（还没上传过），用户勾选确认后才上传；一轮只有一件。
 */
export type Issue =
  | { kind: "upload"; docs: { id: string; name: string }[] }
  | { kind: "conflict"; id: string; name: string; local: string; remote: Gist }
  | { kind: "name-match"; id: string; name: string; local: string; remote: Gist }
  | { kind: "remote-deleted"; id: string; name: string }
  | { kind: "local-deleted"; id: string; name: string; remote: Gist }
  | { kind: "remote-only"; gist: GistSummary }
  | { kind: "failed"; id: string; name: string; message: string };

/**
 * `done`：同步完了，推拉了几篇、当时列出几件要选的事，和之后在要选的事里上传了几篇、几篇没勾标成了不同步（结果句见 `resultText`）；
 * `listed`：刚登录，只列了 GitHub 上有、本机没有的。
 */
export type RunState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; pushed: number; pulled: number; asked: number; uploaded: number; excluded: number }
  | { kind: "listed" }
  | { kind: "error"; message: string };

const run = signal<RunState>({ kind: "idle" });
const issues = signal<Issue[]>([]);
const lastAt = signal<number | null>(null);
/** 这次的结果和要选的事是哪个账号的：换了账号（别的标签页里）就不能再照着它们去推、拉。 */
const owner = signal<string | null>(null);

export const syncRun = () => run();
export const syncIssues = () => issues();
export const lastSyncAt = () => lastAt();
export const issuesOwner = () => owner();

export function issueKey(i: Issue): string {
  if (i.kind === "upload") return "upload";
  return i.kind === "remote-only" ? `remote:${i.gist.id}` : `${i.kind}:${i.id}`;
}

/** 去掉一件已经处理了的事。 */
export function dropIssue(issue: Issue) {
  issues.update((list) => list.filter((i) => issueKey(i) !== issueKey(issue)));
}

export function replaceIssue(issue: Issue, next: Issue) {
  issues.update((list) => list.map((i) => (issueKey(i) === issueKey(issue) ? next : i)));
}

export async function loadLastSync() {
  lastAt.set(await readLastSync().catch(() => null));
}

/** 这几种错一篇都同步不了（登录失效、限流、断网），整次停下。 */
const fatal = (e: unknown) => e instanceof SyncError && (e.kind === "auth" || e.kind === "rate" || e.kind === "network");

type Outcome = "pushed" | "pulled" | "same" | Issue;

/**
 * 一次同步里共用的：GitHub、账号、列出的 Pairdown Gist，和已经有主的 Gist（连着本机的某篇，或者这次已经问过）。
 * `uploads`：要新建 Gist 的篇，这一轮不建，攒起来让用户确认。
 */
interface Run {
  api: GitHub;
  login: string;
  listed: GistSummary[];
  claimed: Set<string>;
  uploads: { id: string; name: string }[];
}

/** 这篇连着的 Gist（得是现在这个账号的）。 */
const linkOf = (record: SyncRecord | undefined, login: string): GistLink | null => (record?.link && record.link.login === login ? record.link : null);

/** 推不上去的原因（空文档、记录是别的账号的）；能推是 null。resolve.ts 的「保留本机的」「重新上传」也用它。 */
export function pushProblem(local: string, link: GistLink | null | undefined, login: string): string | null {
  if (local.trim() === "") return "这篇是空的，Gist 存不了空文件，没有推上去（GitHub 上那份没动）。";
  if (link && link.login !== login) return `这篇连着的是 @${link.login} 的 Gist，现在登录的是 @${login}，没有推。`;
  return null;
}

/** 在要选的事里上传了（确认上传、重新上传、另建）：记进这次的结果句。 */
export function noteUploaded(uploaded: number, excluded = 0) {
  run.update((s) => (s.kind === "done" ? { ...s, uploaded: s.uploaded + uploaded, excluded: s.excluded + excluded } : s));
}

/**
 * Gist 里的文件名按哪个名字起：和说明一样用显示名（正文有标题就是标题）。
 * `remoteFileName`：已经连着的 Gist 现在的文件名；它还是按文档名起的（早先建的）就不改，只有两个名字都对不上（本机改了名）才换成显示名。
 */
export function gistNameOf(doc: { title: string; name: string }, remoteFileName?: string): string {
  return remoteFileName !== undefined && gistFileName(doc.name) === remoteFileName ? doc.name : displayName(doc);
}

/** 推上去。`remoteFileName` 是刚从 GitHub 读到的文件名：别处改过名时用记录里的旧名字会在 Gist 里多出一个文件。 */
async function push(r: Run, doc: DocMeta, link: GistLink, local: string, remoteFileName: string): Promise<Outcome> {
  const name = displayName(doc);
  const problem = pushProblem(local, link, r.login);
  if (problem) return { kind: "failed", id: doc.id, name, message: problem };
  const gist = await r.api.updateGist(link.gistId, remoteFileName, gistNameOf(doc, remoteFileName), name, local);
  if (!gist) return { kind: "remote-deleted", id: doc.id, name };
  await linkTo(doc.id, gist, local, r.login);
  return "pushed";
}

/**
 * 没同步过的一篇：GitHub 上有同名（文件名一样）、全文也一样的 Pairdown 文档就直接连上（上次推成功了但记录没写上时，不再建一个）；
 * 同名不同文的问用户；都没有时记进 `uploads`，等用户确认了再新建（resolve.ts 的 `uploadChosen`）。
 */
async function firstSync(r: Run, doc: DocMeta, local: string): Promise<Outcome> {
  if (local.trim() === "") return "same";
  const fileName = gistFileName(gistNameOf(doc));
  let differs: Gist | null = null;
  for (const candidate of r.listed.filter((g) => g.fileName === fileName && !r.claimed.has(g.id))) {
    const gist = await r.api.getGist(candidate.id, fileName);
    if (!gist) continue;
    if (same(gist.text, local)) {
      r.claimed.add(gist.id);
      await linkTo(doc.id, gist, gist.text, r.login);
      return "same";
    }
    differs = differs ?? gist;
  }
  if (differs) {
    r.claimed.add(differs.id);
    return { kind: "name-match", id: doc.id, name: displayName(doc), local, remote: differs };
  }
  r.uploads.push({ id: doc.id, name: displayName(doc) });
  return "same";
}

async function syncOne(r: Run, doc: DocMeta, record: SyncRecord | undefined): Promise<Outcome> {
  const name = displayName(doc);
  const local = await localText(doc.id);
  if (local === null) return "same";
  const link = linkOf(record, r.login);
  if (!link) return firstSync(r, doc, local);
  const remote = await r.api.getGist(link.gistId, link.fileName);
  let decision = decide(local, link, remote);
  if (!remote) return decision === "remote-deleted" ? { kind: "remote-deleted", id: doc.id, name } : "same";
  // 只在本机改了名：内容没变也推一次，把 Gist 里的文件名跟上
  if (decision === "none" && gistFileName(gistNameOf(doc, remote.fileName)) !== remote.fileName) decision = "push";
  switch (decision) {
    case "push":
      return push(r, doc, link, local, remote.fileName);
    case "pull": {
      const problem = await replaceLocal(doc.id, remote.text, local);
      if (problem) return { kind: "failed", id: doc.id, name, message: problem };
      await linkTo(doc.id, remote, remote.text, r.login);
      return "pulled";
    }
    case "adopt":
      await linkTo(doc.id, remote, remote.text, r.login);
      return "same";
    case "conflict":
      return { kind: "conflict", id: doc.id, name, local, remote };
    default:
      return "same";
  }
}

/** 本机删了、墓碑还在的：GitHub 上也没了（两边都没了）才丢掉这条墓碑；还在就问用户（不跟着删 GitHub 上的）。 */
async function orphan(api: GitHub, link: GistLink): Promise<Issue | null> {
  const remote = await api.getGist(link.gistId, link.fileName);
  if (remote) return { kind: "local-deleted", id: link.gistId, name: gistTitle(remote), remote };
  await putGoneRecord(link.gistId, null);
  return null;
}

/** GitHub 上有、这台设备上（哪个文库都算）没有连着、这次也没问到的 Pairdown Gist。 */
function remoteOnly(listed: GistSummary[], linked: Set<string>, asked: Issue[]): Issue[] {
  const taken = new Set([...linked, ...asked.flatMap((i) => (i.kind === "name-match" ? [i.remote.id] : []))]);
  return listed.filter((g) => !taken.has(g.id)).map((gist) => ({ kind: "remote-only", gist }));
}

/**
 * 本机已经没有的那些篇。`present`：本机还在的全部文档（打不开的也算在，不当成删了）。
 * 先把还留在 id 上的记录（别处删掉的：访达、别的程序）挪成墓碑，再逐条看墓碑：同名的新文档不能接着用它们。
 */
async function orphans(api: GitHub, login: string, present: Set<string>, records: Map<string, SyncRecord>): Promise<Issue[]> {
  for (const [id, record] of records) if (!present.has(id)) await buryRecord(id, record.link?.gistId);
  const found: Issue[] = [];
  for (const [gistId, record] of await goneRecords()) {
    const link = linkOf(record, login);
    if (!link || record.excluded) continue;
    try {
      const issue = await orphan(api, link);
      if (issue) found.push(issue);
    } catch (e) {
      if (fatal(e)) throw e;
      console.warn("deleted document not checked", gistId, e);
      found.push({ kind: "failed", id: gistId, name: link.fileName, message: messageOf(e) });
    }
  }
  return found;
}

/** 打不开的文档（不是 UTF-8、太大）里连着 Gist 的：这次跳过，说一声。 */
function unreadable(docs: DocMeta[], records: Map<string, SyncRecord>, login: string): Issue[] {
  return docs.flatMap((doc): Issue[] => {
    const record = records.get(doc.id);
    if (!doc.problem || record?.excluded || !linkOf(record, login)) return [];
    return [{ kind: "failed", id: doc.id, name: displayName(doc), message: `跳过：打不开（${problemText(doc.problem)}），没有同步。GitHub 上那份没动。` }];
  });
}

function summarize(done: Extract<RunState, { kind: "done" }>, open: Issue[]): string {
  const counts = [done.pushed > 0 ? `推上去 ${done.pushed} 篇` : "", done.pulled > 0 ? `拉下来 ${done.pulled} 篇` : "", done.uploaded > 0 ? `上传了 ${done.uploaded} 篇` : ""];
  const moved = counts.filter(Boolean).join("，");
  const upload = open.find((i) => i.kind === "upload");
  const others = open.length - (upload ? 1 : 0);
  const parts = moved ? [`${moved}。`] : [];
  if (done.excluded > 0) parts.push(`没勾的 ${done.excluded} 篇标成了不同步。`);
  if (upload) parts.push(`${upload.docs.length} 篇还没上传过，勾选确认后才上传。`);
  if (others > 0) parts.push(`${others} 件事要你选。`);
  if (parts.length === 0) parts.push(done.asked > 0 ? "要你选的事都处理完了。" : "都是最新的。");
  return parts.join("");
}

/** 结果一句话：推拉了几篇，加上现在还剩的待选事项（处理掉一件就跟着变）。不在「同步完 / 刚列出」时是 null。 */
export function resultText(): string | null {
  const state = run();
  const open = issues();
  if (state.kind === "done") return summarize(state, open);
  if (state.kind !== "listed") return null;
  const missing = open.filter((i) => i.kind === "remote-only").length;
  return missing > 0 ? `GitHub 上有 ${missing} 篇 Pairdown 文档这台设备上没有，要的话拉到本机。` : null;
}

async function syncDocs(r: Run, docs: DocMeta[], records: Map<string, SyncRecord>) {
  let pushed = 0;
  let pulled = 0;
  const found: Issue[] = [];
  for (const doc of docs) {
    const record = records.get(doc.id);
    if (record?.excluded) continue;
    try {
      const outcome = await syncOne(r, doc, record);
      if (outcome === "pushed") pushed++;
      else if (outcome === "pulled") pulled++;
      else if (outcome !== "same") found.push(outcome);
    } catch (e) {
      if (fatal(e)) throw e;
      console.warn("document not synced", doc.id, e);
      found.push({ kind: "failed", id: doc.id, name: displayName(doc), message: messageOf(e) });
    }
  }
  return { pushed, pulled, found };
}

/** 这个后端里已经有主的 Gist：连着某篇的，和本机删了、还没处理的（墓碑）。没同步过的新文档不去对这些。 */
async function claimedIn(records: Map<string, SyncRecord>, login: string): Promise<Set<string>> {
  const all = [...records.values(), ...(await goneRecords()).values()];
  return new Set(all.flatMap((rec) => linkOf(rec, login)?.gistId ?? []));
}

/** 同步一次。已经在同步时不重复开始；正在换存储（重新连接网关）时这次不同步。 */
export async function runSync() {
  if (run().kind === "running") return;
  const unpin = pinBackend();
  if (!unpin) return run.set({ kind: "error", message: "正在换存储（重新连接本机网关），换好以后再同步。" });
  run.set({ kind: "running" });
  try {
    const { api, login } = await github();
    const all = await refreshLibrary();
    const records = await syncRecords();
    const listed = await api.listPairdownGists();
    const r: Run = { api, login, listed, claimed: await claimedIn(records, login), uploads: [] };
    const { pushed, pulled, found } = await syncDocs(r, all.filter((d) => !d.problem), records);
    if (r.uploads.length > 0) found.unshift({ kind: "upload", docs: r.uploads });
    found.push(...unreadable(all, records, login));
    found.push(...(await orphans(api, login, new Set(all.map((d) => d.id)), records)));
    found.push(...remoteOnly(listed, await linkedGistIds(login), found));
    const now = Date.now();
    owner.set(login);
    issues.set(found);
    lastAt.set(now);
    await saveLastSync(now).catch((e: unknown) => console.warn("last sync time not saved", e));
    run.set({ kind: "done", pushed, pulled, asked: found.length, uploaded: 0, excluded: 0 });
    if (currentDocId()) await refreshLibrary();
  } catch (e) {
    console.warn("sync failed", e instanceof SyncError ? e.kind : "", messageOf(e));
    run.set({ kind: "error", message: messageOf(e) });
  } finally {
    unpin();
  }
}

/** 刚登录：只看 GitHub 上有哪些本机没有的 Pairdown 文档，列出来让用户选要不要拉，不推任何东西。 */
export async function discoverRemote() {
  try {
    const { api, login } = await github();
    const listed = await api.listPairdownGists();
    if (owner() !== login) resetSyncView();
    const found = remoteOnly(listed, await linkedGistIds(login), issues());
    owner.set(login);
    issues.update((list) => [...list.filter((i) => i.kind !== "remote-only"), ...found]);
    if (found.length > 0) run.set({ kind: "listed" });
  } catch (e) {
    console.warn("remote documents not listed", messageOf(e));
    run.set({ kind: "error", message: messageOf(e) });
  }
}

/** 退出登录、换了账号：这次的结果和要选的事都清掉（换个账号登录时不混在一起）。 */
export function resetSyncView() {
  issues.set([]);
  owner.set(null);
  run.set({ kind: "idle" });
}

/** 窗口回到前台、重读过登录以后调：要选的事是别的账号的（别的标签页里退出或换了账号），清掉。 */
export function dropViewOfOtherAccount() {
  const account = currentAccount();
  const login = account.kind === "signed-in" ? account.login : null;
  if (owner() !== null && owner() !== login) resetSyncView();
}
