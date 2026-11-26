/** 设置「图床」页的内容（只在连着本机网关时有）：看现在的配置、改、清掉，上传前问不问，重新打开插图时的询问。布局见 DESIGN.md「屏幕：设置」。 */
import { type Phrase, phrase, t } from "../../i18n";
import { signal, View } from "nsh";
import { messageOf } from "../../doc/message";
import { imageHost } from "../../store/backend";
import { type ImageHostView, ImageHostUnsupported } from "../../store/document-store";
import { loadAutoUpload, loadSkipImageHost, saveAutoUpload, saveSkipImageHost } from "../../store/settings";
import { Button } from "../../ui/button";
import { ImageHostForm } from "./ImageHostForm";
import { Block, Callout, Field, Group, Row, Toggle } from "./parts";

type Loaded = { kind: "loading" } | { kind: "ready"; host: ImageHostView | null } | { kind: "unsupported"; reason: string };

/** 现在的配置，一项一行；密钥只写有没有。 */
function HostFields(props: { host: ImageHostView }) {
  const github = () => (props.host.kind === "github" ? props.host : null);
  const upload = () => (props.host.kind === "github" ? null : props.host);
  return (
    <If
      when={github()}
      else={
        <If when={upload()}>
          {(h) => (
            <>
              <Field label={t("种类", "Type")} value={t("上传接口", "Upload endpoint")} />
              <Field label={t("上传地址", "Upload URL")} value={h().url} mono />
              <Field label={t("文件字段名", "File field name")} value={h().field} mono />
              <Field label={t("请求头", "Request headers")} value={h().headerNames.length > 0 ? t(`${h().headerNames.join("、")}（值不显示）`, `${h().headerNames.join(", ")} (values hidden)`) : t("没有", "None")} />
              <Field label={t("图片地址的位置", "Image URL path")} value={h().urlPath || t("自动找", "Automatic")} />
            </>
          )}
        </If>
      }
    >
      {(h) => (
        <>
          <Field label={t("种类", "Type")} value={t("GitHub 仓库", "GitHub repository")} />
          <Field label={t("GitHub 仓库", "GitHub repository")} value={h().repo} mono />
          <Field label={t("分支", "Branch")} value={h().branch} mono />
          <Field label={t("目录", "Directory")} value={h().dir} mono />
          <Field label={t("令牌", "Token")} value={h().hasToken ? t("已设置（值不显示）", "Configured (value hidden)") : t("没有", "None")} />
        </>
      )}
    </If>
  );
}

/** 这一节的状态：读出的配置、选没选过「不用图床」、正在改、出错原因，和三个动作。 */
function createHostState() {
  const loaded = signal<Loaded>({ kind: "loading" });
  const skipped = signal(false);
  const auto = signal(false);
  const editing = signal(false);
  const problem = signal<Phrase>("");
  const load = async () => {
    const api = imageHost();
    if (!api) return;
    try {
      loaded.set({ kind: "ready", host: await api.get() });
      skipped.set(await loadSkipImageHost());
      auto.set(await loadAutoUpload());
    } catch (e) {
      console.warn("image host not read", e);
      if (e instanceof ImageHostUnsupported) loaded.set({ kind: "unsupported", reason: e.message });
      else problem.set(() => t(`没能读出图床设置：${messageOf(e)}`, `Could not read image hosting settings: ${messageOf(e)}`));
    }
  };
  void load();
  const stop = async () => {
    problem.set("");
    try {
      await imageHost()?.set(null);
      const why = await saveSkipImageHost(true);
      if (why) console.warn("skip image host not saved", why);
      await load();
    } catch (e) {
      console.error("image host not cleared", e);
      problem.set(() => t(`没能清掉图床设置：${messageOf(e)}`, `Could not clear image hosting settings: ${messageOf(e)}`));
    }
  };
  const askAgain = async () => {
    const why = await saveSkipImageHost(false);
    if (why) problem.set(() => t(`没能保存：${why}`, `Could not save: ${why}`));
    else skipped.set(false);
  };
  const setAuto = async (next: boolean) => {
    const why = await saveAutoUpload(next);
    if (why) problem.set(() => t(`没能保存：${why}`, `Could not save: ${why}`));
    else auto.set(next);
  };
  const host = () => {
    const l = loaded();
    return l.kind === "ready" ? l.host : null;
  };
  const unsupported = () => {
    const l = loaded();
    return l.kind === "unsupported" ? l.reason : "";
  };
  return { loaded, skipped, auto, editing, problem, load, stop, askAgain, setAuto, host, unsupported };
}

