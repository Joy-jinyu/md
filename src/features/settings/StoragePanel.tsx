/** 设置里的「存储」一页：现在文档存在哪，怎么装、怎么起本机网关，以及把浏览器里的文档复制进网关的文库。布局见 DESIGN.md「屏幕：设置」。 */
import { Scroll, signal, Text, View } from "nsh";
import { messageOf } from "../../doc/message";
import { copyBrowserDocsToLibrary, type CopyReport, gatewayRefusal, storageKind } from "../../store/backend";
import { DEFAULT_PORT, OFFICIAL_ORIGIN } from "../../store/gateway-store";
import { docsInIndexedDb } from "../../store/kv";
import { refreshLibrary } from "../../store/library";
import { Button } from "../../ui/button";
import { CopyButton } from "../../ui/copy-button";
import { ImageHostSection } from "./ImageHostSection";

/** 脚本是仓库里的 gateway/install.sh，make build-web 时放到站点根目录。 */
const START_COMMAND = `curl -fsSL ${OFFICIAL_ORIGIN}/gateway.sh | sh`;

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

/** 一行命令，右边一个「复制」按钮。 */
function Code(props: { text: string; copyLabel: string; testID: string }) {
  return (
    <View class="flex-row items-center gap-2 rounded-(--radius-sm) bg-muted py-1 pl-3 pr-1">
      <Text class="min-w-0 flex-1 select-text py-1 font-mono text-[12px] leading-5 text-foreground">{props.text}</Text>
      <CopyButton testID={props.testID} text={props.text} label={props.copyLabel} />
    </View>
  );
}

/** 怎么装、怎么起网关（只在网页里有意义）。 */
function GatewayHowTo() {
  return (
    <View testID="gateway-howto" class="gap-2">
      <Text class="text-[11px] text-faint">本机网关</Text>
      <Text class="select-text text-xs leading-5 text-muted-foreground">
        装上本机网关后，网页里的文档就存成你电脑上一个文件夹里的 .md 文件：没有浏览器的容量限制，清浏览器数据也不会丢，别的编辑器和 git 能直接用。网关只听本机（127.0.0.1），只接受这个网站的页面。要 Node 23.6 以上。在终端里运行：
      </Text>
      <Code testID="copy-start-command" text={START_COMMAND} copyLabel="复制启动命令" />
      <Text class="select-text text-xs leading-5 text-muted-foreground">
        装好后网关在后台运行，登录电脑后自动启动，有新版会自己更新（后台运行现在只支持 macOS）。文档放在 ~/Documents/Pairdown。同时装上 pairdown 命令：pairdown 看状态和配置，pairdown config library 加文件夹换文库，pairdown uninstall 卸载。装好以后刷新这个页面；浏览器问要不要允许访问本地网络时选允许。连不上时页面照常用浏览器本地存储，不会报错。
      </Text>
    </View>
  );
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

/** 图片存在哪、外链图片能不能转存、图床（DESIGN.md「M3：图片」）。 */
const IMAGES_WHERE: Record<string, string> = {
  local: "粘贴、插入的图片存在这个浏览器里（IndexedDB），按文档存，删文档时一起删；另存的 .md 里不包含它们。外链图片直接显示，但不能转存到本地（要连着本机网关）。图床要连着本机网关才能用。",
  gateway: "粘贴、插入的图片存在文档旁边的 assets/ 文件夹里，正文写相对路径；设置了图床（见下）就传到图床，正文写图床给的地址。外链图片直接显示，也可以「转存到本地」（由网关下载）。",
  files: "粘贴、插入的图片存在文档旁边的 assets/ 文件夹里，正文写相对路径。外链图片直接显示；「转存到本地」没有做。图床要连着本机网关才能用（只有网页版能连）。",
};

export function StoragePanel(props: { inBrowser: boolean }) {
  const now = () => summary();
  return (
    <Scroll class="max-h-[480px]">
      <View testID="storage" class="gap-4 px-4 py-3">
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
          <ImageHostSection />
          <CopyToLibrary />
        </If>
        <If when={props.inBrowser && storageKind().kind === "local" && gatewayRefusal()}>
          {(reason) => (
            <Text testID="gateway-refused" role="alert" class="select-text text-xs leading-5 text-warn">
              {`连上了 127.0.0.1:${DEFAULT_PORT}，但没有用它：${reason()}。`}
            </Text>
          )}
        </If>
        <If when={props.inBrowser && storageKind().kind === "local"}>
          <GatewayHowTo />
        </If>
      </View>
    </Scroll>
  );
}
