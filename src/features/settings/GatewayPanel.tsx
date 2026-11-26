/** 设置里的「本机网关」一类（只在网页里）：连着时的连接状态，没连上时怎么装、怎么起，以及连上了却没用它的原因。布局见 DESIGN.md「屏幕：设置」。 */
import { t } from "../../i18n";
import { Text, View } from "nsh";
import { gatewayRefusal, storageKind } from "../../store/backend";
import { DEFAULT_PORT } from "../../store/gateway-store";
import { siteOrigin } from "../../sync/config";
import { CopyButton } from "../../ui/copy-button";

/** 脚本是仓库里的 gateway/install.sh，make build-web 时放到站点根目录。没配站点（部署配置 PAIRDOWN_SITE）时是 null。 */
const startCommand = (): string | null => (siteOrigin() === "" ? null : `curl -fsSL ${siteOrigin()}/gateway.sh | sh`);

const LINE = "select-text text-xs leading-5 text-muted-foreground";
const pairdownCommand = () => t("pairdown 命令：pairdown 看状态和配置，pairdown config library 加文件夹换文库，pairdown uninstall 卸载。", "Run pairdown to see status and settings, pairdown config library with a folder to change libraries, or pairdown uninstall to remove the gateway.");

/** 一行命令，右边一个「复制」按钮。 */
function Code(props: { text: string; copyLabel: string; testID: string }) {
  return (
    <View class="flex-row items-center gap-2 rounded-(--radius-sm) bg-muted py-1 pl-3 pr-1">
      <Text class="min-w-0 flex-1 select-text py-1 font-mono text-[12px] leading-5 text-foreground">{props.text}</Text>
      <CopyButton testID={props.testID} text={props.text} label={props.copyLabel} />
    </View>
  );
}

/** 怎么装、怎么起网关。 */
function GatewayHowTo() {
  const command = startCommand();
  return (
    <View testID="gateway-howto" class="gap-2">
      <Text class={LINE}>{t("装上本机网关后，网页里的文档就存成你电脑上一个文件夹里的 .md 文件：没有浏览器的容量限制，清浏览器数据也不会丢，别的编辑器和 git 能直接用。网关只听本机（127.0.0.1），只接受这个网站的页面。要 Node 23.6 以上。在终端里运行：", "The local gateway saves web documents as .md files in a folder on your computer. Browser storage limits and clearing site data do not affect them. Other editors and Git can use the files directly. The gateway listens only on 127.0.0.1 and accepts connections from this site. It requires Node.js 23.6 or later. Run this in a terminal:")}</Text>
      {command === null ? (
        <Text class={LINE}>{t("这个页面打包时没配置站点地址（PAIRDOWN_SITE），没有一行安装命令：从源码运行网关，见仓库的 gateway/README.md。", "This build has no site address configured (PAIRDOWN_SITE), so there is no install command. Run the gateway from source; see gateway/README.md in the repository.")}</Text>
      ) : (
        <Code testID="copy-start-command" text={command} copyLabel={t("复制启动命令", "Copy install command")} />
      )}
      <Text class={LINE}>
        {t(`装好后网关在后台运行，登录电脑后自动启动，有新版会自己更新（后台运行现在只支持 macOS）。文档放在 ~/Documents/Pairdown。同时装上 ${pairdownCommand()}装好以后刷新这个页面；浏览器问要不要允许访问本地网络时选允许。连不上时页面照常用浏览器本地存储，不会报错。`, `On macOS the gateway runs in the background, starts at login, and updates automatically. Documents are stored in ~/Documents/Pairdown. ${pairdownCommand()} Refresh this page after installing, and allow local network access if prompted. Pairdown uses browser storage if the gateway is unavailable.`)}
      </Text>
    </View>
  );
}

/** 连着网关时：连没连着、哪个文库、网关地址。 */
function GatewayStatus() {
  const gateway = () => {
    const k = storageKind();
    return k.kind === "gateway" ? k.gateway : null;
  };
  return (
    <If when={gateway()}>
      {(g) => (
        <View testID="gateway-status" class="gap-1">
          <Text class="text-[11px] text-faint">{t("连接", "Connection")}</Text>
          <Text class="select-text text-[13px] font-medium text-strong">{g().link().state === "connected" ? t("已连接", "Connected") : t("断开了，正在重连", "Disconnected. Reconnecting…")}</Text>
          <Text class={LINE}>{t(`文库「${g().library()}」，网关地址 ws://127.0.0.1:${DEFAULT_PORT}`, `Library: ${g().library()} · Gateway: ws://127.0.0.1:${DEFAULT_PORT}`)}</Text>
          <Text class={LINE}>{pairdownCommand()}</Text>
        </View>
      )}
    </If>
  );
}

export function GatewayPanel() {
  const local = () => storageKind().kind === "local";
  return (
    <View testID="gateway" class="gap-4">
      <GatewayStatus />
      <If when={local() && gatewayRefusal()}>
        {(reason) => (
          <Text testID="gateway-refused" role="alert" class="select-text text-xs leading-5 text-warn">
            {t(`连上了 127.0.0.1:${DEFAULT_PORT}，但没有用它：${reason()}。`, `Connected to 127.0.0.1:${DEFAULT_PORT}, but could not use the gateway: ${reason()}.`)}
          </Text>
        )}
      </If>
      <If when={local()}>
        <GatewayHowTo />
      </If>
    </View>
  );
}
