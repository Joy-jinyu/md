# md Execution Rules

> These rules apply to every development session.
> Leave enough context to resume after any interruption, and provide evidence for every completion claim.
> This document covers project-specific rules. The user's global guides at `~/.claude/CLAUDE.md` and `~/.claude/rules/` are the single source for general rules on evidence, Git, tools, and verification levels.

## 0. Rule Levels and Global Rules

The levels in the project rule tables correspond to the global BCP 14 terms as follows.

| Level | BCP 14 term | Meaning |
|-------|-------------|---------|
| L0 | MUST, mandatory | Stop and hold delivery if the rule is violated |
| L1 | MUST, with a check | Pass the check before committing. Ask the user before making an exception |
| L2 | SHOULD | Follow by default and explain any deviation when it occurs |
| L3 | MAY | Optional guidance |

The following project rules take precedence over the global rules where they differ.

- **Use `main` as the default branch.** Use `origin/main` as the comparison baseline. The global guidance lists `origin/master`.
- **Obtain separate authorization for commits and pushes.** The global guidance calls for pushing immediately after a commit and also requires authorization for each external action. Follow the authorization rule in this project. An instruction to commit and push authorizes both actions in sequence.
- **Check commit scopes manually.** This project has no root `package.json` or commitlint configuration. Use `.claude/rules/git-workflow.md` to check the scope.
- **Run the Make targets directly.** `make check`, `make test`, and `make build-*` are scoped commands for this small project and require neither `ALLOW_HEAVY` nor RTK.
- **Use this project's theme and icon conventions.** The global requirements for `@pkgs/theme`, `@pkgs/us-icons`, and prism-ui apply to company repositories. Use `theme.json` for colors and follow section 2.2 of `CONTRIBUTING.md` for icons.

## 1. Test Cadence

The test cadence in the user's global rules takes precedence over TDD.

| Phase | Action |
|-------|--------|
| Implementation | Finish the batch of changes before running its checks |
| Full run | Run `make check && make test` |
| Fixes | Fix one screen or module at a time. Run its test with `nsh test tests/<file>.test.tsx` and pass it before moving on |
| Wrap-up | Repeat the full run after all fixes |
| Verify test effectiveness | Temporarily break the implementation, confirm the corresponding test fails, and restore the implementation |

- Place all tests in `tests/`. Use `.test.ts` for pure functions and `.test.tsx` for tests that open the app.
- Assert only user-observable behavior, such as on-screen text (`app.texts()`), controls a user can press (`app.press("名称")`), and stored Markdown (`app.storage()`). Keep internal functions, signal values, and call counts outside the assertions.
- Put Markdown round-trip tests in `tests/doc-roundtrip.test.ts` and follow the fidelity rules in `CLAUDE.md`. Section 4.9 of the implementation plan is the single source for required assertions and fixtures. Unchanged text must round-trip byte for byte. Editing one block must preserve the bytes of every other block. Reading and writing a rewritten result again must leave it unchanged. Rewriting must preserve meaning. After deleting, moving, inserting, splitting, or merging blocks, parsing the exported text must reproduce the editor content. Use the project's conversion path for these tests. The built-in `format: "markdown"` and `getMarkdown()` paths lose content, as verified on 2026-11-24.

## 2. Progress Documentation

| Document | Location | When to update |
|----------|----------|----------------|
| Phase checklist | Current Phase in `CLAUDE.md` | Check off a phase after all acceptance criteria pass |
| Implementation plan | `~/Documents/learning/html/md/<topic>-plan.html`, with an entry in the index table in `~/Documents/learning/html/README.md` | Write it before starting and record the outcome when done |

- Start by following the protocol in section 7.
- To wrap up, run the checks for the batch, update the implementation plan, commit with the user's authorization, and record the next step.

## 3. Verification

| Claim | Required evidence | Insufficient evidence |
|-------|-------------------|-----------------------|
| Type checking passed | `make check` reports no errors | The editor shows no errors |
| Tests passed | `make test` reports zero failures | The tests should pass |
| The web app works | Screenshots or recorded steps from using `make dev-web` in a browser | The same change works on macOS |
| The macOS app works | Screenshots or recorded steps from using the `make dev` window | The same change works on the web |
| Packaging succeeded | `make build-web` or `make build-mac` exits with code 0 and produces `dist/web/Pairdown/index.html` or `dist/macos/Pairdown.app`, respectively | Type checking passed |
| A bug is fixed | The original reproduction steps no longer trigger it, and a corresponding test is in place | The code changed |
| Sync works | Edit on both clients and sync. Verify that a conflict appears and the chosen version is kept | The API returned HTTP 200 |

## 4. Git

- Make one logical change per commit and use `git add` only for files that belong to it.
- Obtain user authorization for each external action, including committing, pushing, creating a GitHub repository, enabling Pages, and deploying the Worker. See section 0 for combined commit and push authorization.
- Before committing, pass `make check && make test` and inspect `git diff --cached` for tokens, secrets, `.nsh/`, and `dist/`. Keep all of them out of the commit.

## 5. Architecture Boundaries

Dependencies must follow the directions shown below.

