/**
 * 页面最上面关于存储的提示：网关断开 / 不再连接；上次用的网关这次没连上（显示的是浏览器里的文档）；
 * 有属于别的存储的没存上的修改；搬进 macOS 文库时没搬走的文档。布局见 DESIGN.md「存在哪」。
 */
import { t } from "../../i18n";
import { signal, Text, View } from "nsh";
import { documentsLeftBehind, forgetMissedGateway, missedGatewayLibrary } from "../../store/backend";
import { stashesElsewhere } from "../../store/unsaved";
import { Button } from "../../ui/button";
import { Notice } from "../../ui/notice";
import { settingsOpen, settingsPage } from "../settings/open";
import { elsewhereText, reconnectGateway, storageNotice } from "./external";

function MissedGateway(props: { library: string }) {
  const trying = signal(false);
  const retry = async () => {
    trying.set(true);
    try {
      await reconnectGateway();
    } catch (e) {
      console.error("gateway reconnect failed", e);
    } finally {
      trying.set(false);
    }
  };
  const pending = () => (stashesElsewhere().length > 0 ? ` ${elsewhereText(stashesElsewhere())}` : "");
  return (
    <View testID="gateway-missed" role="alert" class="flex-row flex-wrap items-center gap-2 bg-warn-tint px-5 py-2">
      <Text class="min-w-[240px] flex-1 select-text text-xs leading-5 text-warn">{t(`上次用的是本机网关的文库「${props.library}」，现在没连上，显示的是浏览器里的文档。${pending()}`, `The local gateway library “${props.library}” is unavailable. You’re viewing documents saved in this browser.${pending()}`)}</Text>
      <Button testID="gateway-retry" label={trying() ? t("正在连接…", "Connecting…") : t("重新连接", "Reconnect")} disabled={trying()} onPress={() => void retry()} />
      <Button
        testID="gateway-settings"
        label={t("去设置页", "Open Settings")}
        onPress={() => {
          settingsPage.set("storage");
          settingsOpen.set(true);
        }}
      />
      <Button testID="gateway-forget" label={t("就用浏览器里的", "Keep using browser storage")} onPress={forgetMissedGateway} />
    </View>
  );
}

export function StorageNotice() {
  const missed = () => missedGatewayLibrary();
  const elsewhere = () => (missed() === null && stashesElsewhere().length > 0 ? elsewhereText(stashesElsewhere()) : null);
  const left = () => {
    const names = documentsLeftBehind();
    return names.length > 0 ? t(`有 ${names.length} 篇文档没能搬进文库：${names.join("、")}。它们还留在应用里，下次启动时再试。`, `Could not move ${names.length} document(s) into the library: ${names.join(", ")}. They are still in the app. Pairdown will try again the next time it starts.`) : null;
  };
  return (
    <>
      <If when={storageNotice()}>{(message) => <Notice testID="storage-notice" message={message()} />}</If>
      <If when={missed()}>{(library) => <MissedGateway library={library()} />}</If>
      <If when={elsewhere()}>{(message) => <Notice testID="stash-elsewhere" message={message()} />}</If>
      <If when={left()}>{(message) => <Notice testID="left-behind" message={message()} />}</If>
    </>
  );
}
