# Pairdown（仓库名 md）— AI 开发上下文

## 项目概述

Pairdown：用 nsh（v0.6.0，TSX）写的所见即所得 Markdown 编辑器（品牌名 2026-11-24 定，仓库和应用 id 仍叫 md / `site.pairwise.md`），Web 和 macOS 共用一份代码。文档只以 Markdown 文本保存在本地，登录 GitHub 后可以同步。AI agent 按本文件和 `EXECUTION.md` 设计、实现、验证；提交和对外操作要用户授权。

**冲突优先级**：`EXECUTION.md`（执行铁律）> `DESIGN.md` / 本文件 > 「当前阶段」里还没做的设想

## 技术架构

```text
界面      nsh TSX（nsh、nsh/base），RichEditor 所见即所得；样式只用 theme.json 的 token
文档模型  编辑中：ProseMirror JSON（RichEditor 会话）
          存储 / 同步 / 导出：只用 Markdown 字符串
          两者互转：不能直接用 nsh 内置的 format: "markdown" 读入和 getMarkdown() 写出——2026-11-24 实测会丢内容
          （front matter、公式、脚注、引用式链接、HTML、下划线 / 高亮 / 上下标、代码块语言后的附加信息）。
          转换层：解析用 nsh 自带的 TextView.parse（不引 markdown-it 等 npm 依赖，用户 2026-11-24 定），写出自己写；
          细节见实施计划第 4 节，M1 已实现（src/doc/ + src/features/editor/parse.ts）
本地存储  正文：浏览器里放 IndexedDB（额度按磁盘算），别处和 IndexedDB 打不开时放 nsh Storage（键值，上限 5MB）；设置放 Storage
          打开文件 / 另存为：系统选择框读入；浏览器下载、桌面存进「下载」文件夹（nsh 0.6.0 没有保存对话框）
同步      GitHub REST API（fetch），一篇文档 = 一个私有 Gist
登录      Web：OAuth 网页授权，code 换 token 走中转 Worker（client secret 不进前端）
          macOS：OAuth Device Flow（不需要 secret）
发布      Web：make build-web → npx wrangler deploy → Cloudflare（Workers 静态资源，项目 pairdown，配置在 wrangler.jsonc）
          线上：https://markdown.pairwise.site/（2026-11-25 首次发布；nsh.json web.base = /）
          macOS：nsh package --target macos → .app
CI        GitHub Actions：装 nsh v0.6.0 → check → test → package web → wrangler deploy（要两个仓库 secret，还没配，现在是本机手动发布）
```

<!-- [inferred] 同步目标选 Gist：一篇一个私有 Gist 最简单，不需要用户先建仓库；若改成存仓库，改这里和 src/sync/ -->
<!-- [inferred] macOS 原生 fetch 不受 CORS 限制，所以 Device Flow 可以直接调 github.com（待求证：P2 开工时实测）；Web 端 github.com 的 token 接口没有 CORS，必须经 Worker -->
<!-- Web 端「另存为」：应用代码在 web host 上直接跑在页面里，能用 document 造下载链接（2026-11-24 实测），不用 host.js；见 src/platform/web/download.ts -->

## 快速启动

```bash
make dev        # macOS 窗口里跑，热重载
make dev-web    # 浏览器里跑
make check      # 类型检查（nsh check）
make test       # 跑测试（nsh test）
make build-web  # 打包静态站到 dist/web/Pairdown/
make build-mac  # 打包到 dist/macos/Pairdown.app
```

## 目录结构

```text
md/
├── App.tsx              入口：mount 根组件
├── nsh.json             应用配置：id、theme、能力（capabilities）、web.base
├── theme.json           设计 token（颜色、圆角、字体），明暗两套值
├── DESIGN.md            设计系统 + 每个屏幕的动效清单；写屏幕代码前先改它
├── src/
│   ├── doc/             纯函数：标题 / 摘要提取、冲突比较、编辑器 JSON → Markdown 写出（不引 nsh）
│   ├── store/           本地存储：文档索引、正文、自动保存（Storage 的唯一入口）
│   ├── sync/            GitHub：登录状态、Gist 读写、冲突判断
│   ├── platform/        平台差异的唯一位置：web/、macos/（导入导出、登录流程、菜单）
│   ├── features/        屏幕：编辑页（含调 TextView.parse 的 Markdown 解析和原文切片）、文档列表、设置、同步状态
│   └── ui/              基础组件（按钮、对话框、工具栏……）
├── tests/               全部测试（*.test.ts / *.test.tsx）
├── worker/              （P2）OAuth code 换 token 的 Cloudflare Worker
├── .github/workflows/   deploy.yml
└── Makefile
```

<!-- 目录是目标结构：M1 已建 src/doc、src/store、src/platform、src/features/editor、src/ui；src/sync、worker、.github 还没有 -->

## 关键约定

