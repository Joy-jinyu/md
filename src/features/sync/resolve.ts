/**
 * 同步面板里「要你选的事」的处理：冲突选一边（另一边存进版本历史）、同名不同文、远端删了、本机删了、远端才有的。
 * 动手前先确认登录的还是列出这些事的那个账号（`sameAccount`）。
 * 每样做完说一句回执；出错时那件事留着，回执写原因。
 */
import { type Phrase, phrase, t } from "../../i18n";
import { signal } from "nsh";
import { handleError, messageOf } from "../../doc/message";
import { pinBackend } from "../../store/backend";
import { addSnapshot } from "../../store/history";
import { allDocs, documentName } from "../../store/library";
import { goneRecordOf, putGoneRecord, putSyncRecord, syncRecordOf } from "../../store/sync-store";
import { github } from "../../sync/account";
import { gistTitle } from "../../sync/github";
import { say } from "../library/receipt";
import { linkTo, localText, pullAsNew, replaceLocal } from "./apply";
import { dropIssue, gistNameOf, type Issue, issuesOwner, noteUploaded, pushProblem, replaceIssue, resetSyncView } from "./engine";

type Of<K extends Issue["kind"]> = Extract<Issue, { kind: K }>;

/** 正在处理的那件事（按钮这时不能再点）。 */
export const resolving = signal<string | null>(null);

/** 一次只处理一件；处理期间不换存储（和同步一样，见 backend.ts 的 `pinBackend`）。 */
async function guarded(key: string, job: () => Promise<void>) {
  if (resolving()) return;
  const unpin = pinBackend();
  if (!unpin) return say(() => t("正在换存储（重新连接本机网关），换好以后再选。", "Wait for the local gateway to reconnect before resolving this item."), "warn");
  resolving.set(key);
  try {
    await job();
  } catch (e) {
    handleError(e, { context: "sync choice failed", severity: "warn" });
    say(() => t(`没能处理：${messageOf(e)}`, `Could not resolve this item: ${messageOf(e)}`), "warn");
  } finally {
    resolving.set(null);
    unpin();
  }
}

/** 本机这篇现在的元数据（名字可能刚改过）。 */
const metaOf = (id: string) => allDocs().find((d) => d.id === id);

/** 现在登录的账号；和这些待选事项不是同一个账号（别的标签页里换了）时清掉它们、说一声，返回 null。 */
async function sameAccount(): Promise<Awaited<ReturnType<typeof github>> | null> {
  const gh = await github();
  if (issuesOwner() === gh.login) return gh;
  resetSyncView();
  say(() => t(`登录的账号换成了 @${gh.login}，刚才那些要选的事作废了。再同步一次。`, `The GitHub account changed to @${gh.login}. The previous sync decisions are no longer available. Sync again.`), "warn");
  return null;
}

/** 冲突选「保留本机的」：GitHub 上那版先存进版本历史，再把本机的推上去。GitHub 上那份在这期间又改了就重新给用户看。 */
export function keepLocal(issue: Of<"conflict">) {
  return guarded(`conflict:${issue.id}`, async () => {
    const gh = await sameAccount();
    if (!gh) return;
    const { api, login } = gh;
    const link = (await syncRecordOf(issue.id))?.link;
    const meta = metaOf(issue.id);
    if (!link || !meta) return dropIssue(issue);
    const local = await localText(issue.id);
    if (local === null) return dropIssue(issue);
    const problem = pushProblem(local, link, login);
    if (problem) return say(() => t(`「${issue.name}」没有推：${phrase(problem)}`, `Could not push “${issue.name}”: ${phrase(problem)}`), "warn");
    const fresh = await api.getGist(link.gistId, link.fileName);
    if (!fresh) return replaceIssue(issue, { kind: "remote-deleted", id: issue.id, name: issue.name });
    if (fresh.version !== issue.remote.version || fresh.text !== issue.remote.text || local !== issue.local) {
      replaceIssue(issue, { ...issue, local, remote: fresh });
      return say(() => t(`「${issue.name}」在你选的时候又改了，再看一眼两边。`, `“${issue.name}” changed while you were deciding. Compare the versions again.`), "warn");
    }
    if (!(await addSnapshot(issue.id, fresh.text))) return say(() => t("本机存储已满，GitHub 上那版存不进版本历史，所以没有动。删掉不用的文档腾出空间后再选。", "Storage is full, so the GitHub version could not be saved to version history. No changes were made. Free some space and try again."), "warn");
    const pushed = await api.updateGist(link.gistId, fresh.fileName, gistNameOf(meta, fresh.fileName), documentName(meta), local);
    if (!pushed) return replaceIssue(issue, { kind: "remote-deleted", id: issue.id, name: issue.name });
    await linkTo(issue.id, pushed, local, login);
    dropIssue(issue);
    say(() => t(`已保留本机的「${issue.name}」并推上 GitHub。GitHub 上原来那版存进了这篇的版本历史。`, `Kept the local version of “${issue.name}” and pushed it to GitHub. The previous GitHub version is in Version History.`), "info");
  });
}

