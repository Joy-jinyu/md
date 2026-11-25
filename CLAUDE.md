# Pairdown (repository: md) — AI Development Context

## Project Overview

Pairdown is a WYSIWYG Markdown editor built with nsh and TSX. It uses nsh v0.7.0, upgraded from v0.6.0 on 2026-11-25. The brand name was chosen on 2026-11-24. The repository and application ID are still `md` and `site.pairwise.md`. Web and macOS share one codebase. Documents are stored locally as Markdown text, with optional sync after signing in to GitHub. AI agents follow this file and `EXECUTION.md` for design, implementation, and verification. Get user authorization for commits and external actions.

**Precedence in a conflict** follows this order: `EXECUTION.md` (mandatory execution rules), then `DESIGN.md` and this document, then unimplemented ideas in “Current Phase.”

## Technical Architecture

```text
UI           nsh TSX (nsh, nsh/base) with RichEditor for WYSIWYG editing. Use only theme.json tokens for styles.
Model        Editing: ProseMirror JSON in a RichEditor session.
             Storage, sync, and export: Markdown strings only.
             Conversion: Use the conversion layer. Testing on 2026-11-24 found that the built-in format: "markdown"
             reader and getMarkdown() writer lose front matter, formulas, footnotes, reference links, HTML,
             underline, highlights, subscript, superscript, and code fence info after the language.
             Parse with nsh's TextView.parse and use the project serializer. The user ruled out npm parsers
             such as markdown-it on 2026-11-24. See plan §4. M1 implemented this in src/doc/ and src/features/editor/parse.ts.
Local store  Feature code accesses the library through the DocumentStore interface in src/store/
             (plan §10.2, src/store/document-store.ts). src/store/backend.ts selects the backend:
             • macOS: .md files in ~/Documents/Pairdown (src/platform/macos/file-store.ts, fs/promises,
               temporary file + rename). Documents migrate from Storage on first use.
             • Web with local gateway: If ws://127.0.0.1:7341 connects within 600 ms at startup, use .md files
               in the gateway library (src/store/gateway-store.ts and shared protocol gateway/src/protocol.ts).
             • Web without gateway: Use browser IndexedDB (disk-based quota), falling back to nsh Storage (5 MB).
             File-backed IDs are paths relative to the library. Revisions are SHA-256 hashes of file contents.
             Writes include the revision and surface a conflict on mismatch. Version history, recovery keys,
             settings, and the last opened document are kept in local Storage or IndexedDB.
             The gateway pushes external changes. macOS checks when the window regains focus because it lacks a file watcher.
             Open / Save As: Import from a system picker as a new library document. On export, the browser
             downloads the file and macOS writes it to Downloads. nsh has no save dialog as of v0.7.0
             (checked .nsh/types/ on 2026-11-25).
Sync         GitHub REST API (fetch), one private Gist per document.
Sign-in      Web: Browser OAuth. The relay Worker exchanges the code for a token and keeps the client secret off the frontend.
             macOS: OAuth Device Flow, which requires no client secret.
Release      Web: make build-web → npx wrangler deploy → Cloudflare Workers static assets, project pairdown,
             configured in wrangler.jsonc. Production: https://markdown.pairwise.site/ (first deployed
             2026-11-25, with nsh.json web.base = /).
             build-web runs scripts/web-headers.mjs to generate _headers from nsh.json, including the
             connect-src allowlist (see “External images” in .claude/rules/security.md).
             The local dev server (make dev-web) does not serve these headers.
             macOS: nsh package --target macos → .app.
CI           GitHub Actions installs nsh v0.7.0 and Node 24, runs make verify (type check, app, gateway,
             and Worker tests), packages the web app, and runs wrangler deploy (requires two repository
             secrets, still unset at the time of writing, so deployment is currently manual).
```

<!-- [inferred] Gist was chosen because one private Gist per document is the simplest option and requires no user-created repository. Update this file and src/sync/ if switching to repository storage. -->
<!-- [inferred] Native macOS fetch is not subject to CORS, so Device Flow can call github.com directly. Verify when P2 starts. The github.com token endpoint lacks CORS support for the web app, so the web app must use the Worker. -->
<!-- Web “Save As” runs directly in the web host page and can create download links with document, without host.js. Verified on 2026-11-24. See src/platform/web/download.ts. -->

