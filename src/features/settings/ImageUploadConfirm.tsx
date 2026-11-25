/** 「上传到图床」确认框：设置了图床时插图先问（editor/image-host.ts 的 `uploadAsk`）。布局见 DESIGN.md「M3：图片」的「上传确认框」。 */
import { keymap, Text, View } from "nsh";
import { Dialog } from "nsh/base";
import { Button } from "../../ui/button";
import { type UploadChoice, uploadAsk } from "../editor/image-host";
import { returnFocusToEditor } from "../editor/ui-state";

/** 走应用级 keymap，焦点在哪 Esc 都一下关掉（同 ImageHostDialog）。 */
function EscapeCloses(props: { onEscape: () => void }) {
  keymap.bind("escape", props.onEscape, { when: "always" });
  return null;
}

export function ImageUploadConfirm() {
  const answer = (choice: UploadChoice) => {
    const ask = uploadAsk();
    if (!ask) return;
    ask.reply(choice);
    returnFocusToEditor();
  };
  return (
    <Dialog
      testID="image-upload-ask"
      open={uploadAsk() !== null}
      animation="fade"
      accessibilityLabel="上传到图床"
      closeOnEscape
      closeOnBackdropPress
      onOpenChange={({ open }) => !open && answer("local")}
      backdropClass="bg-scrim"
      class="mx-auto mt-24 w-full max-w-[420px] px-4"
    >
      <EscapeCloses onEscape={() => answer("local")} />
      <View class="gap-3 rounded-(--radius) border border-border bg-popover p-4">
        <Text class="text-sm font-medium text-strong">{`把 ${uploadAsk()?.count ?? 0} 张图片传到图床？`}</Text>
        <Text testID="image-upload-where" class="select-text text-xs leading-5 text-muted-foreground">
          {`会传到 ${uploadAsk()?.where ?? ""}，正文里写图床给的外链地址，传上去的图片是公开的。存本地的话图片放在文档旁边的 assets/ 里。`}
        </Text>
        <View class="flex-row flex-wrap justify-end gap-2">
          <Button testID="image-upload-local" label="存本地" onPress={() => answer("local")} />
          <Button testID="image-upload-always" label="上传，以后不再问" onPress={() => answer("always")} />
          <Button testID="image-upload-yes" label="上传" variant="primary" onPress={() => answer("upload")} />
        </View>
      </View>
    </Dialog>
  );
}
