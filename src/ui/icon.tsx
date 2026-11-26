/** 线条图标：24 点网格上的路径，线宽 2、圆头（画法和路径取自 Lucide，ISC 许可）。顶栏的图标按钮用。 */
import { Canvas, Path2D, token } from "nsh";

const ICONS = {
  sun: ["M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0", "M12 2v2", "M12 20v2", "M4.93 4.93l1.41 1.41", "M17.66 17.66l1.41 1.41", "M2 12h2", "M20 12h2", "M6.34 17.66l-1.41 1.41", "M19.07 4.93l-1.41 1.41"],
  moon: ["M12 3a6 6 0 0 0 9 9a9 9 0 1 1-9-9z"],
  /** 左边带一栏的面板：侧栏（文档、大纲）。 */
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
  plus: ["M5 12h14", "M12 5v14"],
  /** 两个转圈的箭头：同步（顶栏窄的时候同步入口只剩它）。 */
  refresh: ["M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"],
  /** 横着的三个点：一行的更多操作。 */
  /** 一上一下两个箭头：切换排序。 */
  arrowUpDown: ["M21 16l-4 4l-4-4", "M17 20V4", "M3 8l4-4l4 4", "M7 4v16"],
  ellipsis: ["M13 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0", "M20 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0", "M6 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0"],
  /** 两张叠着的纸：复制。 */
  copy: ["M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z", "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"],
  /** 对勾：复制成了。 */
  check: ["M20 6L9 17l-5-5"],
  chevronLeft: ["M15 18l-6-6l6-6"],
  chevronRight: ["M9 18l6-6l-6-6"],
  chevronDown: ["M6 9l6 6l6-6"],
  /** 设置的分类：快捷键、存储、本机网关、图床。 */
  keyboard: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M6 8h.01", "M10 8h.01", "M14 8h.01", "M18 8h.01", "M8 12h.01", "M12 12h.01", "M16 12h.01", "M7 16h10"],
  hardDrive: ["M22 12H2", "M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z", "M6 16h.01", "M10 16h.01"],
  plug: ["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"],
  image: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M11 9a2 2 0 1 1-4 0a2 2 0 1 1 4 0", "M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"],
  /** 地球：设置的「语言」。 */
  globe: ["M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0", "M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20", "M2 12h20"],
  /** 逆时针的箭头：恢复默认。 */
  rotateCcw: ["M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
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
