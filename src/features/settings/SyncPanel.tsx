/** 设置里的「同步」一类：登录 / 退出 GitHub、账号名、上传什么。布局见 DESIGN.md「M5：同步」的登录一节。 */
import { View } from "nsh";
import { SyncAccount } from "../sync/SyncAccount";

export function SyncPanel() {
  return (
    <View testID="sync-settings" class="gap-4">
      <SyncAccount explain />
    </View>
  );
}
