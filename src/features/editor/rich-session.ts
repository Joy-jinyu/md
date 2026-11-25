/** 把一篇 Markdown 读进编辑器会话，以及会话上挂的插件。 */
import { createRichEditor, defineExtension, link, RichEditorPlugin, type RichEditorSession, suggestion } from "nsh/base";
import { bindOrigin, dumpMarkdown, loadMarkdown } from "./convert";
import { ImageView } from "./ImageView";
import { carriesDataImages, storeDataImages } from "./images";
import { NODE_VIEWS } from "./node-views";
import { pasteMarkdown } from "./paste";
import { editorExtensions } from "./schema";
import { shortcutsExtension } from "./shortcuts";

/** 各插件的键：斜杠菜单和 emoji 补全的状态、查找高亮、专注模式的明暗、代码高亮都按键存取。 */
export const SLASH_KEY = "slash";
export const FIND_KEY = "mdFind";
export const FOCUS_KEY = "mdFocus";
export const CODE_KEY = "mdCode";
export const EMOJI_KEY = "emoji";

/** 读进编辑器的一篇文档。 */
export interface RichOpened {
  session: RichEditorSession;
  /** 截获快捷键的插件，由编辑页接上处理函数。 */
  keys: RichEditorPlugin;
  /** 写回 Markdown。 */
  dump: () => string;
  /** 换成另一份 Markdown（从源码视图切回来时用）；撤销历史不断。读不进时抛错，会话不变。 */
  load: (markdown: string) => void;
}

/** 把 Markdown 读进一个新会话；转换层或 schema 不认时抛错，由调用方退到源码方式。 */
export function openRich(markdown: string): RichOpened {
  const first = loadMarkdown(markdown);
  const keys = new RichEditorPlugin("mdKeys");
  // 自己的插件要排在 StarterKit 的键表前面才收得到 Enter、Tab、Mod-Enter 这些键（nsh 0.6.0 实测），所以经一个高优先级的扩展挂上去
  const plugins = defineExtension({
    name: "mdPlugins",
    priority: 2000,
    addProseMirrorPlugins: () => [
      suggestion({ key: SLASH_KEY, char: "/", anyPrefix: true, captureKeys: ["ArrowUp", "ArrowDown", "Enter", "Tab"] }),
      suggestion({ key: EMOJI_KEY, char: ":", anyPrefix: true, captureKeys: ["ArrowUp", "ArrowDown", "Enter", "Tab"] }),
      keys,
      new RichEditorPlugin(FIND_KEY),
      new RichEditorPlugin(FOCUS_KEY),
      new RichEditorPlugin(CODE_KEY),
    ],
  });
  const session = createRichEditor({
    content: first.json,
    format: "json",
    extensions: [...editorExtensions({ ...NODE_VIEWS, image: ImageView }), shortcutsExtension(), plugins],
    plugins: [link()],
  });
  keys.handlePaste((_slice, clipboard) => {
    // 编辑器按 HTML 贴完以后再把里面的 data: 图片存进文档库（钩子在粘贴途中被问到，文档等它答完才改）
    if (carriesDataImages(clipboard)) storeDataImages(session);
    return pasteMarkdown(session, clipboard);
  });
  let origin = bindOrigin(first.pending, session.getJSON());
  const load = (next: string) => {
    const { json, pending } = loadMarkdown(next);
    session.setContent(json, "json");
    origin = bindOrigin(pending, session.getJSON());
  };
  return { session, keys, dump: () => dumpMarkdown(session.getJSON(), origin), load };
}
