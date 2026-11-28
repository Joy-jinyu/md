# PR: Centralize Error Handling and Improve Documentation

This PR introduces a unified error handling infrastructure and adds documentation improvements across the codebase.

## Summary

- **Unified Error Handling**: Introduce `handleError()` utility to replace scattered `console.warn/error()` calls with consistent logging and context
- **IME Verification**: Analyze and document Chinese IME input handling (existing `session.composing` guard is sufficient)
- **Code Documentation**: Add standardized comments for debounce constants and accessibility guidelines

## Changes

### 1. Error Handling Infrastructure (`src/doc/message.ts`)

Added `handleError()` function with severity levels (`error`/`warn`/`debug`) to standardize error logging:

```ts
export function handleError(e: unknown, options: HandleErrorOptions): string {
  const message = messageOf(e);
  const severity = options.severity ?? "warn";
  // Logs to console with consistent format, returns message for UI
}
```

### 2. Migrated Error Handling (20+ locations)

**features/editor/** (15 files)
- `images.ts`, `caret-follow.tsx`, `EditorScreen.tsx`, `BlockOverlays.tsx`
- `ImageView.tsx`, `RichDocument.tsx`, `ConflictBar.tsx`
- `copy-markdown.ts`, `image-host.ts`, `keys.ts`, `links.ts`
- `mermaid-queue.ts`, `parse.ts`, `paste.ts`, `source-view.ts`

**features/files/**
- `FileActions.tsx` (open/save-as/export-html errors)
- `export-html.ts` (image inlining)

**features/library/**
- `actions.ts` (remove/rescue/request)
- `external.ts` (library refresh/external check)
- `panel-state.ts` (search)
- `StorageNotice.tsx`, `DocDialogs.tsx`

**features/settings/**
- `ImageHostForm.tsx`, `ImageHostSection.tsx`, `StoragePanel.tsx`

**features/sync/**
- `SyncAccount.tsx`, `SyncHost.tsx`, `engine.ts`, `resolve.ts`

All migrations preserve existing UI messages while unifying console logging format.

### 3. Chinese IME Verification

Analyzed typing flow in `typing.ts`:
- Existing `session.composing` guard in `convertTyped()` prevents format conversions during IME composition
- No code changes needed; added verification checklist in learning docs

### 4. Documentation Improvements

**Debounce Constants** (3 files)
Added standardized comments:
```ts
// 延迟参数：实测于 2026-11-25，详见 DESIGN.md「延迟参数」
const STATS_DELAY = 300;
```

Files: `RichDocument.tsx`, `SourceDocument.tsx`, `mermaid.tsx`

**Accessibility Guidelines**
Created `docs/a11y-alert-guidelines.md` documenting role usage:
- `role="alert"` for critical warnings (conflicts, connection loss)
- `role="status"` or no role for informational messages

## Verification

- **Type Check**: `make check` passes
- **Tests**: `make test` - 574/574 passed
- **Behavior**: User-facing messages unchanged; only internal logging unified

## Migration Notes

The `handleError()` utility returns the error message (via `messageOf()`) for use in UI notifications while logging with consistent context. This enables future enhancements (e.g., centralized error reporting) by modifying a single location.

---

**Type**: `feat` (infrastructure improvement)

**Scope**: error-handling, documentation
