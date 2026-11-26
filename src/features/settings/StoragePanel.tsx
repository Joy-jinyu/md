/** 设置里的「存储」一类：现在文档、图片存在哪，以及把浏览器里的文档复制进网关的文库。布局见 DESIGN.md「屏幕：设置」。 */
import { type Phrase, phrase, t } from "../../i18n";
import { signal, Text, View } from "nsh";
import { messageOf } from "../../doc/message";
import { copyBrowserDocsToLibrary, type CopyReport, storageKind } from "../../store/backend";
import { DEFAULT_PORT } from "../../store/gateway-store";
import { docsInIndexedDb } from "../../store/kv";
import { refreshLibrary } from "../../store/library";
import { Button } from "../../ui/button";

function summary(): { title: string; detail: string } {
  const k = storageKind();
  if (k.kind === "files") return { title: t(`文库文件夹：${k.folder}`, `Library folder: ${k.folder}`), detail: t("这个文件夹里（含子文件夹）的每个 .md 文件是一篇文档。别的程序改了文件，回到这个窗口时会比对：这里没改过就直接载入，改过就让你选保留哪一边。", "Each .md file in this folder or its subfolders is a document. When you return to this window, Pairdown checks for changes made elsewhere. If both copies changed, it asks which one to keep.") };
  if (k.kind === "gateway") {
    const state = k.gateway.link().state === "connected" ? t("已连接", "Connected") : t("断开了，正在重连", "Disconnected. Reconnecting…");
    return { title: t(`本机网关：文库「${k.gateway.library()}」`, `Local gateway library: ${k.gateway.library()}`), detail: t(`文档是这个文库文件夹里的 .md 文件（网关地址 ws://127.0.0.1:${DEFAULT_PORT}，${state}）。版本历史和关页面前的应急存储仍放在这个浏览器里。`, `Documents are .md files in the library (gateway: ws://127.0.0.1:${DEFAULT_PORT}, ${state}). Version history and recovery copies stay in this browser.`) };
  }
  return {
    title: t("浏览器本地", "Browser storage"),
    detail: docsInIndexedDb()
      ? t("文档存在这个浏览器里（IndexedDB）。清掉这个网站的浏览器数据，文档会一起删掉；换浏览器也看不到。", "Documents are saved in this browser’s IndexedDB. Clearing site data deletes them, and they are unavailable in other browsers.")
      : t("文档存在这个应用的本机存储里，所有文档和设置合计不能超过 5 MB。", "Documents are saved in local app storage. Documents and settings share a 5 MB limit."),
  };
}

function reportText(r: CopyReport): string {
  const parts = [r.copied.length > 0 ? t(`复制了 ${r.copied.length} 篇到文库：${r.copied.join("、")}。`, `Copied to the library (${r.copied.length}): ${r.copied.join(", ")}.`) : t("没有复制任何文档。", "No documents were copied.")];
  if (r.same.length > 0) parts.push(t(`${r.same.length} 篇文库里已经有一样的：${r.same.join("、")}。`, `Already in the library (${r.same.length}): ${r.same.join(", ")}.`));
  if (r.failed.length > 0) parts.push(t(`${r.failed.length} 篇没能复制：${r.failed.join("、")}。`, `Could not copy (${r.failed.length}): ${r.failed.join(", ")}.`));
  if (r.imagesFailed.length > 0) parts.push(t(`${r.imagesFailed.length} 篇的图片没能全部复制：${r.imagesFailed.join("、")}，文库里那篇缺的图显示「找不到图片」。浏览器里的那份连同图片都还在，可以再点一次补上。`, `Some images were not copied (${r.imagesFailed.length} documents): ${r.imagesFailed.join(", ")}. Missing images are marked in the library copy. The browser originals still have their images, so you can retry.`));
  return parts.join("");
}

