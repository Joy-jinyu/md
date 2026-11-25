# Pairdown（仓库名 md）— AI 开发上下文

## 项目概述

Pairdown：用 nsh（v0.7.0，TSX；2026-11-25 从 0.6.0 升上来）写的所见即所得 Markdown 编辑器（品牌名 2026-11-24 定，仓库和应用 id 仍叫 md / `site.pairwise.md`），Web 和 macOS 共用一份代码。文档只以 Markdown 文本保存在本地，登录 GitHub 后可以同步。AI agent 按本文件和 `EXECUTION.md` 设计、实现、验证；提交和对外操作要用户授权。

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
本地存储  文档库，功能代码只经 src/store/ 的 DocumentStore 接口（计划 10.2，src/store/document-store.ts）；用哪种后端只在 src/store/backend.ts 定：
          · macOS：文库文件夹 ~/Documents/Pairdown 的 .md 文件（src/platform/macos/file-store.ts，fs/promises，临时文件 + rename；第一次用时把 Storage 里的文档搬进去）
          · 网页 + 本机网关：启动时 600ms 内连上 ws://127.0.0.1:7341 就用网关文库的 .md 文件（src/store/gateway-store.ts，协议和 gateway/ 共用 gateway/src/protocol.ts）
          · 网页、没有网关：浏览器本地，IndexedDB（额度按磁盘算），打不开时 nsh Storage（上限 5MB）
          文件类后端的 id 是文库内相对路径、版本是内容 SHA-256；写入带版本，对不上不覆盖（冲突条）。版本历史、应急键、设置、上次打开哪篇放本机 Storage / IndexedDB
          外部改动：网关推送；macOS 没有文件监听接口，窗口重新获得焦点时比对
          打开文件 / 另存为：系统选择框读入，存成文档库里的一篇新文档；浏览器下载、桌面存进「下载」文件夹（nsh 没有保存对话框，0.7.0 也没有，2026-11-25 查 `.nsh/types/`）
同步      GitHub REST API（fetch），一篇文档 = 一个私有 Gist
登录      Web：OAuth 网页授权，code 换 token 走中转 Worker（client secret 不进前端）
          macOS：OAuth Device Flow（不需要 secret）
发布      Web：make build-web → npx wrangler deploy → Cloudflare（Workers 静态资源，项目 pairdown，配置在 wrangler.jsonc）
          线上：https://markdown.pairwise.site/（2026-11-25 首次发布；nsh.json web.base = /）
          build-web 末尾由 scripts/web-headers.mjs 从 nsh.json 生成 _headers（响应头里的 connect-src 白名单等，见 .claude/rules/security.md「外链图片」）；
          本地开发页（make dev-web）不发这些头，不受这层保护
          macOS：nsh package --target macos → .app
CI        GitHub Actions：装 nsh v0.7.0、Node 24 → make verify（check、页面测试、网关测试、Worker 测试）→ package web → wrangler deploy（要两个仓库 secret，还没配，现在是本机手动发布）
```

<!-- [inferred] 同步目标选 Gist：一篇一个私有 Gist 最简单，不需要用户先建仓库；若改成存仓库，改这里和 src/sync/ -->
<!-- [inferred] macOS 原生 fetch 不受 CORS 限制，所以 Device Flow 可以直接调 github.com（待求证：P2 开工时实测）；Web 端 github.com 的 token 接口没有 CORS，必须经 Worker -->
<!-- Web 端「另存为」：应用代码在 web host 上直接跑在页面里，能用 document 造下载链接（2026-11-24 实测），不用 host.js；见 src/platform/web/download.ts -->

## 快速启动

```bash
make dev        # macOS 窗口里跑，热重载
make dev-web    # 浏览器里跑
make check         # 类型检查（nsh check）
make test          # 跑页面的测试（nsh test）
make test-gateway  # 跑本机网关的测试（gateway/，要 Node ≥ 23.6）
make test-worker   # 跑登录中转 Worker 的测试（worker/）
make verify        # 上面四样一起跑（CI 跑的就是它）
make build-web     # 打包静态站到 dist/web/Pairdown/
make build-mac     # 打包到 dist/macos/Pairdown.app

