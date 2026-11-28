/** 设置里的「存储」一类：现在文档、图片存在哪，以及把浏览器里的文档复制进网关的文库。布局见 DESIGN.md「屏幕：设置」。 */
import { type Phrase, phrase, t } from "../../i18n";
import { signal, Text, View } from "nsh";
import { handleError, messageOf } from "../../doc/message";
import { copyBrowserDocsToLibrary, type CopyReport, storageKind } from "../../store/backend";
import type { GatewayBackend } from "../../store/gateway-store";
import { docsInIndexedDb } from "../../store/kv";
import { refreshLibrary } from "../../store/library";
import { Button } from "../../ui/button";
import { Callout, Details, Group, Row, Status } from "./parts";

function FolderRow(props: { folder: string }) {
  return (
    <Row testID="storage-kind" label={t("文库文件夹", "Library folder")} description={t("文件夹里（含子文件夹）的每个 .md 文件是一篇文档。别的程序改了文件，回到窗口时会比对；两边都改过会让你选保留哪一边。", "Each .md file in this folder or its subfolders is a document. Changes made in other apps are picked up when you return to the window; if both copies changed, Pairdown asks which to keep.")}>
      <Text class="select-text font-mono text-[12px] leading-5 text-foreground">{props.folder}</Text>
    </Row>
  );
}

function GatewayRow(props: { gateway: GatewayBackend }) {
  return (
    <Row
      testID="storage-kind"
      label={t(`本机网关 · 文库「${props.gateway.library()}」`, `Local gateway · ${props.gateway.library()}`)}
      description={t("文档是文库文件夹里的 .md 文件。版本历史和关页面前的应急副本仍存在这个浏览器里。", "Documents are .md files in the library folder. Version history and recovery copies stay in this browser.")}
      control={<LinkStatus gateway={props.gateway} />}
    />
  );
}

/** 网关连没连着（本机网关页也用）：连着、断开了正在重连、不再重连。 */
export function LinkStatus(props: { gateway: GatewayBackend }) {
  const state = () => props.gateway.link().state;
  return (
    <If when={state() === "connected"} else={<If when={state() === "stopped"} else={<Status tone="busy" label={t("断开了，正在重连", "Reconnecting…")} />}><Status tone="off" label={t("已断开", "Disconnected")} /></If>}>
      <Status tone="ok" label={t("已连接", "Connected")} />
    </If>
  );
}

function LocalRows(props: { inBrowser: boolean; onGoGateway: () => void }) {
  return (
    <>
      <Row
        testID="storage-kind"
        label={t("浏览器本地", "Browser storage")}
        description={docsInIndexedDb() ? t("文档存在这个浏览器里。清除这个网站的数据会一起删掉，换个浏览器也看不到。", "Documents are saved in this browser. Clearing site data deletes them, and other browsers can’t see them.") : t("文档存在应用的本机存储里，文档和设置合计最多 5 MB。", "Documents are saved in local app storage, with a 5 MB limit for documents and settings together.")}
      />
      <If when={props.inBrowser}>
        <Row
          label={t("存成电脑上的 .md 文件", "Save as .md files on your computer")}
          description={t("装上本机网关后，文档存进你电脑上的一个文件夹，不受浏览器容量限制，别的编辑器和 Git 也能直接用。", "With the local gateway, documents are saved in a folder on your computer, free of browser storage limits and usable by other editors and Git.")}
          control={<Button testID="storage-go-gateway" variant="outline" label={t("设置本机网关", "Set up local gateway")} onPress={props.onGoGateway} />}
        />
      </If>
    </>
  );
}

function DocumentsRow(props: { inBrowser: boolean; onGoGateway: () => void }) {
  const folder = () => {
    const k = storageKind();
    return k.kind === "files" ? k.folder : null;
  };
  const gateway = () => {
    const k = storageKind();
    return k.kind === "gateway" ? k.gateway : null;
  };
  return (
    <If when={folder()} else={<If when={gateway()} else={<LocalRows {...props} />}>{(g) => <GatewayRow gateway={g()} />}</If>}>
      {(f) => <FolderRow folder={f()} />}
    </If>
  );
}

