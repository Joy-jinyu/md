/** 「设置图床」对话框：连着网关、还没设置图床时插图先问（editor/image-host.ts 的 `hostAsk`）。布局见 DESIGN.md「M3：图片」的「设置图床对话框」。 */
import { t } from "../../i18n";
import { keymap, Text, View } from "nsh";
import { Dialog } from "nsh/base";
import { Button } from "../../ui/button";
import { type HostChoice, hostAsk } from "../editor/image-host";
import { returnFocusToEditor } from "../editor/ui-state";
import { ImageHostForm } from "./ImageHostForm";

/** 输入框里第一下 Esc 只失焦、对话框不关（同 DocDialogs 的 EscapeCloses），走应用级 keymap 一下就关。 */
function EscapeCloses(props: { onEscape: () => void }) {
  keymap.bind("escape", props.onEscape, { when: "always" });
  return null;
}

export function ImageHostDialog() {
  const answer = (choice: HostChoice) => {
    const reply = hostAsk();
    if (!reply) return;
    reply(choice);
    returnFocusToEditor();
  };
  return (
    <Dialog
      testID="image-host-ask"
      open={hostAsk() !== null}
      animation="fade"
      accessibilityLabel={t("设置图床", "Set up image hosting")}
      closeOnEscape
      closeOnBackdropPress
      onOpenChange={({ open }) => !open && answer("local")}
      backdropClass="bg-scrim"
      class="mx-auto mt-16 w-full max-w-[480px] px-4"
    >
      <EscapeCloses onEscape={() => answer("local")} />
      <View class="gap-3 rounded-(--radius) border border-border bg-popover p-4">
        <Text class="text-sm font-medium text-strong">{t("设置图床", "Set up image hosting")}</Text>
        <Text class="select-text text-xs leading-5 text-muted-foreground">{t("图片会经本机网关传到你设置的图床（自己的上传接口，或者一个 GitHub 仓库），正文里写图床给的外链地址。请求头、令牌这类密钥存在本机网关的配置里，页面读不回它们的值。", "The local gateway uploads images to your endpoint or GitHub repository. The document stores their public URLs. The gateway keeps request headers and tokens in its local configuration.")}</Text>
        <ImageHostForm current={null} saveLabel={t("保存并上传", "Save and upload")} onSaved={() => answer("saved")}>
          <Button testID="image-host-never" label={t("不用图床", "Don’t use image hosting")} onPress={() => answer("never")} />
          <Button testID="image-host-local" label={t("这次存本地", "Save locally this time")} onPress={() => answer("local")} />
        </ImageHostForm>
      </View>
    </Dialog>
  );
}
