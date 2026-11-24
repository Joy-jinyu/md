# 验证

证据表和质量门禁的唯一来源是 `EXECUTION.md` 第 3、8 节。这里只列每次交付前要跑的命令：

| 规则 | 级别 | 检测方式 |
|------|------|---------|
| `make check` 无错误 | L1 | 命令输出 |
| `make test` 全部通过 | L1 | 命令输出 |
| 改到的屏幕在 `make dev-web`（浏览器）和 `make dev`（macOS 窗口）里都真实操作过 | L0 | 截图或步骤记录 |
| 改了 `doc/` 或编辑器 schema：往返测试通过 | L0 | `nsh test tests/doc-roundtrip.test.ts` |
| 阶段收尾：`make build-web` 和 `make build-mac` 成功 | L1 | 退出码 + 产物路径 |
