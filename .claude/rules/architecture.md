# Architecture boundaries

Section 5 of `EXECUTION.md` defines dependency direction, layer responsibilities, and the commands for detecting violations. The rules below cover Markdown persistence and decisions that require user confirmation.

| Rule | Level | How to check |
|------|-------|--------------|
| Use only Markdown strings for storage, sync, and export. Keep ProseMirror JSON in memory. | L0 | Review and round-trip tests |
| Confirm the approach with the user before adding a top-level directory, changing the sync target from Gists to a repository, or changing the sign-in method. | L1 | Manual |