## Quick Start

```bash
make dev        # macOS window with hot reload
make dev-web    # Run in the browser
make check         # Type check (nsh check)
make test          # App tests (nsh test)
make test-gateway  # Local gateway tests (gateway/, requires Node ≥ 23.6)
make test-worker   # OAuth relay Worker tests (worker/, requires Node ≥ 23.6)
make verify        # All four checks above, as in CI
make build-web     # Package the static site in dist/web/Pairdown/
make build-mac     # Package the app at dist/macos/Pairdown.app

# The web app connects to the optional local file gateway at 127.0.0.1:7341.
# To install the background service, pairdown command, and automatic updates, see gateway/README.md:
# curl -fsSL https://markdown.pairwise.site/gateway.sh | sh
# For development, run from source:
cd gateway && npm install && node src/main.mts --library ~/Documents/Pairdown
# Add --origin http://127.0.0.1:8811 to allow the local web app (make dev-web). See gateway/README.md.
```

## Directory Structure

```text
md/
├── App.tsx              Entry point that mounts the root component
├── nsh.json             App ID, theme, capabilities, and web.base
├── theme.json           Design tokens (color, radius, font) for light and dark themes
├── DESIGN.md            Design system and per-screen motion specs. Update before writing screen code.
├── src/
│   ├── doc/             Pure functions with no nsh imports: parsed Markdown → editor JSON, editor JSON → Markdown / HTML,
│   │                    titles, file names, and block alignment
│   ├── store/           Library, document bodies, history, recovery keys, sync records, and autosave.
│   │                    Sole entry point for Storage, IndexedDB, and the gateway connection. backend.ts selects the backend.
│   ├── sync/            GitHub sign-in (Device Flow / browser OAuth), Gist reads and writes, push/pull decisions, and config.ts
│   ├── platform/        All platform differences live here. index.ts selects macos/ (library folder and Downloads)
│   │                    or web/ (downloads). Also handles the menu bar, save-on-quit, and system file opens.
│   ├── features/
│   │   ├── editor/      Editor screen, Markdown parsing via TextView.parse, source slicing, commands, menus, and images
│   │   ├── files/       Open, Save As, and HTML export
│   │   ├── library/     Document list, quick open, history, deletion, renaming, storage changes, and gateway reconnection
│   │   ├── settings/    Settings tabs for keyboard shortcuts, storage, and sync
│   │   └── sync/        Sync entry point, panel, one-off sync, and decisions that require user input
│   └── ui/              Basic components such as buttons, icons, and notices
├── tests/               All app tests (*.test.ts / *.test.tsx)
├── gateway/             Local Node gateway (.mts) for browser access to local files. Shares gateway/src/protocol.ts with the app.
├── worker/              Cloudflare Worker that exchanges web OAuth codes for tokens. Deployed on 2026-11-25.
│                        Run wrangler commands here with --config ./wrangler.toml. See worker/README.md.
├── .github/workflows/   deploy.yml
└── Makefile
```

## Key Conventions

