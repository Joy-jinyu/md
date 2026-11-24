/** 线条图标：24 点网格上的路径，线宽 2、圆头（画法和路径取自 Lucide，ISC 许可）。顶栏的图标按钮用。 */
import { Canvas, Path2D, token } from "nsh";

const ICONS = {
  sun: ["M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0", "M12 2v2", "M12 20v2", "M4.93 4.93l1.41 1.41", "M17.66 17.66l1.41 1.41", "M2 12h2", "M20 12h2", "M6.34 17.66l-1.41 1.41", "M19.07 4.93l-1.41 1.41"],
  moon: ["M12 3a6 6 0 0 0 9 9a9 9 0 1 1-9-9z"],
  /** 左边带一栏的面板：大纲侧栏。 */
  sidebar: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M9 3v18"],
  folderOpen: [
    "M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
  ],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5l5-5", "M12 15V3"],
  settings: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0",
  ],
  close: ["M18 6L6 18", "M6 6l12 12"],
} as const;

export type IconName = keyof typeof ICONS;

const PATHS = Object.fromEntries(Object.entries(ICONS).map(([name, paths]) => [name, paths.map((d) => new Path2D(d))])) as Record<IconName, Path2D[]>;

/** 图标能用的颜色角色（theme.json 里的名字，跟着明暗变）。 */
type IconColor = "strong" | "muted-foreground" | "primary";

/** 图标，默认 `strong` 色。只是装饰，读屏不读它：按钮自己要有名字。 */
export function Icon(props: { name: IconName; size?: number; color?: IconColor }) {
  const size = () => props.size ?? 16;
  return (
    <Canvas
      accessible={false}
      style={{ width: size(), height: size() }}
      draw={(cx) => {
        cx.scale(size() / 24, size() / 24);
        cx.strokeStyle = String(token(props.color ?? "strong"));
        cx.lineWidth = 2;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        for (const path of PATHS[props.name]) cx.stroke(path);
      }}
    />
  );
}
