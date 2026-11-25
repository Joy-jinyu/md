/**
 * 节点视图里的按钮（目录项、脚注、front matter 展开、图片占位里的按钮）：nsh 0.7.0 上，上一下点击不在编辑器里时（刚打开文档、刚从侧栏跳过来），
 * 这一下点在节点视图上只报 onMouseUp，不报 onPress（2026-11-25 web host 实测；0.6.0 照常报 onPress）。
 * 所以松开左键后等一会儿，没等到 onPress 就照按下处理——只限「按下时就在这个按钮上」：从正文拖选过来、松在按钮上的不算。
 * 按钮上报不报 onPressDown 不一定（包着 Button 的 View 收不到），所以按鼠标进来时有没有按着键分：拖过来的进来时按着左键（2026-11-25 web host 实测）。
 * 要在组件渲染时调；`onPress` 给按钮，`mouse` 放在按钮本身或包着它的 View 上。
 */
import { cleanup, type MouseEvent } from "nsh";

/** 松开鼠标后等多久还没等到 onPress，就当这一下没报（毫秒）：正常时 onPress 紧跟在 onMouseUp 后面（同一帧里）。 */
const PRESS_GRACE = 80;

export function nodePress(act: () => void) {
  let pressed = false;
  /** 左键是在按钮上按下的：鼠标空着手进来（或在上面空着手动过）。一开始算是，免得鼠标本来就停在按钮上时第一下没反应。 */
  let downHere = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  cleanup(() => clearTimeout(timer));
  return {
    onPress: () => {
      pressed = true;
      act();
    },
    mouse: {
      onMouseEnter: (e: MouseEvent) => {
        downHere = e.pressedButton === null;
      },
      onMouseMove: (e: MouseEvent) => {
        if (e.pressedButton === null) downHere = true;
      },
      onMouseLeave: () => {
        downHere = false;
      },
      onMouseUp: (e: MouseEvent) => {
        if (e.button !== "left") return;
        pressed = false;
        clearTimeout(timer);
        if (downHere) timer = setTimeout(() => pressed || act(), PRESS_GRACE);
      },
    },
  };
}