- **Markdown is the sole source of truth.** Storage, sync, and export use Markdown strings only. Keep ProseMirror JSON in memory. Schema, extension, and conversion changes must pass the Markdown → editor → Markdown tests in `tests/doc-roundtrip.test.ts`.
- **Fidelity requirements.** See plan §4. Write unchanged top-level blocks back byte for byte. A list or table counts as one block. Serialize changed blocks consistently so another parse and write yields identical output. Preserve unrecognized syntax verbatim, including its original escaping.
- **Create editor sessions with extensions.** Include at least `extensions: [StarterKit, TableKit]`. The default schema without extensions split tables into paragraphs in testing. `StarterKit` already includes highlights, underline, subscript, and superscript. Adding them again triggers “two extensions are named …”.
- **Use source mode for large documents.** RichEditor in nsh 0.6.0 rendered the entire document at once. As of 0.7.0 it mounts only blocks near the viewport, which speeds up opening. Per-keystroke latency still grows with document size (retested on 2026-11-25, with measurements in the comments next to the unchanged limits in `EditorScreen.tsx`). Open in source mode if any of `RICH_MAX_CHARS`, `RICH_MAX_LINES`, or `RICH_MAX_TABLE_ROWS` (rows in a single table) is exceeded. See plan §9.4 for measurements and retest before changing the limits. Keep column resizing disabled in `schema.ts`. In 0.6.0 many tables crashed the web host. In 0.7.0 many tables work, but a single 500-row table with resizing enabled can still cause an out-of-bounds Wasm memory access.
- **Changes and pitfalls in nsh 0.7.0.** Verified during the 2026-11-25 upgrade. See local comments for details.
  - Long documents mount only blocks near the viewport. For a block that has never been visible, `scrollIntoView` does not scroll and `coordsAtPos` / `nodeRect` return null. After setting the selection for jumps (Find, outline, table of contents, footnotes, Cmd+D, or switching back from source view), call `reachSelection()` from `caret-follow.tsx`. Remeasure block overlays such as callout labels when scrolling stops, using `scrolled` in `BlockOverlays`.
  - For buttons in node views, if the previous click was outside the editor, such as after opening or coming from the sidebar, the first click fires only `onMouseUp`. Use `nodePress` from `node-press.ts`.
  - Rejected `Clipboard.writeText` calls resolve to `"failed"`. Route clipboard writes through `src/ui/clipboard.ts`. Enter preserves marks such as bold across the split, following Tiptap as requested by the user.
  - Closing the last macOS window no longer quits the app. The close button saves and hides the window. Clicking the Dock icon shows it again via `keepWindowOnClose` in `platform/index.ts`.
  - In the test driver, `press("text:…")` targets the midpoint of the entire line. Inline text has no separate view, and a short line lands at its end. Use `{ position }` or the keyboard to target text. Two presses less than 400 ms apart count as a double-click regardless of position. Two keypresses for the same command within 40 ms are deduplicated by `once` in `keys.ts`. Use `wait(100)` between presses. `nsh test` runs in parallel by default, including when invoked through `make test`.
- **Each JS call has a 2000 ms budget.** nsh interrupts calls that exceed it with `a call into JS exceeded its budget of 2000 ms`. Measure expensive work such as full-document parsing and serialization, and split large documents into chunks.
- **Branch on platform only in `src/platform/index.ts`.** Only that file reads nsh's `platform.name`. `features/` and `ui/` call its exported functions.
- **Access persistence only through `src/store/`.** Keep direct access to `Storage` and IndexedDB and the storage key definitions inside the store.
- **Use tokens for styles.** Avoid hex colors, palette classes, and `dark:` in components. Light and dark values come from `theme.json` (see `DESIGN.md`). The global requirements for `@pkgs/theme`, `@pkgs/us-icons`, and prism-ui apply to company repositories. See `EXECUTION.md` §0 for this repository's exceptions.
- **Reference implementation.** `~/workspace/spare/joy-jinyu.github.io/blog/editor-app/` is a deployed app by the same author on the same nsh version. Refer to its UI components, web host bridge, and tests, and reuse only relevant pieces.
- See `CONTRIBUTING.md` for detailed conventions.

## Current Phase

See §6 of `~/Documents/learning/html/md/typora-plan.html` for the M1–M5 milestones and the status of each milestone and S0 item. Implementation notes are in §9.

