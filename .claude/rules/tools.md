# 工具

通用工具优先级（rg / fd / sd / sg / jq）的唯一来源是用户全局 `~/.claude/rules/high-io-tools.md`；本项目不用 `ALLOW_HEAVY` / RTK（见 `EXECUTION.md` 第 0 节）。本项目补充：

| 规则 | 级别 | 检测方式 |
|------|------|---------|
| nsh 版本固定 v0.6.0：本机 `nsh --version` 和 CI 的 `NSH_VERSION` 一致，升级时两边一起改 | L1 | `nsh --version` |
| 查 nsh API 用 `rg -n '<名字>' .nsh/types/`，不要去猜；全局组件（如 `Each`）在 `.nsh/types/nsh/globals.d.ts` | L2 | 人工 |
| 打包产物多一层应用名：`dist/web/Pairdown/`、`dist/macos/Pairdown.app`，CI 上传 Pages 用这个路径 | L2 | `make build-web` 后看目录 |
| 浏览器验收用 `make dev-web` 打开的真实页面，截图可以用 opencli / playwright | L2 | 人工 |