function CopyToLibrary() {
  const running = signal(false);
  const result = signal<Phrase>("");
  const copy = async () => {
    running.set(true);
    try {
      const report = await copyBrowserDocsToLibrary();
      result.set(() => reportText(report));
      await refreshLibrary();
    } catch (e) {
      console.error("copy to library failed", e);
      result.set(() => t(`没能复制：${messageOf(e)}`, `Could not copy: ${messageOf(e)}`));
    } finally {
      running.set(false);
    }
  };
  return (
    <View class="gap-2">
      <Text class="select-text text-xs leading-5 text-muted-foreground">{t("连上网关之前写在这个浏览器里的文档不会自动搬过去。需要的话复制一份到文库（文件名取标题；文库里已有同名的不覆盖，内容一样的不再复制，不一样的名字后面加序号；浏览器里的那份留着，版本历史复制一份；连着 GitHub 的那篇以后由文库里的这份同步，浏览器里的记成「不同步」）：", "You can copy existing browser documents and their version history to the gateway library. Pairdown uses document titles as filenames, skips identical copies, and adds a number when a name is taken. The browser originals stay here. Any GitHub sync moves to the library copy.")}</Text>
      <View class="flex-row">
        <Button testID="copy-to-library" label={running() ? t("正在复制…", "Copying…") : t("把浏览器里的文档复制到文库", "Copy browser documents to the library")} disabled={running()} onPress={() => void copy()} />
      </View>
      <If when={result()}>
        {(text) => (
          <Text testID="copy-result" role="alert" class="select-text text-xs leading-5 text-foreground">
            {phrase(text())}
          </Text>
        )}
      </If>
    </View>
  );
}

/** 图片存在哪、外链图片能不能转存（DESIGN.md「M3：图片」）。 */
const IMAGES_WHERE: Record<string, string> = {
  get local() { return t("粘贴、插入的图片存在这个浏览器里（IndexedDB），按文档存，删文档时一起删；另存的 .md 里不包含它们。外链图片直接显示，但不能转存到本地（要连着本机网关）。图床要连着本机网关才能用。", "Pasted and inserted images are stored with each document in this browser and deleted with it. Exported .md files do not include them. Remote images display directly. Saving them locally and using an image host require the local gateway."); },
  get gateway() { return t("粘贴、插入的图片存在文档旁边的 assets/ 文件夹里，正文写相对路径；设置了图床（见「图床」）就传到图床，正文写图床给的地址。外链图片直接显示，也可以「转存到本地」（由网关下载）。", "Inserted images are saved in assets/ next to the document, with relative paths in Markdown. If you configure an image host, the document uses that host’s URLs instead. The gateway can download remote images for a local copy."); },
  get files() { return t("粘贴、插入的图片存在文档旁边的 assets/ 文件夹里，正文写相对路径。外链图片直接显示；「转存到本地」没有做。图床要连着本机网关才能用（只有网页版能连）。", "Inserted images are saved in assets/ next to the document, with relative paths in Markdown. Remote images display directly. Saving a local copy or using an image host requires the web editor’s local gateway."); },
};

/** `onGoGateway`：网页里用着浏览器本地时，末尾给一个去「本机网关」的按钮。 */
export function StoragePanel(props: { inBrowser: boolean; onGoGateway: () => void }) {
  const now = () => summary();
  return (
    <View testID="storage" class="gap-4">
      <View class="gap-1">
        <Text class="text-[11px] text-faint">{t("现在文档存在", "Current document storage")}</Text>
        <Text testID="storage-kind" class="select-text text-[13px] font-medium text-strong">
          {now().title}
        </Text>
        <Text class="select-text text-xs leading-5 text-muted-foreground">{now().detail}</Text>
      </View>
      <View class="gap-1">
        <Text class="text-[11px] text-faint">{t("图片", "Images")}</Text>
        <Text testID="images-where" class="select-text text-xs leading-5 text-muted-foreground">
          {IMAGES_WHERE[storageKind().kind]}
        </Text>
      </View>
      <If when={storageKind().kind === "gateway"}>
        <CopyToLibrary />
      </If>
      <If when={props.inBrowser && storageKind().kind === "local"}>
        <View class="flex-row flex-wrap items-center gap-2">
          <Text class="select-text text-xs leading-5 text-muted-foreground">{t("想存成电脑上的 .md 文件，装本机网关。", "Install the local gateway to store documents as .md files on your computer.")}</Text>
          <Button testID="storage-go-gateway" label={t("去本机网关", "Open local gateway settings")} onPress={props.onGoGateway} />
        </View>
      </If>
    </View>
  );
}