/** 冲突选「用 GitHub 的」：本机这版存进版本历史，再换成 GitHub 上的。 */
export function takeRemote(issue: Of<"conflict">) {
  return guarded(`conflict:${issue.id}`, async () => {
    const gh = await sameAccount();
    if (!gh) return;
    const { login } = gh;
    const problem = await replaceLocal(issue.id, issue.remote.text, null);
    if (problem) return say(() => t(`「${issue.name}」没有换：${phrase(problem)}`, `Could not replace “${issue.name}”: ${phrase(problem)}`), "warn");
    await linkTo(issue.id, issue.remote, issue.remote.text, login);
    dropIssue(issue);
    say(() => t(`已换成 GitHub 上的「${issue.name}」。本机原来的内容存进了这篇的版本历史。`, `Replaced “${issue.name}” with the GitHub version. The previous local content is in Version History.`), "info");
  });
}

/** GitHub 上那份删了，选「重新上传」：建一个新的 Gist。 */
export function reupload(issue: Of<"remote-deleted">) {
  return guarded(`remote-deleted:${issue.id}`, async () => {
    const gh = await sameAccount();
    if (!gh) return;
    const { api, login } = gh;
    const meta = metaOf(issue.id);
    const local = await localText(issue.id);
    if (!meta || local === null) return dropIssue(issue);
    const problem = pushProblem(local, (await syncRecordOf(issue.id))?.link, login);
    if (problem) return say(() => t(`「${issue.name}」没有上传：${phrase(problem)}`, `Could not upload “${issue.name}”: ${phrase(problem)}`), "warn");
    await linkTo(issue.id, await api.createGist(gistNameOf(meta), documentName(meta), local), local, login);
    dropIssue(issue);
    noteUploaded(1);
    say(() => t(`已把「${issue.name}」重新上传到 GitHub。`, `Uploaded “${issue.name}” to GitHub again.`), "info");
  });
}

/** 「不再同步这篇」：记成不同步，断开和 Gist 的连接（GitHub 上的不删）。 */
export function stopSyncing(issue: Of<"remote-deleted">) {
  return guarded(`remote-deleted:${issue.id}`, async () => {
    if (!(await sameAccount())) return;
    await putSyncRecord(issue.id, { excluded: true });
    dropIssue(issue);
    say(() => t(`「${issue.name}」以后不同步了。`, `Sync is off for “${issue.name}”.`), "info");
  });
}

/** 本机删了、GitHub 上还在，选「拉回本机」：存成一篇新文档，连上原来的 Gist。 */
export function pullBack(issue: Of<"local-deleted">) {
  return guarded(`local-deleted:${issue.id}`, async () => {
    const gh = await sameAccount();
    if (!gh) return;
    const name = await pullAsNew(issue.remote, gh.login);
    await putGoneRecord(issue.id, null);
    dropIssue(issue);
    say(() => t(`已把「${name}」从 GitHub 拉回本机。`, `Restored “${name}” from GitHub to this device.`), "info");
  });
}

/** 本机删了，选「不再同步」：墓碑留着但标成不同步，GitHub 上的 Gist 不删，以后也不再问。 */
export function forgetDeleted(issue: Of<"local-deleted">) {
  return guarded(`local-deleted:${issue.id}`, async () => {
    if (!(await sameAccount())) return;
    const record = await goneRecordOf(issue.id);
    await putGoneRecord(issue.id, { ...record, excluded: true });
    dropIssue(issue);
    say(() => t(`「${issue.name}」不再同步了，GitHub 上的那份留着。`, `Stopped syncing “${issue.name}”. Its GitHub copy was kept.`), "info");
  });
}

/** GitHub 上有、本机没有的，拉到本机。 */
export function pullRemote(issue: Of<"remote-only">) {
  return guarded(`remote:${issue.gist.id}`, async () => {
    const gh = await sameAccount();
    if (!gh) return;
    const { api, login } = gh;
    const gist = await api.getGist(issue.gist.id, issue.gist.fileName);
    if (!gist) {
      dropIssue(issue);
      return say(() => t(`「${gistTitle(issue.gist)}」在 GitHub 上已经没有了。`, `“${gistTitle(issue.gist)}” is no longer on GitHub.`), "warn");
    }
    const name = await pullAsNew(gist, login);
    dropIssue(issue);
    say(() => t(`已把「${name}」拉到本机。`, `Downloaded “${name}” to this device.`), "info");
  });
}

/**
 * 没同步过的这篇和 GitHub 上一个同名的文档内容不一样，选「连上并对比」：连上那个 Gist，当成两边都改过的冲突，接着在对比里选一边。
 * 记录里的基线留空：两边都算改过，没选之前每次同步都还是冲突，不会自动推或拉。
 */
