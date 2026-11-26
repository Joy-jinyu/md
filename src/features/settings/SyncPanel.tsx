/** 设置里的「同步」一类：登录 / 退出 GitHub、账号名，同步什么、不同步什么，登录凭证存在哪。布局见 DESIGN.md「M5：同步」的登录一节。 */
import { View } from "nsh";
import { t } from "../../i18n";
import { credentialNote, SyncAccount } from "../sync/SyncAccount";
import { Block, Group, Row } from "./parts";

export function SyncPanel() {
  return (
    <View testID="sync-settings" class="gap-6">
      <Group title={t("GitHub 账号", "GitHub account")}>
        <Block>
          <SyncAccount />
        </Block>
      </Group>
      <Group title={t("同步什么", "What syncs")} testID="sync-explain">
        <Row label={t("上传", "Uploaded")} description={t("只上传文档正文（Markdown 文字），一篇一个私密 Gist：不公开列出，但拿到链接的人能看。", "Only the Markdown text, one secret Gist per document. Secret Gists aren’t listed publicly, but anyone with the link can read them.")} />
        <Row label={t("不上传", "Not uploaded")} description={t("图片不同步（Gist 只收文字），正文里的图片地址照原样上传。版本历史和设置留在本机。", "Image files don’t sync (Gists hold text only); image links are uploaded as written. Version history and settings stay on this device.")} />
        <Row label={t("什么时候同步", "When it syncs")} description={t("手动：点顶栏的同步按钮，在同步面板里选「立即同步」。", "Manually: select the sync button in the top bar, then “Sync now”.")} />
      </Group>
      <Group title={t("登录凭证", "Sign-in credentials")}>
        <Row testID="sync-credential" label={t("存在哪", "Where they’re kept")} description={credentialNote()} />
      </Group>
    </View>
  );
}
