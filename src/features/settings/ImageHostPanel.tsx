/** 设置里的「图床」一类：连着本机网关时是 ImageHostSection，没连时说要网关、网页里给去「本机网关」的按钮。布局见 DESIGN.md「屏幕：设置」。 */
import { Text, View } from "nsh";
import { storageKind } from "../../store/backend";
import { Button } from "../../ui/button";
import { ImageHostSection } from "./ImageHostSection";

const LINE = "select-text text-xs leading-5 text-muted-foreground";

/** `onGoGateway`：没有它（macOS，不能连网关）时不给按钮，改写一句原因。 */
export function ImageHostPanel(props: { onGoGateway?: () => void }) {
  return (
    <If
      when={storageKind().kind === "gateway"}
      else={
        <View testID="image-host-needs-gateway" class="gap-2">
          <Text class={LINE}>图床要连着本机网关才能用。</Text>
          <If when={props.onGoGateway} else={<Text class={LINE}>只有网页版能连本机网关。</Text>}>
            {(go) => (
              <View class="flex-row">
                <Button testID="image-host-go-gateway" label="去本机网关" onPress={go()} />
              </View>
            )}
          </If>
        </View>
      }
    >
      <ImageHostSection />
    </If>
  );
}
