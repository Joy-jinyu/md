/** 「打开文件」和「另存为」：接请求、选文件、替换前确认、做完后在页面顶上说一句结果。放在编辑页最外层。 */
import { effect, Picker, signal, Text, untracked, View } from "nsh";
import { Dialog } from "nsh/base";
import { saveTextFile } from "../../platform";
import { latestDocument, replaceDocument } from "../../store/document";
import { Button } from "../../ui/button";
import { Notice } from "../../ui/notice";
import { fileNameFor } from "./file-name";
import { fileRequest } from "./requests";

/** 回执（存到哪了、打开了哪个）留多久自己消失（毫秒）；出错的提示不自己消失。 */
const RECEIPT_MS = 8000;
/** 能打开的文件最大多少字节。存储和编辑器都按一整篇字符串处理，再大读进来也用不了。 */
const MAX_OPEN_BYTES = 32 * 1024 * 1024;
const MARKDOWN_FILES = [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] }];

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Picked {
  name: string;
  text: string;
}

/** 读出来的文字里有这些，说明文件不是 UTF-8 文本（解码不了的字节会变成 U+FFFD；正常文本里不会有 NUL）。 */
const NOT_TEXT = /[\uFFFD\u0000]/;

/**
 * 弹系统的文件选择框，读出选中的那个文件。用户取消时是 null；读不了、太大、不是文本时抛带说明的错。
 * 选择框的类型过滤只是建议（系统可能让用户选别的），所以读出来还要自己查是不是文本。
 */
async function pickMarkdown(): Promise<Picked | null> {
  const first = (await Picker.pickFiles({ filters: MARKDOWN_FILES, maxSize: MAX_OPEN_BYTES }))[0];
  if (!first) return null;
  if (first.status === "tooLarge" || !first.file) throw new Error(`「${first.name}」太大了（超过 32 MB）`);
  const text = await first.file.text();
  if (NOT_TEXT.test(text)) throw new Error(`「${first.name}」不是 UTF-8 编码的文本（可能是别的编码，或者不是文本文件）。先用别的工具转成 UTF-8 再打开`);
  return { name: first.name, text };
}

function createFileActions(onReplaced: () => void) {
  const message = signal<{ text: string; tone: "info" | "warn" } | null>(null);
  /** 选好了、等用户确认要不要替换当前文档的那个文件。 */
  const pending = signal<Picked | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string, tone: "info" | "warn") => {
    if (timer) clearTimeout(timer);
    message.set({ text, tone });
    if (tone === "info") timer = setTimeout(() => message.set(null), RECEIPT_MS);
  };
  /** 另存当前文档。返回 null 是没存成（已经在页面顶上说了），否则是能不能确定文件已经落盘。 */
  const saveAs = async (): Promise<{ confirmed: boolean } | null> => {
    try {
      const text = latestDocument();
      const saved = await saveTextFile(fileNameFor(text), text);
      say(saved.message, "info");
      return saved;
    } catch (e) {
      console.error("save as failed", e);
      say(`没能另存：${messageOf(e)}`, "warn");
      return null;
    }
  };
  const replaceWith = async (file: Picked) => {
    pending.set(null);
    const result = await replaceDocument(file.text);
    if (!result.ok) return say(`没能打开「${file.name}」：${result.error.quota ? "本机存储已满" : result.error.detail}。当前文档没有变。`, "warn");
    say(`已打开「${file.name}」`, "info");
    onReplaced();
  };
  const open = async () => {
    try {
      const file = await pickMarkdown();
      if (!file) return;
      const current = latestDocument();
      // 当前是空的、或者和要打开的一模一样，就没有东西会丢，不用问
      if (current.trim() === "" || current === file.text) return await replaceWith(file);
      pending.set(file);
    } catch (e) {
      console.error("open file failed", e);
      say(`没有打开：${messageOf(e)}。当前文档没有变。`, "warn");
    }
  };
  /**
   * 先把当前文档另存，再替换。只有确定文件已经落盘（桌面应用）才自动替换；
   * 浏览器里只是把下载交出去了，用户可能在保存框里点了取消，所以留在确认框，等用户看到文件存好了自己点「替换」。
   */
  const saveThenReplace = async (file: Picked) => {
    const saved = await saveAs();
    if (saved?.confirmed) return replaceWith(file);
    if (saved) say("已把当前文档交给浏览器下载。确认文件存好以后，再点「替换」。", "warn");
  };
  return { message, pending, open, saveAs, replaceWith, saveThenReplace, cancel: () => pending.set(null) };
}

/** `onReplaced`：文档已经换成另一篇并写进了存储，编辑页该重新载入了。 */
export function FileActions(props: { onReplaced: () => void }) {
  const actions = createFileActions(props.onReplaced);
  effect(() => {
    const request = fileRequest();
    if (!request) return;
    untracked(() => {
      fileRequest.set(null);
      void (request.kind === "open" ? actions.open() : actions.saveAs());
    });
  });
  return (
    <>
      <If when={actions.message()}>{(m) => <Notice testID="file-message" message={m().text} tone={m().tone} />}</If>
      <Dialog
        testID="replace-confirm"
        open={actions.pending() !== null}
        animation="fade"
        accessibilityLabel="替换当前文档"
        closeOnEscape
        closeOnBackdropPress
        onOpenChange={({ open }) => !open && actions.cancel()}
        backdropClass="bg-scrim"
        class="mx-auto mt-32 w-full max-w-[440px] px-4"
      >
        <If when={actions.pending()}>
          {(file) => (
            <View class="gap-3 rounded-(--radius) border border-border bg-popover p-4">
              <Text class="text-sm font-medium text-strong">用「{file().name}」替换当前文档？</Text>
              <Text class="text-xs leading-5 text-muted-foreground">当前文档只存在这台设备的这个应用里，替换后找不回来。要留一份的话先另存。</Text>
              <View class="flex-row flex-wrap justify-end gap-1">
                <Button testID="replace-cancel" label="取消" onPress={actions.cancel} />
                <Button testID="replace-save-first" label="先另存，再替换" onPress={() => void actions.saveThenReplace(file())} />
                <Button testID="replace-now" label="替换" variant="primary" onPress={() => void actions.replaceWith(file())} />
              </View>
            </View>
          )}
        </If>
      </Dialog>
    </>
  );
}