- [x] **S0 items 9 and 13.** Source slicing and stable block JSON (2026-11-24, results in plan §9.1).
- [x] **M1 writing engine.** Committed as `9797ef8` on 2026-11-25. The acceptance target of opening 10,000 lines in ≤ 1 second was missed. Long documents open in source mode (plan §9.3). Two interactive test passes ran in the packaged `.app` on 2026-11-25 (plan §9.13). Chinese IME input remains unverified.
- [x] **M2 editing experience.** Committed as `9797ef8` on 2026-11-25. See plan §9.7 for deviations, remaining items, and unverified behavior.
- [ ] **M3 library, files, and images.** Implementation finished on the evening of 2026-11-25. Findings from independent review were fixed, and the type check, tests, and both packages passed. **Awaiting user acceptance, with the work still uncommitted at the time of writing.** Remaining gaps include editing files outside the library in place on macOS (nsh permissions allow importing a copy), syncing pasted screenshots (images do not sync), resizing by dragging a corner (width presets are available), and transferring local images to an image host. Two interactive runs in the packaged `.app` on 2026-11-25 covered startup (about 1.5 seconds), library reads and writes, external edits, image pasting, Save As, and export. Nine items fixed in the second run were not retested (plan §9.13). Still unverified are permission prompts when a visible browser connects the production site to the local gateway, browser behavior outside Chrome, and consistent image display on GitHub. See plan §9.12.
- [ ] **M4 extended syntax rendering.** Implementation finished on the evening of 2026-11-25 and independent review findings were fixed. **Awaiting user acceptance, with the work still uncommitted at the time of writing.** Mermaid changed to image rendering on 2026-11-25. A vendored copy of Mermaid 12.3.0 renders in a hidden WebView on both hosts. The implementation was reviewed and fixed. Flowcharts and sequence diagrams rendered in light and dark mode in a macOS window, and a malicious diagram produced no popup. See plan §§9.12 and 9.13.
- [ ] **M5 sync and release.** Sync was implemented in `src/sync/`, `src/features/sync/`, and `worker/`. **Awaiting user acceptance, with the work still uncommitted at the time of writing.** On 2026-11-25 the Pairdown OAuth App and deployed `pairdown-auth` Worker were verified with real GitHub sign-in in production (`gist` scope only and PKCE S256). Testing with a real Gist found a silent overwrite caused by GitHub's 60-second cache. Retesting after the fix covered conflicts, choosing either side, re-uploading or stopping sync after remote deletion, and first-upload confirmation. Production includes sync, and the packaged `.app` launches. The Gist API accepts file contents as strings, so images do not sync. PDF export was deferred pending confirmation. The macOS Device Flow was only verified up to the user code. Cleanup of `iss` after the OAuth redirect and the CI workflow were unverified. See plan §9.13.

See plan §6 for remaining S0 items.

## Development Workflow

1. **Plan.** Before starting a feature, write an implementation plan at `~/Documents/learning/html/md/<topic>-plan.html`. The user's global rule takes precedence over the repository's `docs/plans/`. List files, interfaces, and acceptance criteria, then get user approval before coding.
2. **Design.** For screen changes, update `DESIGN.md` first, including the layout, tokens, and motion.
3. **Implement.** Finish the batch before running tests, as required by the user's global test cadence rule.
4. **Verify.** Run `make check`, then `make test`, then exercise the app in a browser with `make dev-web` and in a macOS window with `make dev`.
   Follow the user's 2026-11-25 instruction to avoid interrupting them during macOS window testing. Use only `nsh test --target macos`. It leaves the keyboard alone and `app.screenshot()` captures only the app window. On a single display, the window may still come forward once. The `modules` mock is unavailable on the real target, which reads the real library. Avoid using the packaged app with System Events and full-screen captures, which can steal focus, intercept keystrokes, and capture other windows. Batch window tests and run them when the user approves.
5. **Review.** Before handing work back, have a subagent that did not write the batch review the diff against the expected behavior.
6. **Commit.** Get user authorization before committing or pushing. See `EXECUTION.md` §0 for differences from the global rules and `.claude/rules/git-workflow.md` for the commit format.

### Mandatory Rules

1. Keep the GitHub client secret in Worker secrets only. Keep access tokens in `store/`, omit them from logs and errors, and delete them on sign-out.
2. Preserve Markdown content on round trips, as defined under “Key Conventions.” Run the round-trip tests after changing the schema, extensions, or `doc/`, and resolve any failures before delivery.
3. Never overwrite changes silently during sync. When both local and remote documents have changed, ask the user which side to keep.
4. Accept UI changes based on real interaction on both the Web and macOS hosts, in addition to type checks and tests.

## MVP Trade-offs

<!-- [inferred] project.stage = mvp: new project, solo development -->

