/** 设置里的「本机网关」一类（只在网页里）：连着时的连接状态，没连上时怎么装、怎么起，以及连上了却没用它的原因。布局见 DESIGN.md「屏幕：设置」。 */
import { Text, View } from "nsh";
import { gatewayRefusal, storageKind } from "../../store/backend";
import { DEFAULT_PORT, OFFICIAL_ORIGIN } from "../../store/gateway-store";
import { CopyButton } from "../../ui/copy-button";

/** 脚本是仓库里的 gateway/install.sh，make build-web 时放到站点根目录。 */
const START_COMMAND = `curl -fsSL ${OFFICIAL_ORIGIN}/gateway.sh | sh`;

const LINE = "select-text text-xs leading-5 text-muted-foreground";
const PAIRDOWN_COMMAND = "pairdown 命令：pairdown 看状态和配置，pairdown config library 加文件夹换文库，pairdown uninstall 卸载。";

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
  return (
    <View testID="gateway-howto" class="gap-2">
      <Text class={LINE}>
        装上本机网关后，网页里的文档就存成你电脑上一个文件夹里的 .md 文件：没有浏览器的容量限制，清浏览器数据也不会丢，别的编辑器和 git 能直接用。网关只听本机（127.0.0.1），只接受这个网站的页面。要 Node 23.6 以上。在终端里运行：
      </Text>
      <Code testID="copy-start-command" text={START_COMMAND} copyLabel="复制启动命令" />
      <Text class={LINE}>
        {`装好后网关在后台运行，登录电脑后自动启动，有新版会自己更新（后台运行现在只支持 macOS）。文档放在 ~/Documents/Pairdown。同时装上 ${PAIRDOWN_COMMAND}装好以后刷新这个页面；浏览器问要不要允许访问本地网络时选允许。连不上时页面照常用浏览器本地存储，不会报错。`}
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
          <Text class="text-[11px] text-faint">连接</Text>
          <Text class="select-text text-[13px] font-medium text-strong">{g().link().state === "connected" ? "已连接" : "断开了，正在重连"}</Text>
          <Text class={LINE}>{`文库「${g().library()}」，网关地址 ws://127.0.0.1:${DEFAULT_PORT}`}</Text>
          <Text class={LINE}>{PAIRDOWN_COMMAND}</Text>
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
            {`连上了 127.0.0.1:${DEFAULT_PORT}，但没有用它：${reason()}。`}
          </Text>
        )}
      </If>
      <If when={local()}>
        <GatewayHowTo />
      </If>
    </View>
  );
}
