/** 设置里的「本机网关」一类（只在网页里）：连着时的连接状态和命令，没连上时怎么装，以及连上了却没用它的原因。布局见 DESIGN.md「屏幕：设置」。 */
import { t } from "../../i18n";
import { type JSX, Text, View } from "nsh";
import { gatewayRefusal, storageKind } from "../../store/backend";
import { DEFAULT_PORT } from "../../store/gateway-store";
import { siteOrigin } from "../../sync/config";
import { CopyButton } from "../../ui/copy-button";
import { Block, Callout, Group, Prose, Row } from "./parts";
import { LinkStatus } from "./StoragePanel";

/** 脚本是仓库里的 gateway/install.sh，make build-web 时放到站点根目录。没配站点（部署配置 PAIRDOWN_SITE）时是 null。 */
const startCommand = (): string | null => (siteOrigin() === "" ? null : `curl -fsSL ${siteOrigin()}/gateway.sh | sh`);

/** 一行命令，右边一个「复制」按钮。 */
function Code(props: { text: string; copyLabel: string; testID: string }) {
  return (
    <View class="flex-row items-center gap-2 rounded-(--radius-sm) border border-border bg-background py-1 pl-3 pr-1">
      <Text class="min-w-0 flex-1 select-text py-1 font-mono text-[12px] leading-5 text-foreground">{props.text}</Text>
      <CopyButton testID={props.testID} text={props.text} label={props.copyLabel} />
    </View>
  );
}

/** 安装步骤的一步：左边圆圈里的序号，右边字和（可选的）命令。 */
function Step(props: { n: number; text: string; children?: JSX.Element }) {
  return (
    <View class="flex-row gap-3">
      <View class="size-5 shrink-0 items-center justify-center rounded-full bg-muted">
        <Text class="text-[11px] font-medium text-foreground">{String(props.n)}</Text>
      </View>
      <View class="min-w-0 flex-1 gap-2">
        <Text class="select-text text-[13px] leading-5 text-foreground">{props.text}</Text>
        {props.children}
      </View>
    </View>
  );
}

/** 怎么装网关。 */
function GatewayHowTo() {
  const command = startCommand();
  return (
    <View testID="gateway-howto" class="gap-6">
      <Prose>{t("装上本机网关后，网页里的文档存成你电脑上一个文件夹里的 .md 文件：没有浏览器的容量限制，清浏览器数据也不会丢，别的编辑器和 Git 能直接用。", "The local gateway saves web documents as .md files in a folder on your computer: no browser storage limits, nothing lost when site data is cleared, and other editors and Git can use the files directly.")}</Prose>
      <Group title={t("安装", "Install")}>
        <Block>
          <Step n={1} text={t("确认电脑上装了 Node.js 23.6 或更新的版本。", "Make sure Node.js 23.6 or later is installed.")} />
          {command === null ? (
            <Step n={2} text={t("这个页面打包时没配置站点地址（PAIRDOWN_SITE），没有一行安装命令：从源码运行网关，见仓库的 gateway/README.md。", "This build has no site address (PAIRDOWN_SITE), so there is no install command. Run the gateway from source; see gateway/README.md in the repository.")} />
          ) : (
            <Step n={2} text={t("在终端里运行：", "Run this in a terminal:")}>
              <Code testID="copy-start-command" text={command} copyLabel={t("复制启动命令", "Copy install command")} />
            </Step>
          )}
          <Step n={3} text={t("刷新这个页面。浏览器问要不要允许访问本地网络时，选「允许」。", "Refresh this page. If the browser asks about local network access, allow it.")} />
        </Block>
      </Group>
      <Group title={t("装好以后", "After installing")}>
        <Row label={t("后台运行", "Runs in the background")} description={t("在 macOS 上，网关登录后自动启动，有新版时自己更新。文档放在 ~/Documents/Pairdown。", "On macOS the gateway starts at login and updates itself. Documents are stored in ~/Documents/Pairdown.")} />
        <Row label={t("只在本机", "Local only")} description={t("网关只监听 127.0.0.1，只接受这个网站的页面。连不上时页面照常用浏览器存储，不会报错。", "The gateway listens only on 127.0.0.1 and accepts only this site. If it isn’t running, Pairdown quietly uses browser storage.")} />
      </Group>
      <Commands />
    </View>
  );
}

/** `pairdown` 命令：看状态、换文库、卸载。 */
function Commands() {
  const line = (command: string, zh: string, en: string) => (
    <Row label={command} mono description={t(zh, en)} />
  );
  return (
    <Group title={t("pairdown 命令", "The pairdown command")}>
      {line("pairdown", "看状态和配置。", "Show status and settings.")}
      {line("pairdown config library <folder>", "换一个文件夹当文库。", "Use another folder as the library.")}
      {line("pairdown uninstall", "卸载网关。", "Remove the gateway.")}
    </Group>
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
        <View testID="gateway-status" class="gap-6">
          <Group title={t("连接", "Connection")}>
            <Row label={t(`文库「${g().library()}」`, `Library: ${g().library()}`)} description={t(`网关地址 ws://127.0.0.1:${DEFAULT_PORT}`, `Gateway address: ws://127.0.0.1:${DEFAULT_PORT}`)} control={<LinkStatus gateway={g()} />} />
          </Group>
          <Commands />
        </View>
      )}
    </If>
  );
}

export function GatewayPanel() {
  const local = () => storageKind().kind === "local";
  return (
    <View testID="gateway" class="gap-6">
      <GatewayStatus />
      <If when={local() ? gatewayRefusal() : null}>
        {(reason) => (
          <Callout testID="gateway-refused" tone="warn" title={t(`连上了 127.0.0.1:${DEFAULT_PORT}，但没有用它`, `Found a gateway at 127.0.0.1:${DEFAULT_PORT}, but couldn’t use it`)}>
            {reason()}
          </Callout>
        )}
      </If>
      <If when={local()}>
        <GatewayHowTo />
      </If>
    </View>
  );
}
