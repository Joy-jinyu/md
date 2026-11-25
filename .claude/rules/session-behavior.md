# Session behavior

<!-- [default] team.ai_ratio = 1.0 (one person developing with AI), without separate confirmation. -->

| Rule | Level | How to check |
|------|-------|--------------|
| At the start of the session, restore context as described in section 7 of `EXECUTION.md`. State where work stopped and what comes next in the first sentence. | L2 | Manual |
| Prepare an implementation plan under `~/Documents/learning/html/md/` before starting a feature. Wait for the user to confirm it before writing code. | L1 | Manual |
| At the end of the session, update the implementation plan with the next step. | L2 | Manual |
| Check `.nsh/types/` for signatures before using nsh APIs. | L1 | Review |
| Record nsh pitfalls, such as differences between behavior and type declarations or between platforms, in the plan's “已知问题” section. | L3 | Manual |