- **Markdown 是唯一事实来源**：存储、同步、导出都只存 Markdown 字符串；ProseMirror JSON 不落盘。schema、扩展或转换层一改，就要过「Markdown → 编辑器 → Markdown」往返测试（`tests/doc-roundtrip.test.ts`）。
- **保真约定**（细节见实施计划第 4 节）：没改过的顶层块保存时逐字节写回原文（一个列表、一张表格算一个块）；改过的块按固定写法重写，重写结果再读一遍必须不变；不认识的语法当原文保留，不丢、不加转义。
- **编辑器必须带扩展建会话**：至少 `extensions: [StarterKit, TableKit]`。不带扩展的默认 schema 会把表格拆成段落（实测）。`StarterKit` 已含高亮、下划线、上下标，再加一次会报「two extensions are named …」。
- **大文档走源码方式**：RichEditor 没有虚拟滚动，整篇一次渲染。超过 `EditorScreen.tsx` 里的 `RICH_MAX_CHARS` / `RICH_MAX_LINES` / `RICH_MAX_TABLE_ROWS`（单张表格行数）任意一条就用源码方式打开；实测数字在实施计划 9.4 节，改上限前先重测。表格列宽拖拽必须关着（`schema.ts`），开着时表格一多 web host 会崩。
- **JS 单次调用有 2000ms 预算**（超了 nsh 直接中断，实测报 `a call into JS exceeded its budget of 2000 ms`）：整篇解析、序列化这类重活要量过耗时，大文档要分片。
- **平台分支只在 `src/platform/index.ts`**：只有它读 nsh 的 `platform.os`；`features/` 和 `ui/` 只调它导出的函数。
- **存储只走 `src/store/`**：其他模块不直接调 `Storage`、不直接碰 IndexedDB，键名也只在 store 里定义。
- **样式只用 token**：组件里不写十六进制颜色和调色板类，也不写 `dark:`；明暗由 `theme.json` 的两套值决定（见 `DESIGN.md`）。全局规则里的 `@pkgs/theme`、`@pkgs/us-icons`、prism-ui 针对公司仓库，本项目不适用（见 `EXECUTION.md` 第 0 节）。
- **参考实现**：`~/workspace/spare/joy-jinyu.github.io/blog/editor-app/` 是同一作者、同版本 nsh 已上线的应用。ui 组件、web host 桥接、测试写法可以照着它做，但不要整目录照搬，按需拿。
- 细则见 `CONTRIBUTING.md`。

## 当前阶段

阶段划分以 `~/Documents/learning/html/md/typora-plan.html` 第 6 节为准（M1–M5），各阶段和 S0 每项的当前状态也标在那里；实施记录在第 9 节。

- [x] **S0 第 9、13 项**：原文切片、块 JSON 稳定（2026-11-24，结果见计划 9.1）
- [ ] **M1 写作内核**：代码已写完，check / test / 两端打包 / 浏览器实操已过，**未提交，等用户验收**。没达到的验收项：「1 万行打开 ≤ 1 秒」（长文改走源码方式，见计划 9.3）；没验证：macOS 窗口里真实打字、中文输入法
- [ ] **M2 编辑体验**：代码已写完，check / test / 两端打包 / 浏览器实操已过，**未提交，等用户验收**。和计划不一样的地方、没做的项、没验证的项见计划 9.7
- [ ] **M3 文档库、文件和图片**
- [ ] **M4 扩展语法的渲染**
- [ ] **M5 同步与发布**

S0 其余 12 项在各自阶段开工前做。

## 开发工作流

1. **计划**：功能开工前写实施计划，放在 `~/Documents/learning/html/md/<主题>-plan.html`（用户全局规则，优先于仓库内 `docs/plans/`），列出要改的文件、接口、验收标准，用户确认后再写代码。
2. **设计**：涉及屏幕的，先改 `DESIGN.md`（布局、token、动效）。
3. **实现**：整批写完再跑测试（用户全局规则「测试节奏」）。
4. **验证**：`make check` → `make test` → `make dev-web` 浏览器里真实操作 → `make dev` macOS 窗口里真实操作。
5. **评审**：每次交回前，让一个没写过这批代码的子代理按预期行为审 diff。
6. **提交**：用户授权后才 commit / push（和全局规则的差异见 `EXECUTION.md` 第 0 节）；格式见 `.claude/rules/git-workflow.md`。

### 强制规则

1. GitHub client secret 不进仓库也不进前端包，只放在 Worker 的 secret 里；access token 不打日志、不写进错误提示，只存在 `store/`，退出登录时删掉。
2. Markdown 往返不能丢内容（按「关键约定」里的保真约定判定）：改 schema、扩展或 `doc/` 必须跑往返测试，有失败就不交付。
3. 同步不能静默覆盖：本地和远端都改过时必须让用户选，不能自动丢掉任何一边。
4. UI 改动的验收是 Web 和 macOS 两个 host 上的真实交互；只过类型检查和测试不算完成。

## MVP 降级策略

<!-- [inferred] project.stage = mvp：新项目、单人开发 -->

| 能力 | MVP 实现 | 正式版 |
|------|---------|--------|
| 本地存储 | Web：IndexedDB；其他：Storage 键值（5MB）。只有一篇文档 | 本机网关把文档和图片存成真实文件（计划第 10 节，M3）；没装网关时仍用现在这套 |
| 同步 | 手动「同步」按钮，冲突时二选一 | 自动同步、按段合并 |
| 图片 | 只保留外链图片，不支持粘贴上传 | 上传到 Gist / 仓库 |
| 导入导出 | 打开 .md（替换当前这一篇）、另存为 .md | HTML、PDF |
| Mermaid / 公式 | 当代码块显示（公式不能当普通文字读入：内置写出会把 `_`、`\` 转义坏，实测） | 渲染 |

## 待定事项

- 同步目标：Gist（当前假设）还是用户指定的仓库。
- OAuth App：新建一个「md」专用 App，还是复用博客投稿的 Worker（`pairwise-cms-auth`，ALLOWED_DOMAINS 要加 `/md/` 所在域名，现在已经是 www.pairwise.site）。
- 视觉方向：M1 先按 pairwise.site 品牌做了（青色主色，明暗两套，只在 `theme.json`），用户还没确认；应用 id 先用 `site.pairwise.md`。
- 其余待定项（同步目标要不要因为图片改成仓库、macOS 选文件夹 / 另存为的做法、PDF 导出）见实施计划第 7 节。
