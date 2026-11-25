# Git workflow

The user's global `~/.claude/rules/git-workflow.md` and the Git section in `~/.claude/CLAUDE.md` are the authoritative sources for general Git rules. Section 0 of `EXECUTION.md` lists project exceptions. The following rules also apply to this repository.

| Rule | Level | How to check |
|------|-------|--------------|
| The default branch is `main`. Use `origin/main` as the baseline and develop features on `feat/<topic>` branches. | L2 | `git branch --show-current` |
| Format commits as `<type>(<scope>): <description>`. Use feat, fix, refactor, docs, test, chore, perf, or ci as the type. Write commit subjects and bodies in English only, per the user's decision on 2026-11-25. | L1 | Manual check because the project has no commitlint. Confirm that `git log -1 --format=%B` contains no Chinese. |
| Use a directory name from `src/` or the repository root as the scope. Valid scopes are doc, store, sync, platform, features, ui, tests, gateway, worker, and ci. Use harness for changes to harness documentation. | L1 | Manual |
| Keep `.nsh/`, `dist/`, and `worker/.dev.vars` out of commits. | L0 | `.gitignore` and `git diff --cached --name-only` |
| Get separate user authorization before creating a GitHub repository, enabling Pages, or deploying a Worker. | L0 | Manual |
