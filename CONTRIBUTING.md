# md implementation guidelines

> Scope covers TypeScript and nsh TSX (`nsh`, `nsh/base`, `nsh/desktop`, and `nsh/test`).
> The reference app at `blog/editor-app/` in the public repository github.com/Joy-jinyu/joy-jinyu.github.io is deployed and uses the same version of nsh.

## 1. General conventions

### 1.1 Naming

| Item | Convention | Example |
|------|------------|---------|
| Components and types | PascalCase | `DocList`, `SyncState` |
| Functions, signals, and variables | camelCase | `currentDoc`, `saveDoc()` |
| Constants | UPPER_SNAKE | `STORAGE_PREFIX` |
| Component files | PascalCase.tsx | `features/Editor.tsx` |
| Non-component files | kebab-case.ts | `doc/markdown.ts` |
| Tests | `<topic>.test.ts(x)` under `tests/` | `tests/doc-roundtrip.test.ts` |

### 1.2 Size and complexity

- Aim for 200–400 lines per file, with a hard limit of 800. Keep functions to 50 lines or fewer and nesting to four levels or fewer.
- Use one file per screen. Extract subcomponents by screen region if the file grows too long.

### 1.3 Comments

Omit comments by default. Use them for conventions callers must follow, counterintuitive decisions someone might otherwise reverse, sources for magic numbers, and one-line pointers to the authoritative definition. Exported symbols may have a one-line JSDoc comment describing their purpose. Write comments in plain Chinese.

### 1.4 Immutability

- Replace objects and arrays with new values. For example, use `docs.update((list) => [...list, doc])` and leave the original array intact.
- Functions in `doc/` take inputs and return new values without touching global state.

## 2. nsh TSX

### 2.1 State

- Use `signal` for local state, `computed` for derived values, and `effect` for side effects. Use `untracked` to read a value inside an effect without subscribing to it.
- Keep state shared across screens at module scope in `store/` or `sync/`. Export read and update functions and keep writable signals private.

```ts
// store/library.ts（节选）
const docs = signal<DocMeta[]>([]);
export const allDocs = () => docs();
export function noteMeta(meta: DocMeta) {
  docs.update((list) => (list.some((d) => d.id === meta.id) ? list.map((d) => (d.id === meta.id ? meta : d)) : [...list, meta]));
}
```

### 2.2 Components and styles

- Use `View`, `Text`, `Scroll`, and components from `nsh/base`. Give clickable elements `role="button"` and an accessible name, which tests also use to locate them.
- Style with Tailwind classes. Use only color roles from `theme.json`, such as `bg-background`, `text-foreground`, and `bg-primary`. Avoid hex values, palette classes such as `bg-blue-500`, and `dark:`. Enable the theme with `"theme": "theme.json"` in `nsh.json`.
- Follow the reference app's `src/ui/icon.tsx` for icons using glyphs and embedded line SVGs in data URLs, colored with `tint-*`. Keep them together in `ui/icon.tsx`. <!-- [inferred] The icon approach awaits user confirmation. -->
- Check for an existing component in `nsh/base` first, including `Toolbar`, `Menu`, `Dialog`, `SplitView`, and `Tooltip`. Add a component under `ui/` when needed.

### 2.3 Editor

- Create one session per document with the required extensions using `createRichEditor({ content, format, extensions: [StarterKit, TableKit, …] })`, then render `<RichEditor editor={session} />`. Loading without the extensions splits tables into paragraphs. `StarterKit` already includes highlighting, underlining, superscript, and subscript.
- Route Markdown through the conversion layer. Parse with `TextView.parse` and use the project's own serializer. The built-in `format: "markdown"` and `session.getMarkdown()` lose content. See “Technical Architecture” in `CLAUDE.md` for the list and section 4 of the implementation plan for the design.
- Create a new session and remount the view when switching documents. The comment for the `editor` prop in `.nsh/types/nsh/base.d.ts` says “a new session needs a new view (a `key`)”. Use `key` accordingly. <!-- Verify during the technical validation phase that remounting works in both hosts. The earlier advice to wrap with <Each> because there was no key is obsolete. -->
- Each call into JavaScript has a 2000 ms budget before interruption. Time expensive operations first. On a document of 180,000 characters, `TextView.parse` took 201 ms, the editor's built-in Markdown loader took 457 ms, and `micromark` timed out.
- For autosave, the editor passes Markdown to `store/`, which throttles writes. Keep direct writes out of components.

### 2.4 Platform differences

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

Keep platform-specific implementations in `platform/web/` and `platform/macos/`, including the desktop library folder, saving to Downloads on macOS, and browser downloads. Select the implementation in `platform/index.ts`, the only file that reads nsh's `platform.name`. Keep `nsh/desktop` integration in `platform/` as well, including `setMenuBar`, saving before quit, and files handed off by the OS. Features supply the content.

### 2.5 Error handling

- Do not leave `catch` blocks empty. Give users an understandable message and a next step, such as retrying or signing in again. In `sync/`, log requests and status codes and omit tokens.
- Tell the user when `Storage` runs out of space (`ERR_NSH_QUOTA_EXCEEDED`).

## 3. Tests

- Put all tests in `tests/`. For screen tests, call `open("../App.tsx", { platform: "web", width: 1280, height: 860 })`, then `app.press(...)`, then assert on `app.texts()` or `app.storage()`. Test macOS behavior in a separate case with `platform: "macos"`.
- Test pure functions in `doc/` and `sync/` directly, including conflict detection.
- Stub requests with the `network` option to `open`, for example `{ "GET https://api.github.com/gists/*": … }`. Unlisted requests fail. Tests never contact GitHub.
- Set initial storage with the `storage` option to `open`.
- See section 6 of `EXECUTION.md` for test directory changes after adding `web.host`.

## 4. Git

- The authoritative commit format and scope list are in `.claude/rules/git-workflow.md`.
- Stage only the files changed for the task and exclude `.nsh/` and `dist/` from commits.
- Write commit subjects and bodies, PR titles and descriptions, review comments, and replies to review comments in English only. Keep code comments, log messages, and UI copy in Chinese as required by the project, and quote that text verbatim.

## 5. Security

- Keep the client secret in a Worker secret. The frontend gets only the client ID.
- Store tokens through `store/` in `Storage` and remove them on sign-out. Keep them out of logs, error messages, and test snapshots.
- Request only the `gist` OAuth scope. Exclude `repo`.
- Parse HTML pasted into the editor with RichEditor's schema and avoid hand-building HTML.

## 6. AI-assisted development

- Read `CLAUDE.md` and `EXECUTION.md` before starting. Check declarations in `.nsh/types/` before using an nsh API.
- For changes that follow the same pattern in several places, implement and verify the change in one place before applying it elsewhere.
