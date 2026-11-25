# Git 工作流

通用规则的唯一来源是用户全局 `~/.claude/rules/git-workflow.md` 和 `~/.claude/CLAUDE.md` 的 Git 一节；和全局不一致的地方见 `EXECUTION.md` 第 0 节。本项目补充：

| 规则 | 级别 | 检测方式 |
|------|------|---------|
| 默认分支 `main`，基线用 `origin/main`；功能在 `feat/<主题>` 分支上做 | L2 | `git branch --show-current` |
| 提交格式 `<type>(<scope>): <描述>`；type 取 feat / fix / refactor / docs / test / chore / perf / ci | L1 | 人工（本项目没有 commitlint） |
| scope 取 `src/` 下的目录名或仓库顶层目录名：doc / store / sync / platform / features / ui / tests / gateway / worker / ci；改 harness 文档用 harness | L1 | 人工 |
| 不提交 `.nsh/`、`dist/`、`worker/.dev.vars` | L0 | `.gitignore` + `git diff --cached --name-only` |
| 建 GitHub 仓库、开 Pages、部署 Worker 都单独找用户授权 | L0 | 人工 |
