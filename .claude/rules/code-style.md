# Code style

See `CONTRIBUTING.md` for details. This file lists the checks. The user's global `~/.claude/rules/coding-style.md` is the authoritative source for general code style. Supply multiple patterns with `-e` to avoid a `|` in check commands.

| Rule | Level | How to check |
|------|-------|--------------|
| Keep files at or below 800 lines, functions at or below 50 lines, and nesting at or below four levels. | L2 | Review |
| Use only color roles from `theme.json`. Avoid hex values, palette classes, and `dark:`. | L1 | `rg -n -e '#[0-9a-fA-F]{3,8}\b' -e 'dark:' -e '\bbg-[a-z]+-[0-9]{2,3}\b' -e '\btext-[a-z]+-[0-9]{2,3}\b' -e '\bborder-[a-z]+-[0-9]{2,3}\b' src`. The last three patterns check for classes that combine a color name and a number. The command can be copied as-is. |
| Replace objects and arrays with new values. | L2 | Review |
| Do not leave `catch` blocks empty. | L1 | `rg -n -U 'catch\s*(\(\w*\))?\s*\{\s*\}' src` and `rg -n '\.catch\(\s*\(\w*\)\s*=>\s*\{\s*\}\s*\)' src` |
| Use comments only for conventions, counterintuitive decisions, sources for numbers, and pointers to authoritative definitions. | L3 | Review |
