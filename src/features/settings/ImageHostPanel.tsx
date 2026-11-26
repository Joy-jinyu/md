/** 设置里的「图床」一类：连着本机网关时是 ImageHostSection，没连时说要网关、网页里给去「本机网关」的按钮。布局见 DESIGN.md「屏幕：设置」。 */
import { t } from "../../i18n";
import { storageKind } from "../../store/backend";
import { Button } from "../../ui/button";
import { ImageHostSection } from "./ImageHostSection";
import { Group, Row } from "./parts";

/** `onGoGateway`：没有它（macOS，不能连网关）时不给按钮，改写一句原因。 */
export function ImageHostPanel(props: { onGoGateway?: () => void }) {
  return (
    <If
      when={storageKind().kind === "gateway"}
      else={
        <Group testID="image-host-needs-gateway">
          <Row
            label={t("图床要连着本机网关才能用", "Image hosting needs the local gateway")}
            description={props.onGoGateway ? t("图片经本机网关传到图床，上传接口的密钥也存在网关里。", "Images are uploaded through the local gateway, which also keeps the host’s credentials.") : t("只有网页版能连本机网关。", "The local gateway is available in the web editor.")}
            control={props.onGoGateway ? <Button testID="image-host-go-gateway" variant="outline" label={t("设置本机网关", "Set up local gateway")} onPress={props.onGoGateway} /> : undefined}
          />
        </Group>
      }
    >
      <ImageHostSection />
    </If>
  );
}