/** 图片存在哪、外链图片能不能转存（DESIGN.md「M3：图片」）。 */
function ImageRows() {
  const where = (): { saved: string; remote: string } => {
    const kind = storageKind().kind;
    if (kind === "local") return { saved: t("粘贴、插入的图片和文档一起存在这个浏览器里，删文档时一起删。另存的 .md 文件不带这些图片。", "Pasted and inserted images are stored in this browser with their document and deleted with it. Exported .md files don’t include them."), remote: t("直接显示。转存到本地、使用图床都需要本机网关。", "Shown directly. Saving local copies and image hosting need the local gateway.") };
    if (kind === "gateway") return { saved: t("存在文档旁边的 assets/ 文件夹里，正文写相对路径。设置了图床时改传到图床，正文写图床的地址。", "Saved in the assets/ folder next to the document, linked by relative path. With an image host, images are uploaded there instead."), remote: t("直接显示，也可以「转存到本地」（由网关下载）。", "Shown directly. You can also save a local copy through the gateway.") };
    return { saved: t("存在文档旁边的 assets/ 文件夹里，正文写相对路径。", "Saved in the assets/ folder next to the document, linked by relative path."), remote: t("直接显示。转存到本地、使用图床只在网页版连着本机网关时可用。", "Shown directly. Saving local copies and image hosting are available in the web editor with the local gateway.") };
  };
  return (
    <>
      <Row testID="images-where" label={t("粘贴和插入的图片", "Pasted and inserted images")} description={where().saved} />
      <Row label={t("外链图片", "Remote images")} description={where().remote} />
    </>
  );
}

function reportText(r: CopyReport): string {
  const parts = [r.copied.length > 0 ? t(`复制了 ${r.copied.length} 篇到文库：${r.copied.join("、")}。`, `Copied to the library (${r.copied.length}): ${r.copied.join(", ")}.`) : t("没有复制任何文档。", "No documents were copied.")];
  if (r.same.length > 0) parts.push(t(`${r.same.length} 篇文库里已经有一样的：${r.same.join("、")}。`, `Already in the library (${r.same.length}): ${r.same.join(", ")}.`));
  if (r.failed.length > 0) parts.push(t(`${r.failed.length} 篇没能复制：${r.failed.join("、")}。`, `Could not copy (${r.failed.length}): ${r.failed.join(", ")}.`));
  if (r.imagesFailed.length > 0) parts.push(t(`${r.imagesFailed.length} 篇的图片没能全部复制：${r.imagesFailed.join("、")}，文库里那篇缺的图显示「找不到图片」。浏览器里的那份连同图片都还在，可以再点一次补上。`, `Some images were not copied (${r.imagesFailed.length} documents): ${r.imagesFailed.join(", ")}. Missing images are marked in the library copy. The browser originals still have their images, so you can retry.`));
  return parts.join(" ");
}

function CopyToLibrary() {
  const running = signal(false);
  const result = signal<{ text: Phrase; failed: boolean } | null>(null);
  const copy = async () => {
    running.set(true);
    try {
      const report = await copyBrowserDocsToLibrary();
      result.set({ text: () => reportText(report), failed: report.failed.length > 0 || report.imagesFailed.length > 0 });
      await refreshLibrary();
    } catch (e) {
      handleError(e, { context: "copy to library failed", severity: "error" });
      result.set({ text: () => t(`没能复制：${messageOf(e)}`, `Could not copy: ${messageOf(e)}`), failed: true });
    } finally {
      running.set(false);
    }
  };
  return (
    <Group title={t("浏览器里的旧文档", "Documents left in this browser")}>
      <Row
        label={t("复制到文库", "Copy to the library")}
        description={t("连上网关之前写在这个浏览器里的文档不会自动搬过去，需要的话复制一份到文库。浏览器里的原件保留。", "Documents written in this browser before you connected the gateway aren’t moved automatically. Copy them to the library if you need them; the originals stay here.")}
        control={<Button testID="copy-to-library" variant="outline" label={running() ? t("正在复制…", "Copying…") : t("复制到文库", "Copy to library")} disabled={running()} onPress={() => void copy()} />}
      >
        <Details label={t("复制规则", "How copying works")}>
          {t("文件名取标题；文库里已有同名的不覆盖：内容一样的跳过，不一样的名字后面加序号。版本历史一起复制。连着 GitHub 同步的那篇以后由文库里的副本同步，浏览器里的原件记成「不同步」。", "File names come from titles. Existing files are never overwritten: identical copies are skipped, and a number is added when a name is taken. Version history is copied too. If a document syncs with GitHub, the library copy takes over syncing and the browser original stops syncing.")}
        </Details>
      </Row>
      <If when={result()}>
        {(r) => (
          <View class="border-t border-border px-4 py-3">
            <Callout testID="copy-result" tone={r().failed ? "warn" : "info"} announce>
              {phrase(r().text)}
            </Callout>
          </View>
        )}
      </If>
    </Group>
  );
}

/** `onGoGateway`：网页里用着浏览器本地时，给一个去「本机网关」的按钮。 */
export function StoragePanel(props: { inBrowser: boolean; onGoGateway: () => void }) {
  return (
    <View testID="storage" class="gap-6">
      <Group title={t("文档", "Documents")}>
        <DocumentsRow inBrowser={props.inBrowser} onGoGateway={props.onGoGateway} />
      </Group>
      <Group title={t("图片", "Images")}>
        <ImageRows />
      </Group>
      <If when={storageKind().kind === "gateway"}>
        <CopyToLibrary />
      </If>
    </View>
  );
}
