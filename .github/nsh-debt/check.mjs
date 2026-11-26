/**
 * 逐条检查 NSH_DEBT.md 里的 nsh 债务是否还在：`node .github/nsh-debt/check.mjs`（仓库根目录跑，要装好 nsh）。
 * 每条一个探针，结果是 still（问题还在）、changed（探针看到变化，可能修好了，去核实并更新 NSH_DEBT.md）、
 * error（探针自己跑不起来）、manual（没有自动探针）。有 changed 或 error 时退出码为 1，定时 CI 因此变红。
 * 环境变量：NSH_CHANNEL（release / nightly，决定 ND-10 拿哪个 tag 比）、GITHUB_TOKEN（可选，查 GitHub 时用，免得限流）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HERE = join(ROOT, ".github/nsh-debt");
const UPSTREAM = "longbridge/nsh";
/** 一条 nsh 命令最多等多久：探针都是几秒的事，卡住就算出错。 */
const COMMAND_MS = 180_000;

/** 跑一条 nsh 命令，返回退出码和合并后的输出。 */
function nsh(args, cwd = ROOT) {
  const r = spawnSync("nsh", args, { cwd, encoding: "utf8", timeout: COMMAND_MS });
  if (r.error) throw r.error;
  return { code: r.status, output: `${r.stdout}\n${r.stderr}` };
}

const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));

