# nsh debt

Limitations and bugs in nsh that Pairdown works around. Each entry says what we do instead, how we know, and how to
tell when it is gone. The project pins nsh v0.7.0 (`.github/workflows/deploy.yml`, `NSH_VERSION`).

## How the check works

`.github/workflows/nsh-debt.yml` runs every day at 01:17 UTC (and on demand) against the latest nsh release and the
nightly build. It runs `.github/nsh-debt/check.mjs`, which gives each entry below one of these results:

| Result | Meaning | What to do |
| --- | --- | --- |
| still | The probe still sees the problem | Nothing |
| changed | The probe no longer sees it | Confirm the fix by hand, then update or remove the entry and the workaround |
| error | The probe itself could not run | Fix the probe |
| manual | There is no automated probe | Recheck by hand when upgrading nsh |

The run fails when any entry is `changed` or `error`, so a red run means "look at the summary". Run it locally with
`make nsh-debt` (it uses whatever `nsh` is installed).

Probe kinds: a test in `.github/nsh-debt/probes/` that passes while the problem exists; a check of the type
declarations `nsh check` writes to `.nsh/types/`; the state of an upstream issue; whether an upstream fix is in a
release. The probes live under `.github/` because `nsh test .` skips hidden directories, so `make test` never runs them.

Every `### ND-…` heading here must have a probe entry in `check.mjs` (`manual` counts), and the other way round; the
script reports a mismatch as an error.

## Entries

### ND-01 The built-in Markdown reader and writer lose content

- **Workaround**: Our own conversion layer: `TextView.parse` to read, our serializer to write (`src/doc/`,
  `src/features/editor/parse.ts`).
- **Evidence**: 2026-11-24 and rechecked 2026-11-26 on v0.7.0: `createRichEditor({ format: "markdown" })` +
  `getMarkdown()` turns front matter into a heading, drops footnote references and definitions, escapes `<u>`, and
  drops the info after a code fence's language.
- **Probe**: `probes/markdown-roundtrip.test.ts`.
- **When it changes**: Replacing our layer is an owner decision; the round-trip guarantees in `CLAUDE.md` still apply.

### ND-02 A single JS call is interrupted after 2000 ms

- **Workaround**: Heavy work is split or capped: replace-all runs in batches (`REPLACE_BATCH` in
  `src/features/editor/find.ts`), long documents are sliced, and documents over the `RICH_MAX_*` limits in
  `src/features/editor/EditorScreen.tsx` open in source mode.
- **Evidence**: v0.7.0 reports `a call into JS exceeded its budget of 2000 ms`; a 2.6 s loop in a test is interrupted
  (2026-11-26).
- **Probe**: `probes/js-budget.test.ts` (looks for the budget message in the output).
- **When it changes**: Revisit the batch size, the slicing and the `RICH_MAX_*` limits.

### ND-03 No keychain or secure storage

- **Workaround**: The GitHub token is stored in plain text in nsh `Storage`; the settings page says so
  (`.claude/rules/security.md`).
- **Evidence**: No such API in `.nsh/types/` for v0.6.0 or v0.7.0 (2026-11-25).
- **Probe**: Type declarations gain an export named like `Keychain`, `SecureStorage` or `Credential`.
- **When it changes**: Move the macOS token into it.

### ND-04 No save dialog

- **Workaround**: Save As writes to the browser's downloads, or to `~/Downloads` on macOS (`src/platform/index.ts`).
- **Evidence**: `.nsh/types/` for v0.7.0 has `Picker.pickFiles` / `pickImages` only (2026-11-25).
- **Probe**: Type declarations gain a function named like `saveFile`, `pickSave…` or `showSaveDialog`.
- **When it changes**: Let the user choose where Save As and Export HTML go.

### ND-05 No file watching

- **Workaround**: On macOS the open document and the list are compared when the window regains focus
  (`watchLifecycle` in `src/features/editor/EditorScreen.tsx`); the web gateway watches files itself.
- **Evidence**: `fs/promises` in `.nsh/types/` has no `watch` (v0.7.0, 2026-11-25).
- **Probe**: `.nsh/types/fs/` gains `watch(`.
- **When it changes**: Push external changes on macOS as the gateway does.

### ND-06 No window appearance option (white title bar in dark mode on macOS)

- **Workaround**: None yet; drawing our own title bar is an open decision (`CLAUDE.md`, open questions).
- **Evidence**: `TitleBarOptions.style` is only `"default" | "hidden"`; windows have no appearance or color-scheme
  option (v0.7.0).
- **Probe**: `.nsh/types/nsh/desktop.d.ts` gains a field named `appearance`, `colorScheme`, `titleBarAppearance` or
  `titleBarColor`.
- **When it changes**: Follow the app's light or dark mode in the title bar.

### ND-07 The clipboard capability cannot be split into read and write

- **Workaround**: `"clipboard": true` grants both; the app reads only for macOS "paste as plain text"
  (`.claude/rules/security.md`).
- **Evidence**: An app declaring `{ "read": false, "write": true }` opens with the warning
  `capabilities.clipboard must be a boolean` and no clipboard access (v0.7.0, 2026-11-26). The check happens when the
  app loads its capabilities, not in `nsh check`.
- **Probe**: `clipboard-object/` (looks for the warning in the output).
- **When it changes**: Grant write only, if reading can be dropped or granted separately.

### ND-08 `TextView.parse` with `html: true` drops an `<img>`'s `align`

