# md 执行铁律

> 所有开发 session 必须遵守的规则。
> 目标：任何 session 中断都能无损接上，任何「做完了」都有证据。
> 这里只写本项目特有的部分；通用规则（证据优先、Git、工具、验证分层）的唯一来源在用户全局 `~/.claude/CLAUDE.md` 和 `~/.claude/rules/`。

## 0. 级别与全局规则

本项目规则表里的级别和全局 BCP 14 用词对应如下：

| 级别 | 对应 | 含义 |
|------|------|------|
| L0 | MUST，不可协商 | 违反即停，不交付 |
| L1 | MUST，有检测命令 | 提交前必须过；要豁免先问用户 |
| L2 | SHOULD | 默认这样做，偏离要当场说明理由 |
| L3 | MAY | 建议 |

和全局规则不一致的地方（项目优先，这里明说）：

- **默认分支是 `main`**：比较基线用 `origin/main`，代替全局写的 `origin/master`。
- **commit 和 push 分开授权**：全局里「commit 后不停顿直接 push」和「每个外部操作单独授权」互相矛盾，本项目取后者；用户一次说「提交并推送」时可以连做。
- **没有 commitlint**：本项目没有 package.json，commit scope 按 `.claude/rules/git-workflow.md` 人工核对。
- **不用 `ALLOW_HEAVY` / RTK**：项目小，`make check`、`make test`、`make build-*` 都算 scoped 命令。
- **`@pkgs/theme`、`@pkgs/us-icons`、prism-ui 的全局规则针对公司仓库，本项目不适用**：颜色用 `theme.json`，图标做法见 `CONTRIBUTING.md` 2.2。

## 1. 测试节奏

用户全局规则「测试节奏」优先于 TDD：

| 阶段 | 做什么 |
|------|--------|
| 写代码 | 一批改动整体写完，写的过程中不边写边跑 |
| 全量跑 | `make check && make test` |
| 修问题 | 按屏幕（或模块）逐个修，修完一个只跑它的测试（`nsh test tests/<file>.test.tsx`），过了再修下一个 |
| 收尾 | 全部修完再跑一次全量 |
| 证明测试有效 | 事后变异检查：故意改坏实现，确认对应测试变红，再改回来 |

测试写法：

- 所有测试放在 `tests/`，`.test.ts`（纯函数）和 `.test.tsx`（打开应用）都可以。
- 只断言用户看得到的结果：屏幕上的文字（`app.texts()`）、按得到的控件（`app.press("名称")`）、存储里的 Markdown（`app.storage()`）。不断言内部函数、signal 的值、调用次数。
- Markdown 往返测试放 `tests/doc-roundtrip.test.ts`，按 `CLAUDE.md` 的保真约定断言，断言项和样例要求的唯一定义在实施计划 4.9 节（不改直接写出逐字节相同；改一块其余块逐字节相同；重写结果再读再写不变；重写不丢语义；删 / 移 / 插 / 拆 / 并之后写出的文本重新解析等于编辑器内容）。不能只拿 nsh 内置的 `format: "markdown"` 读入 + `getMarkdown()` 写出来对比——内置读写本身会丢内容（2026-11-24 实测）。

## 2. 进度文档

| 文档 | 位置 | 何时更新 |
|------|------|---------|
| 阶段清单 | `CLAUDE.md`「当前阶段」 | 一个阶段的验收全过之后打勾 |
| 实施计划 | `~/Documents/learning/html/md/<主题>-plan.html`，并在 `~/Documents/learning/html/README.md` 目录表补一行 | 开工前写，做完后标注完成情况 |

- 开始：按第 7 节 Resume 协议。
- 结束：跑本批验证 → 更新实施计划 → （用户授权后）commit → 写下下一步。

## 3. 验证

| 声称 | 必须给的证据 | 不算数的说法 |
|------|-------------|-------------|
| 「类型检查过了」 | `make check` 输出无错误 | 「编辑器里没报红」 |
| 「测试过了」 | `make test` 输出 0 失败 | 「应该能过」 |
| 「Web 端能用」 | `make dev-web` 浏览器里真实操作的截图或步骤记录 | 「macOS 上好了，Web 一样」 |
| 「macOS 能用」 | `make dev` 窗口里真实操作的截图或步骤记录 | 「Web 上好了」 |
| 「打包成功」 | `make build-web` / `make build-mac` 退出码 0，`dist/web/Pairdown/index.html` 或 `dist/macos/Pairdown.app` 存在 | 「check 过了」 |
| 「bug 修了」 | 原始复现步骤不再出现 + 对应测试 | 「改了代码」 |
| 「同步没问题」 | 两端各改一处后同步，冲突提示出现，选哪边就留哪边 | 「接口返回 200」 |

## 4. Git