/** nsh check 写出的类型声明（随装的 nsh 版本变）；test.d.ts 不算，它的注释里拿 Keychain 举例。 */
function typesText(sub) {
  const dir = join(ROOT, ".nsh/types", sub);
  return filesUnder(dir)
    .filter((f) => f.endsWith(".d.ts") && !f.endsWith("test.d.ts"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

async function github(path) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "pairdown-nsh-debt" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${path} 回了 ${res.status}`);
  return res.json();
}

// 每种探针：返回 { still: boolean, detail: string }

/** 类型声明里出现了匹配 `pattern` 的接口 = 有了（changed）。 */
const typesLack = (sub, pattern, what) => async () => {
  const found = pattern.exec(typesText(sub));
  return found ? { still: false, detail: `类型声明里出现了：${found[0].trim()}` } : { still: true, detail: `类型声明里还没有${what}` };
};

/** 探针用例通过 = 问题还在。 */
const testPasses = (file) => async () => {
  const r = nsh(["test", file]);
  const summary = r.output.match(/\d+ tests?: \d+ passed, \d+ failed/)?.[0] ?? `退出码 ${r.code}`;
  return { still: r.code === 0, detail: summary };
};

/** 输出里还有 `pattern` = 问题还在。`dir`：在哪个应用目录里跑（先 nsh check 生成它的类型和 tsconfig）。 */
const outputHas = (args, pattern, dir = ROOT) => async () => {
  if (dir !== ROOT) nsh(["check"], dir);
  const r = nsh(args, dir);
  return pattern.test(r.output) ? { still: true, detail: `输出里还有：${pattern.source}` } : { still: false, detail: `输出里没有 ${pattern.source} 了（退出码 ${r.code}）` };
};

/** 上游 issue 还开着 = 问题还在。 */
const issueOpen = (number) => async () => {
  const issue = await github(`repos/${UPSTREAM}/issues/${number}`);
  return { still: issue.state === "open", detail: `${UPSTREAM}#${number} ${issue.state}` };
};

/** 上游 PR 的合并提交还没进这个渠道的版本 = 问题还在（修了但没发版）。 */
const fixNotShipped = (pr) => async () => {
  const pull = await github(`repos/${UPSTREAM}/pulls/${pr}`);
  if (!pull.merged_at) return { still: true, detail: `${UPSTREAM}#${pr} 还没合并` };
  const tag = process.env.NSH_CHANNEL === "nightly" ? "nightly" : (await github(`repos/${UPSTREAM}/releases/latest`)).tag_name;
  // 以 tag 为基、比合并提交：behind / identical 说明合并提交已经在 tag 里
  const cmp = await github(`repos/${UPSTREAM}/compare/${tag}...${pull.merge_commit_sha}`);
  const shipped = cmp.status === "behind" || cmp.status === "identical";
  return { still: !shipped, detail: `${UPSTREAM}#${pr} ${shipped ? "已在" : "还不在"} ${tag} 里` };
};

const manual = () => async () => ({ manual: true, detail: "没有自动探针，按 NSH_DEBT.md 里写的办法人工复查" });

/** 每条债务的探针，键是 NSH_DEBT.md 里的编号；两边必须一一对应（脚本开头会核对）。 */
const PROBES = {
  "ND-01": testPasses(".github/nsh-debt/probes/markdown-roundtrip.test.ts"),
  "ND-02": outputHas(["test", ".github/nsh-debt/probes/js-budget.test.ts"], /exceeded its budget of 2000 ms/),
  "ND-03": typesLack("nsh", /export (declare )?(const|function|class|interface) \w*(Keychain|SecureStor|Credential)\w*/i, "钥匙串 / 安全存储接口"),
  "ND-04": typesLack("nsh", /\b(saveFile|saveFiles|pickSave\w*|showSaveDialog|saveDialog)\s*\(/, "保存对话框"),
  "ND-05": typesLack("fs", /\bwatch\s*\(/, "文件监听（watch）"),
  "ND-06": typesLack("nsh", /^\s*(appearance|colorScheme|titleBarAppearance|titleBarColor)\??:/m, "窗口外观选项"),
  "ND-07": outputHas(["test", "App.test.tsx"], /capabilities\.clipboard must be a boolean/, join(HERE, "clipboard-object")),
  "ND-08": testPasses(".github/nsh-debt/probes/img-align.test.ts"),
  "ND-09": testPasses(".github/nsh-debt/probes/intl-segmenter.test.ts"),
  "ND-10": fixNotShipped(3281),
  "ND-11": issueOpen(3245),
  "ND-12": issueOpen(3284),
  "ND-13": issueOpen(3246),
  "ND-14": manual(),
  "ND-15": manual(),
  "ND-16": manual(),
  "ND-17": manual(),
  "ND-18": manual(),
  "ND-19": manual(),
  "ND-20": manual(),
  "ND-21": manual(),
};

/** NSH_DEBT.md 里的每条：`### ND-01 标题`。 */
function ledger() {
  const text = readFileSync(join(ROOT, "NSH_DEBT.md"), "utf8");
  return [...text.matchAll(/^### (ND-\d+) (.+)$/gm)].map((m) => ({ id: m[1], title: m[2].trim() }));
}

async function run(entry) {
  const probe = PROBES[entry.id];
  if (!probe) return { ...entry, status: "error", detail: "check.mjs 里没有这一条的探针" };
  try {
    const r = await probe();
    return { ...entry, status: r.manual ? "manual" : r.still ? "still" : "changed", detail: r.detail };
  } catch (e) {
    return { ...entry, status: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  const entries = ledger();
  const orphans = Object.keys(PROBES).filter((id) => !entries.some((e) => e.id === id));
  // 先生成和装的 nsh 一致的类型声明，类型探针读它
  nsh(["check"]);
  const version = execFileSync("nsh", ["--version"], { encoding: "utf8" }).trim();
  const results = [];
  for (const entry of entries) results.push(await run(entry));
  for (const id of orphans) results.push({ id, title: "(NSH_DEBT.md 里没有这一条)", status: "error", detail: "探针没有对应的债务条目" });

  const icon = { still: "🔴 still", changed: "🟢 changed", error: "⚠️ error", manual: "⚪ manual" };
  const lines = [`## nsh debt check — ${version} (${process.env.NSH_CHANNEL ?? "local"})`, "", "| ID | Debt | Status | Detail |", "| --- | --- | --- | --- |"];
  for (const r of results) lines.push(`| ${r.id} | ${r.title} | ${icon[r.status]} | ${r.detail.replace(/\|/g, "\\|")} |`);
  const report = lines.join("\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

  const attention = results.filter((r) => r.status === "changed" || r.status === "error");
  if (attention.length > 0) {
    console.error(`\n${attention.length} 条要处理：${attention.map((r) => r.id).join("、")}。changed 的去核实是否真的修好并更新 NSH_DEBT.md；error 的修探针`);
    process.exit(1);
  }
}

await main();