- **Workaround**: Our own `<img>` reader and writer (`src/doc/img-tag.ts`).
- **Evidence**: `TextView.parse('<img src="a.png" align="center">', { html: true })` keeps `src` but not `align`
  (v0.7.0, 2026-11-26). Recorded with two more `TextView.parse` gaps not probed here: an `<img>` inside link text
  reads as text, and a lone HTML line inside a list item or quote reads as paragraph text.
- **Probe**: `probes/img-align.test.ts`.
- **When it changes**: Check whether `img-tag.ts` can go.

### ND-09 No `Intl.Segmenter`

- **Workaround**: Select-word falls back to our own word splitting (`src/features/editor/select.ts`).
- **Evidence**: `typeof Intl.Segmenter` is `"undefined"` (v0.7.0, 2026-11-26).
- **Probe**: `probes/intl-segmenter.test.ts`.
- **When it changes**: Chinese word selection gets the engine's segmenter without code changes; drop the fallback
  if it is no longer needed.

### ND-10 Test files of an app with a Rust nshm run one at a time

- **Workaround**: The switch to `nsh-icon` waits on the local branch `feat/nsh-icon`: with it, the suite takes about
  3 minutes instead of 30 seconds.
- **Evidence**: Fixed upstream in [longbridge/nsh#3281](https://github.com/longbridge/nsh/pull/3281), merged
  2026-11-25; not in v0.7.1.
- **Probe**: Whether the PR's merge commit is in the latest release (or in `nightly`, for the nightly run).
- **When it changes**: Upgrade nsh locally and in CI, then land `feat/nsh-icon`.

### ND-11 Cmd+Shift+Z does not reach the keymap on macOS

- **Impact**: Probably redo in the editor on macOS. **Not reproduced in Pairdown yet.**
- **Evidence**: Upstream [longbridge/nsh#3245](https://github.com/longbridge/nsh/issues/3245).
- **Probe**: The issue is open.
- **When it changes**: Check redo in a macOS window.

### ND-12 A copy cannot keep the document's structure

- **Impact**: Possibly copy and "copy as Markdown" (`src/features/editor/copy-markdown.ts`). **Not reproduced in
  Pairdown yet.**
- **Evidence**: Upstream [longbridge/nsh#3284](https://github.com/longbridge/nsh/issues/3284).
- **Probe**: The issue is open.
- **When it changes**: Recheck copying a selection that spans blocks.

### ND-13 In headless tests, `clear` does not empty a code `Editor`

- **Impact**: Tests of the source view. **Not reproduced in Pairdown yet.**
- **Evidence**: Upstream [longbridge/nsh#3246](https://github.com/longbridge/nsh/issues/3246).
- **Probe**: The issue is open.
- **When it changes**: Simplify source-view tests that work around it, if any.

### ND-14 One file write is limited to 8 MiB

- **Workaround**: Documents and images over 8 MiB are refused on macOS (`MAX_FILE_BYTES` in
  `src/platform/macos/file-store.ts`); elsewhere images may be up to 10 MiB.
- **Evidence**: `ERR_OUT_OF_RANGE` above 8 MiB in the macOS library (v0.6.0, 2026-11-25).
- **Probe**: Manual. Write a 9 MiB file into the library in a macOS window.

### ND-15 Files opened with the app are not readable

- **Workaround**: Files outside the library are imported as copies.
- **Evidence**: `ERR_ACCESS_DENIED` for a file passed by "Open With" (v0.6.0, 2026-11-25).
- **Probe**: Manual. Open a `.md` outside `~/Documents/Pairdown` with the packaged app.

### ND-16 Images and `fetch` share the network capability

- **Workaround**: `network.http` allows `GET` to any host so remote images load; on the web a response header
  narrows `connect-src` again (`scripts/web-headers.mjs`, `.claude/rules/security.md`).
- **Evidence**: v0.6.0 and v0.7.0 have no image-only capability (2026-11-25).
- **Probe**: Manual. Look for an image-specific capability in the release notes and docs.

### ND-17 Rich editing gets slower with document size

- **Workaround**: Documents over the `RICH_MAX_*` limits open in source mode.
- **Evidence**: Measurements next to the limits in `src/features/editor/EditorScreen.tsx` (v0.7.0, 2026-11-25).
- **Probe**: Manual. Re-run those measurements after upgrading before raising the limits.

### ND-18 A Rust nshm adds toolchain cost

- **Impact**: Rust is required; the first test run built the runner in about 3 min 20 s and the first web package
  took about 4 min. On macOS the web package needed `CC_wasm32_unknown_unknown` pointed at Homebrew's LLVM `clang`,
  because Apple's `clang` has no wasm32 target (2026-11-25).
- **Probe**: Manual. Time `make build-web` with `nsh-icon` on a clean machine and in CI.

### ND-19 The web build is large

- **Impact**: `nsh.wasm` is about 10 MB before compression; the packaged site was 18.3 MB with `nsh-icon`
  (2026-11-25). Compressed transfer size was not measured.
- **Probe**: Manual. Measure transfer size and first load after upgrading.

### ND-20 Headless tests do not load images, and module stand-ins keep data only

- **Workaround**: Image tests check addresses and stored bytes, not pixels; stand-ins return plain data.
- **Evidence**: v0.6.0: stand-ins lose methods, `Uint8Array` arrives as an object, error codes are replaced
  (2026-11-25).
- **Probe**: Manual.

### ND-21 The caret is too tall next to an inline image on macOS

- **Workaround**: None; options are listed in `CLAUDE.md` (open questions). Suspected host issue, not reported
  upstream.
- **Probe**: Manual. Put the caret beside an image in a macOS window.