- 一次提交一个逻辑改动；只 `git add` 本次改动的文件。
- commit、push、建 GitHub 仓库、开 Pages、部署 Worker 都是对外操作，每一步单独获得用户授权（见第 0 节）。
- 提交前：`make check && make test` 通过；`git diff --cached` 里没有 token、secret、`.nsh/`、`dist/`。

## 5. 架构守护

依赖方向只能向下：

```text
features/ ──▶ ui/
    │
    ├──▶ store/ ──▶ doc/
    ├──▶ sync/  ──▶ doc/
    └──▶ platform/
```

`doc/` 只放不引 nsh 的纯函数（标题、摘要提取，冲突比较，解析结果 → 编辑器 JSON，编辑器 JSON → Markdown 写出，新旧块对齐）。Markdown 的解析和原文切片要调 nsh 自带的 `TextView.parse`（用户 2026-11-24 定：不引 `markdown-it` 等 npm 依赖），所以这一个文件放 `features/` 的编辑页目录下，不放 `doc/`；细节见实施计划 4.1 节。

| 违规 | 检测命令（应为空） | 处理 |
|------|-------------------|------|
| `doc/` 引用 nsh | `rg -n "from ['\"]nsh" src/doc` | 移出 `doc/` |
| 平台分支出现在 `platform/index.ts` 以外 | `rg -n '\bplatform\.\w+' src -g '!src/platform/index.ts'` | 改成调 `platform/` 导出的接口 |
| `store/` 以外用 `Storage` | `rg -n '\bStorage\b' src -g '!src/store/**'` | 改成调 `store/` |
| `sync/`、`store/` 以外碰 token | `rg -n -i -e 'access_?token' -e authorization -e bearer src -g '!src/sync/**' -g '!src/store/**'` | 收回到 `sync/` |

> 检测命令里不用 `|`（在 Markdown 表格里要转义，照抄会变成字面竖线），多个模式用 `-e`。

## 6. 文件变更

- 改文件前先读；删符号或文件前，用 `rg` 精确搜索确认引用为零。
- `.nsh/` 是 nsh 生成的类型和缓存，不手改、不提交；删掉后 `nsh check` 会重新生成。
- 加 `web.host`（`host.js`）时：无头测试会加载它而出错。届时照参考应用的做法，新建 `tests/nsh.json`（不带 `web.host`，`theme`、`tailwind`、`capabilities` 三项和根目录 `nsh.json` 一致）和 `tests/App.tsx`（`import "../App"`），测试里改成 `open("./App.tsx")`，Makefile 的 `test` 改成 `nsh test tests`（给目录时该目录要有 `App.tsx`）。之后改根目录这三项要同步改 `tests/nsh.json`。

## 7. Resume 协议

上下文恢复顺序：`CLAUDE.md` → `EXECUTION.md` → 最新实施计划 → `git status` / `git log -5` → `make check` → `make test`。

第一句话模板：

```text
上次停在：<阶段 / 计划里的哪一步>；工作区：<干净 / 有哪些改动>；检查：<check 和 test 结果>；下一步：<要做的事>
```

## 8. 质量门禁

| 范围 | 检查 | 级别 |
|------|------|------|
| 每次交回 | 没写这批代码的子代理按预期行为审过 diff | L0 |
| 每个任务 | 相关测试通过 | L1 |
| 每个任务 | 改到的屏幕在两个 host 里真实操作过 | L0 |
| 每个阶段 | `make check` 无错误 | L1 |
| 每个阶段 | `make test` 全部通过 | L1 |
| 每个阶段 | `make build-web` 和 `make build-mac` 成功 | L1 |
| 每个阶段 | `CLAUDE.md`「当前阶段」已更新 | L2 |
| 改了 schema 或编辑器读写 | 往返测试通过 | L0 |
| 改了同步 | 冲突场景手动验证过 | L0 |

## 9. 异常处理

| 情况 | 做法 |
|------|------|
| 测试失败 | 先确认是实现错还是测试错，不改测试去迁就实现 |
| nsh 行为和类型声明不符 | 先在 `.nsh/types` 和最小复现里确认，再决定绕过还是给 longbridge/nsh 提 issue；绕过的地方写一行注释说明原因和版本 |
| 文档之间冲突 | 按 `CLAUDE.md` 的冲突优先级；冲突本身告诉用户 |
| 同一个问题修了 3 次还不对 | 停下，列出试过的方案和当前假设，交还给用户 |

## 10. 速查

| 要做的事 | 步骤 |
|---------|------|
| 开始新功能 | 写计划 → 用户确认 → 改 DESIGN.md → 实现 → 验证 |
| 接着上次做 | 第 7 节 Resume 协议 |
| 提交 | `make check && make test` → 只 add 本次文件 → 用户授权 → commit |
| 说「做完了」 | 第 3 节的证据逐条给出 |