export function linkNameMatch(issue: Of<"name-match">) {
  return guarded(`name-match:${issue.id}`, async () => {
    const gh = await sameAccount();
    if (!gh) return;
    await linkTo(issue.id, issue.remote, "", gh.login);
    replaceIssue(issue, { ...issue, kind: "conflict" });
  });
}

/** 同名不同文，选「另建一个」：照常新建一个 Gist，GitHub 上那个同名的不动（以后列成「GitHub 上有、本机没有」）。 */
export function createSeparate(issue: Of<"name-match">) {
  return guarded(`name-match:${issue.id}`, async () => {
    const gh = await sameAccount();
    if (!gh) return;
    const meta = metaOf(issue.id);
    const local = await localText(issue.id);
    if (!meta || local === null) return dropIssue(issue);
    const problem = pushProblem(local, null, gh.login);
    if (problem) return say(() => t(`「${issue.name}」没有上传：${phrase(problem)}`, `Could not upload “${issue.name}”: ${phrase(problem)}`), "warn");
    await linkTo(issue.id, await gh.api.createGist(gistNameOf(meta), documentName(meta), local), local, gh.login);
    dropIssue(issue);
    noteUploaded(1);
    say(() => t(`已把「${issue.name}」另建成一个新的 Gist。`, `Uploaded “${issue.name}” as a new Gist.`), "info");
  });
}

type Session = Awaited<ReturnType<typeof github>>;

/** 上传一篇还没连过的：建成私密 Gist 并连上。没上传的原因（不在了、空的、别处刚连上）作为字返回；上传了是 null。 */
async function uploadOne({ api, login }: Session, id: string): Promise<Phrase | null> {
  const meta = metaOf(id);
  const local = await localText(id);
  if (!meta || local === null) return () => t("本机已经没有了", "The local copy is gone");
  const record = await syncRecordOf(id);
  if (record?.link?.login === login) return () => t("已经连着 GitHub 上的一份（别处刚同步过），没有再建", "Already linked to a GitHub copy from another sync. No new Gist was created");
  const problem = pushProblem(local, null, login);
  if (problem) return problem;
  await linkTo(id, await api.createGist(gistNameOf(meta), documentName(meta), local), local, login);
  return null;
}

/**
 * 确认上传：`chosen` 里的建成私密 Gist，其余的标成「不同步这篇」（打开那篇在同步面板里能改回）。
 * 中途出错时那件事留着，已经传上去的已经连上，再点一次不会重复建。
 */
export function uploadChosen(issue: Of<"upload">, chosen: ReadonlySet<string>) {
  return guarded("upload", async () => {
    const gh = await sameAccount();
    if (!gh) return;
    let uploaded = 0;
    const skipped: Phrase[] = [];
    for (const doc of issue.docs) {
      if (!chosen.has(doc.id)) {
        await setExcluded(doc.id, true);
        continue;
      }
      const why = await uploadOne(gh, doc.id);
      if (why) skipped.push(() => t(`「${doc.name}」${phrase(why)}`, `“${doc.name}”: ${phrase(why)}`));
      else uploaded++;
    }
    dropIssue(issue);
    const done = uploaded;
    const excluded = issue.docs.filter((d) => !chosen.has(d.id)).length;
    noteUploaded(done, excluded);
    const parts: Phrase[] = [done > 0 ? () => t(`已上传 ${done} 篇（私密 Gist）。`, `Uploaded ${done} ${done === 1 ? "document" : "documents"} as secret Gists.`) : "", excluded > 0 ? () => t(`没勾的 ${excluded} 篇以后不同步，打开那篇在同步面板里点「恢复同步」可以改回。`, `Excluded ${excluded} ${excluded === 1 ? "document" : "documents"} from sync. Open a document and choose “Resume syncing” in its sync panel to change this.`) : ""];
    if (skipped.length > 0) parts.push(() => t(`没有上传：${skipped.map(phrase).join("；")}。`, `Not uploaded: ${skipped.map(phrase).join("; ")}.`));
    say(() => parts.map(phrase).filter(Boolean).join(t("", " ")), skipped.length > 0 ? "warn" : "info");
  });
}

/** 「先不上传」：这次一篇都不建、也不标成不同步，下次同步还会问。 */
export function holdUploads(issue: Of<"upload">) {
  dropIssue(issue);
  say(() => t("这次没有上传。下次同步还会问。", "Nothing was uploaded. Pairdown will ask again the next time you sync."), "info");
}

/** 全部拉到本机：一篇一篇来，出错的那篇留在列表里。 */
export async function pullAllRemote(list: Of<"remote-only">[]) {
  for (const issue of list) await pullRemote(issue);
}

/** 这篇同步不同步（「不同步这篇」开关）。 */
export async function setExcluded(id: string, excluded: boolean) {
  const record = await syncRecordOf(id);
  await putSyncRecord(id, { ...record, excluded });
}
