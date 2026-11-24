# 安全

| 规则 | 级别 | 检测方式 |
|------|------|---------|
| GitHub client secret 只在 Worker secret 里，不进仓库和前端包 | L0 | `rg -n -i --hidden -e client_secret -e clientSecret . -g '!worker/**' -g '!.claude/**' -g '!*.md'`，只允许 CI 里引用 `secrets.*` 的行 |
| access token 不打日志、不进错误提示、不进测试快照 | L0 | `rg -n -i 'console\.\w+\(.*token' src` 为空；参数跨行的情况靠 review |
| token 只由 `store/` 保存、`sync/` 读取，退出登录时删除 | L0 | `EXECUTION.md` 第 5 节的 token 检测命令 |
| OAuth scope 只要 `gist` | L1 | review 登录代码 |
| Worker 只接受 `ALLOWED_DOMAINS` 里的来源 | L1 | Worker 配置 |
| 粘贴的 HTML 只经 RichEditor schema 解析，不手拼 HTML | L1 | review |
| 打开链接只放行 `http:`、`https:`、`mailto:` 和文档内锚点，`javascript:`、`file:` 等一律不打开：应用自己打开只经 `src/features/editor/links.ts` 的 `linkTarget()`，编辑器的 Mod+ 点击由 nsh 内核打开，靠 `nsh.json` 的 `capabilities.openUrl.schemes` 限成同样三种 | L0 | `rg -n 'openUrl\(' src -g '!src/features/editor/links.ts'` 为空；review `nsh.json` |
| `nsh.json` 的 `network.hosts` 只放实际要访问的域名（api.github.com、Worker 域名） | L2 | review `nsh.json` |
| `nsh.json` 的 `capabilities.picker` 只用来让用户自己选要打开的文件（选择框由系统出，应用拿不到没被选中的文件）；`capabilities.fs` 只给「下载」文件夹（另存为用），不给更大的范围；写文件只由用户点「另存为」触发，文件名取自标题时去掉路径分隔符，文档内容不能让应用读写别的文件 | L0 | review `nsh.json`；`rg -n 'fs/promises' src` 只在 `src/platform/macos/` |
