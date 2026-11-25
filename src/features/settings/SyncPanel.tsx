/** 设置里的「同步」一页：登录 / 退出 GitHub、账号名、上传什么。布局见 DESIGN.md「M5：同步」的登录一节。 */
import { Scroll, View } from "nsh";
import { SyncAccount } from "../sync/SyncAccount";

export function SyncPanel() {
  return (
    <Scroll class="max-h-[480px]">
      <View testID="sync-settings" class="gap-4 px-4 py-3">
        <SyncAccount explain />
      </View>
    </Scroll>
  );
}