type HostState = ReturnType<typeof createHostState>;

/** 设置了图床：配置一项一行，上传前问不问，修改 / 不再用。 */
function Configured(props: { state: HostState; host: ImageHostView }) {
  const s = props.state;
  return (
    <>
      <Group title={t("当前图床", "Current image host")} testID="image-host-current">
        <HostFields host={props.host} />
        <Block>
          <View class="flex-row flex-wrap gap-2">
            <Button testID="image-host-edit" variant="outline" label={t("修改设置", "Edit settings")} onPress={() => s.editing.set(true)} />
            <Button testID="image-host-stop" variant="danger" label={t("不再用图床", "Turn off image hosting")} onPress={() => void s.stop()} />
          </View>
        </Block>
      </Group>
      <Group title={t("上传", "Uploading")}>
        <Row
          testID="image-host-auto"
          label={t("插入图片时直接上传", "Upload inserted images automatically")}
          description={s.auto() ? t("插入图片时直接上传，不先问。", "Inserted images upload automatically.") : t("插入图片时先问要不要上传。", "Pairdown asks before uploading inserted images.")}
          control={<Toggle testID="image-host-auto-toggle" checked={s.auto()} label={t("插入图片时直接上传", "Upload inserted images automatically")} onChange={(next) => void s.setAuto(next)} />}
        />
      </Group>
    </>
  );
}

/** 没设置图床：说明图片存哪，给「设置图床」；选过「不用图床」时可以改回「再问我」。 */
function NotConfigured(props: { state: HostState }) {
  const s = props.state;
  return (
    <Group>
      <Row
        label={t("还没有设置图床", "No image host yet")}
        description={t("没有设置图床，图片存在文档旁边的 assets/ 里。", "Images are saved in the assets/ folder beside the document.")}
        control={<Button testID="image-host-edit" variant="primary" label={t("设置图床", "Set up image hosting")} onPress={() => s.editing.set(true)} />}
      />
      <If when={s.skipped()}>
        <Row
          label={t("粘贴图片时不再询问", "Not asking when you paste images")}
          description={t("你选过「不用图床」，粘贴图片时不再询问。", "You chose not to use an image host, so Pairdown no longer asks when you paste images.")}
          control={<Button testID="image-host-ask-again" variant="outline" label={t("粘贴图片时再问我", "Ask again when I paste images")} onPress={() => void s.askAgain()} />}
        />
      </If>
    </Group>
  );
}

export function ImageHostSection() {
  const s = createHostState();
  return (
    <View testID="image-host" class="gap-6">
      <If when={s.unsupported()}>{(reason) => <Callout tone="warn">{reason()}</Callout>}</If>
      <If when={s.loaded().kind === "ready" && !s.editing()}>
        <If when={s.host()} else={<NotConfigured state={s} />}>
          {(h) => <Configured state={s} host={h()} />}
        </If>
      </If>
      <If when={s.editing()}>
        <Group title={s.host() ? t("修改图床设置", "Edit image hosting") : t("设置图床", "Set up image hosting")}>
          <Block>
            <ImageHostForm
              current={s.host()}
              saveLabel={t("保存图床设置", "Save image hosting settings")}
              onSaved={() => {
                s.editing.set(false);
                void s.load();
              }}
            >
              <Button testID="image-host-cancel" label={t("取消", "Cancel")} onPress={() => s.editing.set(false)} />
            </ImageHostForm>
          </Block>
        </Group>
      </If>
      <If when={s.problem()}>
        {(text) => (
          <Callout testID="image-host-section-problem" tone="danger">
            {phrase(text())}
          </Callout>
        )}
      </If>
    </View>
  );
}
