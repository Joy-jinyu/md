/** 标题升降一级（Cmd+= / Cmd+-）。 */
import { command, type RichEditorSession } from "nsh/base";

/**
 * 标题升降一级后的级别（`null` 是正文段落）。升级：H3 → H2，H1 不变，段落 → H6；
 * 降级：H2 → H3，H6 → 段落，段落不变。
 */
export function stepHeading(level: number | null, direction: "up" | "down"): number | null {
  if (direction === "up") return level === null ? 6 : Math.max(1, level - 1);
  if (level === null || level === 6) return null;
  return level + 1;
}

/** 对光标所在的段落或标题升降一级；在别的块里（代码块、表格）什么也不做。 */
export function runHeadingStep(session: RichEditorSession, direction: "up" | "down") {
  const heading = session.isActive("heading");
  if (!heading && !session.isActive("paragraph")) return;
  const raw = heading ? (session.getAttributes("heading") as { level?: unknown }).level : null;
  const next = stepHeading(typeof raw === "number" ? raw : null, direction);
  session.run(next === null ? command("setParagraph") : command("setHeading", { level: next }));
}
