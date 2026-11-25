# Tools

The user's global `~/.claude/rules/high-io-tools.md` is the authoritative source for general tool preferences (rg, fd, sd, sg, and jq). This project skips `ALLOW_HEAVY` and RTK, as described in section 0 of `EXECUTION.md`. The rules below also apply to this repository.

| Rule | Level | How to check |
|------|-------|--------------|
| Pin nsh to v0.7.0, upgraded from 0.6.0 on 2026-11-25. Local `nsh --version` must match `NSH_VERSION` in CI. Update both when upgrading. | L1 | `nsh --version` |
| Run `make test` one file at a time with `--jobs 1`. Since nsh 0.7.0, `nsh test` runs in parallel by default based on core count, which can cause timing-sensitive tests to time out under load. Running a single file avoids that issue. | L2 | The `test` target in `Makefile` |
| Look up nsh APIs with `rg -n '<name>' .nsh/types/`. Global components such as `Each` are declared in `.nsh/types/nsh/globals.d.ts`. | L2 | Manual |
| Packaged outputs include the app name as a path component, as in `dist/web/Pairdown/` and `dist/macos/Pairdown.app`. Use the web output path for CI uploads to Pages. | L2 | Inspect the output directory after `make build-web` |
| For browser acceptance checks, use the live page served by `make dev-web`. Use opencli or Playwright for screenshots if needed. | L2 | Manual |