| Capability | MVP | Full release |
|------|---------|--------|
| Local storage | macOS uses .md files in ~/Documents/Pairdown. Web uses .md files in the local gateway library when installed, or IndexedDB with a 5 MB Storage fallback. Version history stays in the browser or local app storage. See the images row for image storage. | Choose a library folder on macOS |
| Sync | Manual “同步,” one private Gist per document. Conflicts and deletions on either side prompt the user. First uploads require confirmation from a list. Images do not sync. The OAuth App and Worker are configured and active in production. | Automatic sync and paragraph-level merges |
| Images | Images pasted or selected through a picker, or dropped on macOS are stored in the library (in an adjacent `assets/` directory for file backends or IndexedDB for browser storage), with relative paths in the document. Width and alignment changes use `<img>`. Remote images display directly, with a placeholder on failure, and can be copied locally when connected to the gateway. When the gateway is connected and an image host is configured (custom upload endpoint or GitHub repository, both uploaded through the gateway; see “图床” in gateway/README.md), new images are uploaded directly and their URLs are written to the document. If no host is configured, the app asks once when inserting an image. | Batch upload of existing local images (`transfer` still returns `not-supported` for uploads), and image hosting without a gateway |
| Import / export | Open .md files by importing them as new library documents, or edit in place when already in the macOS library. Save as .md, or export HTML with inline images for documents with at most 20,000 lines and 1 million characters. | PDF was deferred pending confirmation |
| Formulas | Typeset with TextView. Reading as plain text causes the built-in serializer to escape `_` and `\\` incorrectly, as observed in testing. | — |
| Mermaid | Render vendored Mermaid 12.3.0 from `assets/vendor/mermaid/` in a hidden WebView and display the resulting SVG as an image (`src/features/editor/mermaid.tsx`). The bundled renderer loads only when a diagram is present. Syntax errors show the source and reason, and HTML export inlines diagrams as images. | Wide diagrams such as Gantt charts currently scale proportionally on narrow screens, with no horizontal scrolling |

## Open Questions

- Sync destination: Gist (chosen provisionally) or a user-selected repository.
- OAuth App: A dedicated Pairdown App and the `pairdown-auth` Worker were set up and verified in production on 2026-11-25. The site domain is markdown.pairwise.site.
- GitHub client secret rotation: The secret appeared in plaintext in a conversation and in one full-screen capture. Rotation was recommended. Its status is unknown.
- Two first-sync confirmation defaults: All entries are checked initially. Choosing “先不上传” leaves the document eligible for sync so the prompt appears again next time.
- Mermaid: The user approved vendoring Mermaid on 2026-11-25, after which diagrams were rendered as images. With `capabilities.webview`, WebView works on the web in a sandboxed iframe. Earlier `available()` tests returned false, likely because the capability was missing according to the types. The package adds 5.5 MB (about 1.2 MB compressed over the network, downloaded only when a document contains a diagram). Keeping it is pending confirmation.
- The Mermaid renderer sets `capabilities.webview.hosts: []` in `nsh.json` to prevent navigation to any site. The nsh sandbox does not forbid navigation, and in-page CSP does not control it. Whether the empty list blocks navigation or an `html` load in macOS WKWebView still needs window testing. Until then, the app relies on validating the returned SVG (see `.claude/rules/security.md`). On 2026-11-25 a malicious chart did not trigger a popup in the real window, but navigation with an empty list was not tested separately.
- Clipboard permissions: `"clipboard": true` in `nsh.json` grants both read and write. The app reads the clipboard only for “粘贴为纯文本” on macOS. Keeping read access is undecided.
- Centered images use `<img align="center">`. GitHub may render them left-aligned. The final markup is undecided.
- The macOS caret is too tall next to an image, possibly because the host applies a line-height multiplier to the whole line. Options are to add a block image node with round-trip rules or report a host issue to nsh.
- Formulas currently export to HTML as raw TeX. Typesetting would require a dependency such as KaTeX, pending a decision.
- The native macOS title bar is white in dark mode, and nsh has no window appearance API. A custom title bar is undecided.
- CI: GitHub Actions deployment requires two Cloudflare repository secrets and a `main` branch. Both requirements were unmet at the time of writing.
- Top-level `gateway/`: The direction was approved. The directory name and layering await user confirmation (plan §9).
- Visual direction: M1 followed the pairwise.site brand provisionally, with teal and light/dark themes defined only in `theme.json`. User approval is pending. The provisional application ID is `site.pairwise.md`.
- See plan §7 for other pending items, including switching to repository sync for images, macOS folder selection and Save As, PDF export, and leaving out “光标在格式内显示淡色符号.”
