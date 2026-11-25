# Verification

Sections 3 and 8 of `EXECUTION.md` are the authoritative source for required evidence and quality gates. Run the checks below before delivery.

| Rule | Level | How to check |
|------|-------|--------------|
| `make check` reports no errors. | L1 | Command output |
| All tests in `make test` pass. | L1 | Command output |
| Exercise each changed screen in both `make dev-web` (browser) and `make dev` (macOS window). | L0 | Screenshots or a record of the steps |
| If `doc/` or the editor schema changes, round-trip tests pass. | L0 | `nsh test tests/doc-roundtrip.test.ts` |
| At the end of a phase, `make build-web` and `make build-mac` succeed. | L1 | Exit codes and artifact paths |