```text
features/ ──▶ ui/
    │
    ├──▶ store/ ──▶ doc/
    │      └──────▶ gateway/src/protocol.ts
    ├──▶ sync/  ──▶ doc/
    │      └──────▶ store/ (access login and sync records only through store/sync-store.ts)
    └──▶ platform/ ──▶ store/ (interfaces and types), doc/,
                       gateway/src/protocol.ts (the assets/ directory name for the macOS library)
```

`gateway/src/protocol.ts` defines the protocol shared by the app and the local gateway. It contains only types and constants and has no imports. Only `store/` and `platform/macos/` import it directly. Code in `features/` uses protocol constants through the re-exports in `store/` (`image-file.ts` and `gateway-store.ts`). **Commit changes to `gateway/` and `src/` together when updating the protocol** so the app and gateway use compatible versions.

Keep `doc/` limited to pure functions with no nsh imports. These include extracting titles and excerpts, comparing conflicting versions, converting parse results to editor JSON, writing Markdown from editor JSON, and aligning old and new blocks. Use the built-in `TextView.parse` for Markdown parsing and slicing the source text. The user decided on 2026-11-24 to avoid npm dependencies such as `markdown-it` for parsing. Keep the file that calls `TextView.parse` in the editor directory under `features/`. See section 4.1 of the implementation plan.

| Violation | Check (expected to return no matches) | Fix |
|-----------|---------------------------------------|-----|
| An nsh import in `doc/` | `rg -n "from ['\"]nsh" src/doc` | Move the code out of `doc/` |
| A platform branch outside `platform/index.ts` | `rg -n '\bplatform\.\w+' src -g '!src/platform/index.ts'` | Use the interface exported by `platform/` |
| `Storage` use outside `store/` | `rg -n '\bStorage\b' src -g '!src/store/**'` | Use the `store/` interface |
| A direct gateway protocol import outside `store/` and `platform/` | `rg -n 'gateway/src' src -g '!src/store/**' -g '!src/platform/**'` | Use a re-export from `store/` |
| Token access outside `sync/` and `store/` | `rg -n -i -e 'access_?token' -e authorization -e bearer src -g '!src/sync/**' -g '!src/store/**'` | Move the code into `sync/` |

> Use multiple `-e` flags for alternatives in these checks. A `|` inside a Markdown table requires escaping and can become a literal pipe when copied.

## 6. File Changes

- Read a file before editing it. Before deleting a symbol or file, run a targeted `rg` search and confirm it has zero references.
- `.nsh/` contains generated nsh types and caches. Keep it out of manual edits and commits. `nsh check` regenerates it after removal.
- If `web.host` (`host.js`) is added, headless tests will load it and fail. Follow the reference app by creating `tests/nsh.json` without `web.host` and copying the root `nsh.json` values for `theme`, `tailwind`, and `capabilities`. Create `tests/App.tsx` with `import "../App"` and switch tests to `open("./App.tsx")`. Change the Makefile's `test` target to `nsh test tests` because nsh requires `App.tsx` in the specified directory. Keep those three settings in sync when the root configuration changes.

## 7. Resume Protocol

Restore context in this order. Read `CLAUDE.md`, `EXECUTION.md`, and the latest implementation plan, then run `git status`, `git log -5`, `make check`, and `make test`.

Use this template for the first sentence.

```text
Last session stopped at <phase / plan step>. Working tree <clean / list of changes>. Checks <check and test results>. Next <action>.
```

## 8. Quality Gates

| Scope | Check | Level |
|-------|-------|-------|
| Every handoff | A subagent who did not write the changes reviewed the diff against the expected behavior | L0 |
| Every task | Relevant tests pass | L1 |
| Every task | The changed screens were exercised in both hosts | L0 |
| Every phase | `make check` reports no errors | L1 |
| Every phase | All `make test` tests pass | L1 |
| Every phase | `make build-web` and `make build-mac` succeed | L1 |
| Every phase | Current Phase in `CLAUDE.md` is up to date | L2 |
| Schema or editor import/export changes | Round-trip tests pass | L0 |
| Sync changes | The conflict scenario has been verified manually | L0 |

## 9. Exception Handling

| Situation | Action |
|-----------|--------|
| A test fails | First determine whether the implementation or test is wrong. Keep the test aligned with the expected behavior |
| nsh behavior differs from its type declarations | Check `.nsh/types` and create a minimal reproduction before deciding whether to work around it or file an issue with longbridge/nsh. Add a one-line comment with the reason and version for any workaround |
| Documents conflict | Follow the precedence in `CLAUDE.md` and tell the user about the conflict |
| The same issue remains after three fixes | Stop, list the attempted fixes and current hypotheses, and hand it back to the user |

## 10. Quick Reference

| Task | Steps |
|------|-------|
| Start a feature | Write a plan, obtain user confirmation, update `DESIGN.md`, implement, and verify |
| Resume work | Follow the resume protocol in section 7 |
| Commit | Run `make check && make test`, stage only the files for this change, obtain user authorization, and commit |
| Report completion | Provide the applicable evidence from section 3 |