# 本机网关（网页版把文档存成文件时用；页面固定连 127.0.0.1:7341）。用户装：curl -fsSL https://markdown.pairwise.site/gateway.sh | sh（后台服务 + pairdown 命令 + 自动更新，见 gateway/README.md）；开发时从源码跑：
cd gateway && npm install && node src/main.mts --library ~/Documents/Pairdown
# 本地开发页面（make dev-web）也要连时加 --origin http://127.0.0.1:8811，见 gateway/README.md
```

## 目录结构

```text
md/
├── App.tsx              入口：mount 根组件
├── nsh.json             应用配置：id、theme、能力（capabilities）、web.base
├── theme.json           设计 token（颜色、圆角、字体），明暗两套值
├── DESIGN.md            设计系统 + 每个屏幕的动效清单；写屏幕代码前先改它
├── src/
│   ├── doc/             纯函数（不引 nsh）：解析结果 → 编辑器 JSON、编辑器 JSON → Markdown / HTML 写出、标题、文件名、块对齐
│   ├── store/           本地存储：文档库、正文、版本历史、应急键、同步记录、自动保存（Storage、IndexedDB、网关连接的唯一入口；选后端在 backend.ts）
│   ├── sync/            GitHub：登录（Device Flow / 网页授权）、Gist 读写、推拉判定、配置常量（config.ts）
│   ├── platform/        平台差异的唯一位置：index.ts 按平台挑；macos/（文库文件夹、存进「下载」）、web/（下载）；菜单栏、退出前保存、系统交来的文件
│   ├── features/
│   │   ├── editor/      编辑页（含调 TextView.parse 的 Markdown 解析和原文切片）、命令、菜单内容、图片
│   │   ├── files/       打开文件、另存为、导出 HTML
│   │   ├── library/     文档列表、快速打开、版本历史、删除 / 改名、存储变化和重连网关
│   │   ├── settings/    设置（快捷键、存储、同步三个页签）
│   │   └── sync/        同步入口、同步面板、同步一次、要你选的事
│   └── ui/              基础组件（按钮、图标、提示……）
├── tests/               页面的全部测试（*.test.ts / *.test.tsx）
├── gateway/             本机网关（Node，.mts）：让网页版读写本机文件夹；协议 gateway/src/protocol.ts 和页面共用
├── worker/              网页版登录用的 Cloudflare Worker：OAuth code 换 token（2026-11-25 已部署；这个目录里的 wrangler 命令必须带 `--config ./wrangler.toml`，见 worker/README.md）
├── .github/workflows/   deploy.yml
└── Makefile
```

## 关键约定

- **Markdown 是唯一事实来源**：存储、同步、导出都只存 Markdown 字符串；ProseMirror JSON 不落盘。schema、扩展或转换层一改，就要过「Markdown → 编辑器 → Markdown」往返测试（`tests/doc-roundtrip.test.ts`）。
- **保真约定**（细节见实施计划第 4 节）：没改过的顶层块保存时逐字节写回原文（一个列表、一张表格算一个块）；改过的块按固定写法重写，重写结果再读一遍必须不变；不认识的语法当原文保留，不丢、不加转义。
- **编辑器必须带扩展建会话**：至少 `extensions: [StarterKit, TableKit]`。不带扩展的默认 schema 会把表格拆成段落（实测）。`StarterKit` 已含高亮、下划线、上下标，再加一次会报「two extensions are named …」。
- **大文档走源码方式**：nsh 0.6.0 的 RichEditor 整篇一次渲染；0.7.0 起只挂视口附近的块，打开快了很多，但每敲一个字仍随全文变慢（2026-11-25 复测，数字在 `EditorScreen.tsx` 上限旁的注释里，上限没改）。超过 `EditorScreen.tsx` 里的 `RICH_MAX_CHARS` / `RICH_MAX_LINES` / `RICH_MAX_TABLE_ROWS`（单张表格行数）任意一条就用源码方式打开；实测数字在实施计划 9.4 节，改上限前先重测。表格列宽拖拽必须关着（`schema.ts`）：0.6.0 时表格一多 web host 会崩；0.7.0 多表不崩了，但单张 500 行的表开着就 wasm 内存越界。
- **nsh 0.7.0 的变化和坑**（2026-11-25 升级时实测，细节见各处注释）：
  - 长文档只挂视口附近的块：从没显示过的块 `scrollIntoView` 不滚、`coordsAtPos` / `nodeRect` 是 null。跳转（查找、大纲、目录、脚注、Cmd+D、源码视图切回）设好选区后都要调 `caret-follow.tsx` 的 `reachSelection()`；盖在块上的东西（提示块标签）滚动停下后重量（`BlockOverlays` 的 `scrolled`）。
  - 节点视图里的按钮：上一下点击不在编辑器里时（刚打开、刚从侧栏跳来），这一下只报 `onMouseUp` 不报 `onPress`，按钮用 `node-press.ts` 的 `nodePress`。
  - `Clipboard.writeText` 拒收时 resolve 成 `"failed"`，写剪贴板经 `src/ui/clipboard.ts`。回车分段保留粗体等 mark（跟 Tiptap，用户定跟随）。
  - macOS 关掉最后一个窗口应用不退出：关窗按钮改成藏窗口、先存盘，点程序坞图标再显示（`platform/index.ts` 的 `keepWindowOnClose`）。
  - 测试驱动：`press("text:…")` 按的是整行正中（行内的字没有自己的视图，短行落到行尾），要落在字上用 `{ position }` 或键盘；两次 press 不到 400ms 算双击（不看位置）；同一个命令的键 40ms 内按两次会被 `keys.ts` 的 `once` 去重，连按之间 `wait(100)`；`nsh test` 默认并行，`make test` 用 `--jobs 1`。
- **JS 单次调用有 2000ms 预算**（超了 nsh 直接中断，实测报 `a call into JS exceeded its budget of 2000 ms`）：整篇解析、序列化这类重活要量过耗时，大文档要分片。
- **平台分支只在 `src/platform/index.ts`**：只有它读 nsh 的 `platform.name`；`features/` 和 `ui/` 只调它导出的函数。
- **存储只走 `src/store/`**：其他模块不直接调 `Storage`、不直接碰 IndexedDB，键名也只在 store 里定义。
- **样式只用 token**：组件里不写十六进制颜色和调色板类，也不写 `dark:`；明暗由 `theme.json` 的两套值决定（见 `DESIGN.md`）。全局规则里的 `@pkgs/theme`、`@pkgs/us-icons`、prism-ui 针对公司仓库，本项目不适用（见 `EXECUTION.md` 第 0 节）。
- **参考实现**：`~/workspace/spare/joy-jinyu.github.io/blog/editor-app/` 是同一作者、同版本 nsh 已上线的应用。ui 组件、web host 桥接、测试写法可以照着它做，但不要整目录照搬，按需拿。
- 细则见 `CONTRIBUTING.md`。

## 当前阶段

阶段划分以 `~/Documents/learning/html/md/typora-plan.html` 第 6 节为准（M1–M5），各阶段和 S0 每项的当前状态也标在那里；实施记录在第 9 节。

- [x] **S0 第 9、13 项**：原文切片、块 JSON 稳定（2026-11-24，结果见计划 9.1）
- [x] **M1 写作内核**：已提交（`9797ef8`，2026-11-25）。没达到的验收项：「1 万行打开 ≤ 1 秒」（长文改走源码方式，见计划 9.3）；2026-11-25 白天在打包的 `.app` 真窗口里实测过两轮（计划 9.13）；没验证：中文输入法
- [x] **M2 编辑体验**：已提交（`9797ef8`，2026-11-25）。和计划不一样的地方、没做的项、没验证的项见计划 9.7
- [ ] **M3 文档库、文件和图片**：代码已写完（2026-11-25 夜间），独立审查查出的问题已修，check / test / 两端打包已过，**未提交，等用户验收**。没达到：macOS 原地打开文库外的文件（nsh 不给权限，只能导入副本）、「粘贴的截图能同步」（图片不同步）、拖角缩放（只有宽度预设）、「本地 → 图床」转存。2026-11-25 白天打包的 `.app` 真窗口两轮实测过（启动约 1.5 秒，文库读写、外部改动、粘贴图片、另存为 / 导出都过；第二轮修复后的 9 项没复验，见计划 9.13）。没验证：线上页面连本机网关时有界面浏览器的权限弹窗和 Chrome 以外的浏览器、GitHub 上图片显示是否一致。见计划 9.12
- [ ] **M4 扩展语法的渲染**：代码已写完（2026-11-25 夜间），独立审查查出的问题已修，**未提交，等用户验收**。Mermaid 2026-11-25 改成出图（仓库里放一份 mermaid 12.3.0，藏起来的 WebView 渲染，两端同一套），已审已修；真 macOS 窗口里流程图 / 时序图明暗都画出、恶意图无弹窗。见计划 9.12、9.13
- [ ] **M5 同步与发布**：同步代码已写完（`src/sync/`、`src/features/sync/`、`worker/`），**未提交，等用户验收**。2026-11-25 白天已启用并在线上用真实 GitHub 验证：OAuth App「Pairdown」、Worker `pairdown-auth` 已部署，网页登录走通（scope 只有 gist、PKCE S256）；真实 Gist 上查出并修了 GitHub 60 秒缓存导致的静默覆盖，修后复验冲突、两种选边、远端删除后重新上传 / 不再同步、首次上传确认都过；线上站点已含同步；打包的 `.app` 能启动。没达到：图片不同步（Gist 接口的文件内容只有字符串字段）；PDF 不做（代选，待确认）。没验证：macOS 的 Device Flow 只走到出用户码；登录回跳后清 `iss` 参数；CI 工作流没跑过。见计划 9.13

S0 其余各项的状态见计划第 6 节。

## 开发工作流

1. **计划**：功能开工前写实施计划，放在 `~/Documents/learning/html/md/<主题>-plan.html`（用户全局规则，优先于仓库内 `docs/plans/`），列出要改的文件、接口、验收标准，用户确认后再写代码。
2. **设计**：涉及屏幕的，先改 `DESIGN.md`（布局、token、动效）。
3. **实现**：整批写完再跑测试（用户全局规则「测试节奏」）。
4. **验证**：`make check` → `make test` → `make dev-web` 浏览器里真实操作 → `make dev` macOS 窗口里真实操作。
   macOS 窗口测试不打扰用户（2026-11-25 用户要求）：只用 `nsh test --target macos`（不抢键盘，截图用 `app.screenshot()` 只截应用窗口；只有一块屏时窗口仍会盖到前面一次；`modules` 替身在真实目标上不可用，读的是真实文库），不用 `.app` + System Events + 全屏截图（会抢焦点、吃掉用户按键、截到别的窗口）。窗口测试攒成一批，用户说可以时才跑。
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
| 本地存储 | macOS：~/Documents/Pairdown 的 .md 文件；Web：装了本机网关用网关文库的 .md 文件，没装用 IndexedDB（退路 Storage 5MB）。带版本历史（放浏览器 / 应用本机存储）；图片见下一行 | macOS 选文库文件夹 |
| 同步 | 手动「同步」，一篇一个私有 Gist；冲突、一边删了都让用户选；首次上传先列出来确认；图片不同步。OAuth App 和 Worker 已配，线上已启用 | 自动同步、按段合并 |
| 图片 | 粘贴 / 选择框 / macOS 拖入的图片存进文档库（文件类后端在文档旁的 `assets/`，浏览器本地在 IndexedDB），正文写相对路径；可调宽度、对齐（写成 `<img>`）。外链图片直接显示（载不出来有占位），连着网关时可转存到本地。连着网关并设置了图床（自定义上传接口或 GitHub 仓库，都由网关上传，见 gateway/README.md「图床」）时，新插入的图片直接传图床、正文写外链；没设置时插图会问一次 | 已在本地的图片批量传图床（`transfer` 的 upload 方向仍回 not-supported）；没有网关时的图床 |
| 导入导出 | 打开 .md（导入成文档库里的一篇新文档；macOS 文库里的原地编辑）、另存为 .md、导出 HTML（图片内联；超过 2 万行或 100 万字不导出） | PDF（不做，代选待确认） |
| 公式 | 用 TextView 排版（不能当普通文字读入：内置写出会把 `_`、`\` 转义坏，实测） | — |
| Mermaid | 出图：`assets/vendor/mermaid/` 里的 mermaid 12.3.0（打包进应用，有图时才载入）在藏起来的 WebView 里画成 SVG，当图片显示（`src/features/editor/mermaid.tsx`）；语法错误显示源码 + 原因；导出 HTML 内联成图片 | 甘特图等宽图在窄屏上只等比缩小，不能横向滚动 |

## 待定事项

- 同步目标：Gist（代选，待确认）还是用户指定的仓库。
- OAuth App：2026-11-25 按「新建专用 App」做了并在线上用通（App 名 Pairdown，Worker `pairdown-auth`）；页面域名是 markdown.pairwise.site。
- 轮换 GitHub client secret：它在对话里明文出现过、也被一次全屏截图截到过，已建议轮换，是否已轮换未知。
- 首次同步确认的两个默认：列表默认全勾；「先不上传」不标成不同步（下次还问）。
- Mermaid：2026-11-25 用户放开「仓库里放一份 mermaid」后做成了出图（给了 `capabilities.webview` 后 WebView 在 web 上可用，是 sandbox iframe；之前测到 `available()` 为 false，按类型注释推断是因为没给这个权限）。产物多 5.5 MB（浏览器传输压缩后约 1.2 MB，只在文档里有图时下载），留不留待确认。
- Mermaid 渲染页的 `nsh.json` `capabilities.webview.hosts: []`：本意是「渲染页不许导航到任何站点」，但 nsh 的 sandbox 没有禁导航、页内 CSP 也管不到导航，空列表在 macOS WKWebView 上到底拦不拦导航、拦不拦 `html` 载入，待 macOS 窗口实测；在那之前应用只靠校验交回的 SVG（见 `.claude/rules/security.md`）。2026-11-25 白天真窗口里恶意图没有弹窗，但空列表拦不拦导航没有单独测。
- 剪贴板权限：`nsh.json` 的 `"clipboard": true` 读写一起给，应用只在 macOS「粘贴为纯文本」时读，留不留。
- 图片居中写成 `<img align="center">`：GitHub 上多半不居中，写法待定。
- macOS 图片旁光标过高（推测宿主把行高倍数乘到含图片的行上）：(a) 加块级图片节点再补往返规则，(b) 向 nsh 报宿主问题，待定。
- 导出 HTML 里的公式现在是 TeX 源码，要排版得引 KaTeX 类依赖，待定。
- macOS 暗色下原生标题栏是白底（nsh 没有窗口外观接口），要不要自绘标题栏，待定。
- CI：GitHub Actions 发布要两个 Cloudflare 仓库 secret 和 `main` 分支，都还没有。
- 顶层目录 `gateway/`：方向确认过，目录名和分层待用户补确认（计划第 9 节）。
- 视觉方向：M1 先按 pairwise.site 品牌做了（青色主色，明暗两套，只在 `theme.json`），用户还没确认；应用 id 先用 `site.pairwise.md`。
- 其余待定项（同步目标要不要因为图片改成仓库、macOS 选文件夹 / 另存为的做法、PDF 导出、「光标在格式内显示淡色符号」不做）见实施计划第 7 节。
