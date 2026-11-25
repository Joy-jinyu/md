# md 代码实现规范

> 覆盖：TypeScript + nsh TSX（`nsh`、`nsh/base`、`nsh/desktop`、`nsh/test`）。
> 参考：`~/workspace/spare/joy-jinyu.github.io/blog/editor-app/`（同版本 nsh 的已上线应用）。

## 1. 通用规范

### 1.1 命名

| 对象 | 写法 | 例子 |
|------|------|------|
| 组件、类型 | PascalCase | `DocList`、`SyncState` |
| 函数、signal、变量 | camelCase | `currentDoc`、`saveDoc()` |
| 常量 | UPPER_SNAKE | `STORAGE_PREFIX` |
| 组件文件 | PascalCase.tsx | `features/Editor.tsx` |
| 非组件文件 | kebab-case.ts | `doc/markdown.ts` |
| 测试 | 放 `tests/`，`<主题>.test.ts(x)` | `tests/doc-roundtrip.test.ts` |

### 1.2 大小与复杂度

- 文件 200–400 行，硬上限 800；函数 50 行以内；嵌套不超过 4 层。
- 一个屏幕一个文件，过长时按区域拆子组件。

### 1.3 注释

默认不写。只写四类：调用方必须遵守的约定、容易被「改回去」的反直觉处理、魔法数字的出处、指向唯一定义处的一句话。导出的符号可以有一行 JSDoc 说明用途。用中文大白话。

### 1.4 不可变

- 对象和数组更新用新值：`docs.update((list) => [...list, doc])`，不用 `push` 改原数组。
- `doc/` 里的函数只收参数、返回新值，不碰全局状态。

## 2. nsh TSX

### 2.1 状态

- 局部状态用 `signal`，派生值用 `computed`，副作用用 `effect`，在 effect 里读但不想订阅的值用 `untracked`。
- 跨屏幕共享的状态放在 `store/` 或 `sync/` 模块顶层，导出读取函数和修改函数，不导出可写 signal 本身。

```ts
// store/library.ts（节选）
const docs = signal<DocMeta[]>([]);
export const allDocs = () => docs();
export function noteMeta(meta: DocMeta) {
  docs.update((list) => (list.some((d) => d.id === meta.id) ? list.map((d) => (d.id === meta.id ? meta : d)) : [...list, meta]));
}
```

### 2.2 组件与样式

- 用 `View` / `Text` / `Scroll` 和 `nsh/base` 组件；可点的东西给 `role="button"` 和能读出来的名字（测试也靠它定位）。
- 样式写 Tailwind 类，颜色只用 `theme.json` 的角色（`bg-background`、`text-foreground`、`bg-primary`……），不写十六进制、调色板类（`bg-blue-500`）和 `dark:`。`theme.json` 要在 `nsh.json` 里写 `"theme": "theme.json"` 才生效。
- 图标：先照参考应用 `src/ui/icon.tsx` 的做法（字形 + 内嵌 data: 线条 SVG，`tint-*` 上色），放在 `ui/icon.tsx` 一处。<!-- [inferred] 图标方案未和用户确认 -->
- 新组件先看 `nsh/base` 有没有（`Toolbar`、`Menu`、`Dialog`、`SplitView`、`Tooltip`……），没有再写进 `ui/`。

### 2.3 编辑器

- 一篇文档一个会话，必须带扩展：`createRichEditor({ content, format, extensions: [StarterKit, TableKit, …] })`，再 `<RichEditor editor={session} />`。不带扩展表格会被拆成段落；`StarterKit` 已含高亮、下划线、上下标，不要重复加。
- 读入和写出不直接用内置的 `format: "markdown"` / `session.getMarkdown()`（会丢内容，清单见 `CLAUDE.md`「技术架构」）；走转换层（解析用 `TextView.parse`，写出自己写），方案见实施计划第 4 节。
- 切换文档要换新会话，并让视图重建。`.nsh/types/nsh/base.d.ts` 里 `editor` 属性的注释写的是「a new session needs a new view (a `key`)」，按它用 `key`。<!-- 待求证：运行时是否真的重建，技术验证阶段在两个 host 里实测；之前写的「没有 key，用 <Each> 包」作废 -->
- 单次进 JS 的调用预算是 2000ms，超了被中断：重活先量耗时（实测 18 万字符的文档，`TextView.parse` 201ms，编辑器内置 Markdown 读入 457ms，`micromark` 超时）。
- 自动保存：编辑器把 Markdown 交给 `store/`，节流写入在 `store/` 里做，组件不直接写存储。

### 2.4 平台差异

```ts
// platform/index.ts（节选）：features 只引这里，按功能导出，不导出叫 platform 的对象（避免和 nsh 的 platform 混淆）
import { platform } from "nsh";
import { saveToDownloads } from "./macos/save";
import { downloadText } from "./web/download";

export const IN_BROWSER = platform.name === "web";
export async function saveTextFile(name: string, text: string, type?: string): Promise<SavedFile> {
  if (IN_BROWSER) {
    downloadText(name, text, type);
    return { message: `已交给浏览器下载：${name}`, confirmed: false };
  }
  return { message: `已存到 ${await saveToDownloads(name, text)}`, confirmed: true };
}
```

`platform/web/`、`platform/macos/` 放各自的实现（macOS 的文库文件夹、存进「下载」，网页的下载），由 `platform/index.ts` 按平台挑；读 nsh 的 `platform.name` 只出现在 `platform/index.ts`。和 `nsh/desktop` 打交道的（菜单栏 `setMenuBar`、退出前保存、系统交来的文件）也只在 `platform/`，features 只给内容。

### 2.5 错误处理

- 不写空 `catch`。UI 层给出能看懂的提示和下一步（重试、重新登录）；`sync/` 记下请求和状态码，但不记 token。
- `Storage` 写满（`ERR_NSH_QUOTA_EXCEEDED`）要提示用户，不能吞掉。

## 3. 测试

- 所有测试在 `tests/`。屏幕测试：`open("../App.tsx", { platform: "web", width: 1280, height: 860 })` → `app.press(...)` → 断言 `app.texts()` 或 `app.storage()`；macOS 行为另开一个 `platform: "macos"` 的用例。
- 纯函数测试：直接调 `doc/`、`sync/` 里的纯函数（冲突判断等）。
- 网络请求用 `open` 的 `network` 选项打桩（`{ "GET https://api.github.com/gists/*": … }`），没列出的请求一律失败，不连真 GitHub。
- 初始存储用 `open` 的 `storage` 选项给。
- 加了 `web.host` 之后的测试目录调整见 `EXECUTION.md` 第 6 节。

## 4. Git

- 提交格式和 scope 清单见 `.claude/rules/git-workflow.md`（唯一来源）。
- 只暂存本次改动的文件；不提交 `.nsh/`、`dist/`。
- 提交信息（标题和正文）、PR 标题和描述、review 评论及其回复只用英文。代码注释、日志和界面文案仍按项目规范用中文；
  引用其中的中文时保留原文。

## 5. 安全

- client secret 只在 Worker 的 secret 里；前端只有 client id。
- token 存 `store/`（Storage），退出登录时删掉；不写进日志、错误提示和测试快照。
- OAuth 权限只要 `gist`，不要 `repo`。
- 粘贴 HTML 进编辑器时走 RichEditor 自己的 schema 解析，不手拼 HTML。

## 6. AI 辅助开发

- 开工前读 `CLAUDE.md` 和 `EXECUTION.md`；用 nsh API 前先查 `.nsh/types/` 里的声明，不凭印象写。
- 一类改动要落到多处时，先做完一处并验证，再推到其余地方。
