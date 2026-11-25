/** 设置里的「存储」一类：现在文档、图片存在哪，以及把浏览器里的文档复制进网关的文库。布局见 DESIGN.md「屏幕：设置」。 */
import { signal, Text, View } from "nsh";
import { messageOf } from "../../doc/message";
import { copyBrowserDocsToLibrary, type CopyReport, storageKind } from "../../store/backend";
import { DEFAULT_PORT } from "../../store/gateway-store";
import { docsInIndexedDb } from "../../store/kv";
import { refreshLibrary } from "../../store/library";
import { Button } from "../../ui/button";

function summary(): { title: string; detail: string } {
  const k = storageKind();
  if (k.kind === "files") return { title: `文库文件夹：${k.folder}`, detail: "这个文件夹里（含子文件夹）的每个 .md 文件是一篇文档。别的程序改了文件，回到这个窗口时会比对：这里没改过就直接载入，改过就让你选保留哪一边。" };
  if (k.kind === "gateway") {
    const state = k.gateway.link().state === "connected" ? "已连接" : "断开了，正在重连";
    return { title: `本机网关：文库「${k.gateway.library()}」`, detail: `文档是这个文库文件夹里的 .md 文件（网关地址 ws://127.0.0.1:${DEFAULT_PORT}，${state}）。版本历史和关页面前的应急存储仍放在这个浏览器里。` };
  }
  return {
    title: "浏览器本地",
    detail: docsInIndexedDb()
      ? "文档存在这个浏览器里（IndexedDB）。清掉这个网站的浏览器数据，文档会一起删掉；换浏览器也看不到。"
      : "文档存在这个应用的本机存储里，所有文档和设置合计不能超过 5 MB。",
  };
}

function reportText(r: CopyReport): string {
  const parts = [r.copied.length > 0 ? `复制了 ${r.copied.length} 篇到文库：${r.copied.join("、")}。` : "没有复制任何文档。"];
  if (r.same.length > 0) parts.push(`${r.same.length} 篇文库里已经有一样的：${r.same.join("、")}。`);
  if (r.failed.length > 0) parts.push(`${r.failed.length} 篇没能复制：${r.failed.join("、")}。`);
  if (r.imagesFailed.length > 0) parts.push(`${r.imagesFailed.length} 篇的图片没能全部复制：${r.imagesFailed.join("、")}，文库里那篇缺的图显示「找不到图片」。浏览器里的那份连同图片都还在，可以再点一次补上。`);
  return parts.join("");
}

function CopyToLibrary() {
  const running = signal(false);
  const result = signal("");
  const copy = async () => {
    running.set(true);
    try {
      result.set(reportText(await copyBrowserDocsToLibrary()));
      await refreshLibrary();
    } catch (e) {
      console.error("copy to library failed", e);
      result.set(`没能复制：${messageOf(e)}`);
    } finally {
      running.set(false);
    }
  };
  return (
    <View class="gap-2">
      <Text class="select-text text-xs leading-5 text-muted-foreground">连上网关之前写在这个浏览器里的文档不会自动搬过去。需要的话复制一份到文库（文件名取标题；文库里已有同名的不覆盖，内容一样的不再复制，不一样的名字后面加序号；浏览器里的那份留着，版本历史复制一份；连着 GitHub 的那篇以后由文库里的这份同步，浏览器里的记成「不同步」）：</Text>
      <View class="flex-row">
        <Button testID="copy-to-library" label={running() ? "正在复制…" : "把浏览器里的文档复制到文库"} disabled={running()} onPress={() => void copy()} />
      </View>
      <If when={result()}>
        {(text) => (
          <Text testID="copy-result" role="alert" class="select-text text-xs leading-5 text-foreground">
            {text()}
          </Text>
        )}
      </If>
    </View>
  );
}

/** 图片存在哪、外链图片能不能转存（DESIGN.md「M3：图片」）。 */
const IMAGES_WHERE: Record<string, string> = {
  local: "粘贴、插入的图片存在这个浏览器里（IndexedDB），按文档存，删文档时一起删；另存的 .md 里不包含它们。外链图片直接显示，但不能转存到本地（要连着本机网关）。图床要连着本机网关才能用。",
  gateway: "粘贴、插入的图片存在文档旁边的 assets/ 文件夹里，正文写相对路径；设置了图床（见「图床」）就传到图床，正文写图床给的地址。外链图片直接显示，也可以「转存到本地」（由网关下载）。",
  files: "粘贴、插入的图片存在文档旁边的 assets/ 文件夹里，正文写相对路径。外链图片直接显示；「转存到本地」没有做。图床要连着本机网关才能用（只有网页版能连）。",
};

/** `onGoGateway`：网页里用着浏览器本地时，末尾给一个去「本机网关」的按钮。 */
export function StoragePanel(props: { inBrowser: boolean; onGoGateway: () => void }) {
  const now = () => summary();
  return (
    <View testID="storage" class="gap-4">
      <View class="gap-1">
        <Text class="text-[11px] text-faint">现在文档存在</Text>
        <Text testID="storage-kind" class="select-text text-[13px] font-medium text-strong">
          {now().title}
        </Text>
        <Text class="select-text text-xs leading-5 text-muted-foreground">{now().detail}</Text>
      </View>
      <View class="gap-1">
        <Text class="text-[11px] text-faint">图片</Text>
        <Text testID="images-where" class="select-text text-xs leading-5 text-muted-foreground">
          {IMAGES_WHERE[storageKind().kind]}
        </Text>
      </View>
      <If when={storageKind().kind === "gateway"}>
        <CopyToLibrary />
      </If>
      <If when={props.inBrowser && storageKind().kind === "local"}>
        <View class="flex-row flex-wrap items-center gap-2">
          <Text class="select-text text-xs leading-5 text-muted-foreground">想存成电脑上的 .md 文件，装本机网关。</Text>
          <Button testID="storage-go-gateway" label="去本机网关" onPress={props.onGoGateway} />
        </View>
      </If>
    </View>
  );
}
