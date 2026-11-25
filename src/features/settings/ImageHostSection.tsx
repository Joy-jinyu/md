/** 设置「图床」页的内容（只在连着本机网关时有）：看现在的配置、改、清掉，上传前问不问，重新打开插图时的询问。布局见 DESIGN.md「屏幕：设置」。 */
import { signal, Text, View } from "nsh";
import { messageOf } from "../../doc/message";
import { imageHost } from "../../store/backend";
import { type ImageHostView, ImageHostUnsupported } from "../../store/document-store";
import { loadAutoUpload, loadSkipImageHost, saveAutoUpload, saveSkipImageHost } from "../../store/settings";
import { Button } from "../../ui/button";
import { ImageHostForm } from "./ImageHostForm";

type Loaded = { kind: "loading" } | { kind: "ready"; host: ImageHostView | null } | { kind: "unsupported"; reason: string };

const LINE = "select-text text-xs leading-5 text-muted-foreground";

function HostLines(props: { host: ImageHostView }) {
  const lines = (): string[] => {
    const h = props.host;
    if (h.kind === "github") return [`GitHub 仓库：${h.repo}`, `分支：${h.branch}`, `目录：${h.dir}`, `令牌：${h.hasToken ? "已设置（值不显示）" : "没有"}`];
    const headers = h.headerNames.length > 0 ? `${h.headerNames.join("、")}（值不显示）` : "没有";
    return [`上传地址：${h.url}`, `文件字段名：${h.field}`, `请求头：${headers}`, `图片地址的位置：${h.urlPath || "自动找"}`];
  };
  return (
    <View testID="image-host-current" class="gap-0.5">
      <Each of={lines()} key={(line) => line}>
        {(line) => <Text class={LINE}>{line()}</Text>}
      </Each>
    </View>
  );
}

/** 这一节的状态：读出的配置、选没选过「不用图床」、正在改、出错原因，和三个动作。 */
function createHostState() {
  const loaded = signal<Loaded>({ kind: "loading" });
  const skipped = signal(false);
  const auto = signal(false);
  const editing = signal(false);
  const problem = signal("");
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
      else problem.set(`没能读出图床设置：${messageOf(e)}`);
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
      problem.set(`没能清掉图床设置：${messageOf(e)}`);
    }
  };
  const askAgain = async () => {
    const why = await saveSkipImageHost(false);
    if (why) problem.set(`没能保存：${why}`);
    else skipped.set(false);
  };
  const setAuto = async (next: boolean) => {
    const why = await saveAutoUpload(next);
    if (why) problem.set(`没能保存：${why}`);
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

export function ImageHostSection() {
  const { loaded, skipped, auto, editing, problem, load, stop, askAgain, setAuto, host, unsupported } = createHostState();
  return (
    <View testID="image-host" class="gap-2">
      <If when={unsupported()}>{(reason) => <Text class={LINE}>{reason()}</Text>}</If>
      <If when={loaded().kind === "ready" && !editing()}>
        <If when={host()} else={<Text class={LINE}>没有设置图床，图片存在文档旁边的 assets/ 里。</Text>}>
          {(h) => <HostLines host={h()} />}
        </If>
        <If when={!host() && skipped()}>
          <Text class={LINE}>你选过「不用图床」，粘贴图片时不再询问。</Text>
        </If>
        <If when={host()}>
          <Text testID="image-host-auto" class={LINE}>
            {auto() ? "插入图片时直接上传，不先问。" : "插入图片时先问要不要上传。"}
          </Text>
        </If>
        <View class="flex-row flex-wrap gap-1">
          <Button testID="image-host-edit" label={host() ? "修改图床设置" : "设置图床"} onPress={() => editing.set(true)} />
          <If when={host()}>
            <Button testID="image-host-auto-toggle" label={auto() ? "上传前先问我" : "以后直接上传"} onPress={() => void setAuto(!auto())} />
            <Button testID="image-host-stop" label="不再用图床" onPress={() => void stop()} />
          </If>
          <If when={!host() && skipped()}>
            <Button testID="image-host-ask-again" label="粘贴图片时再问我" onPress={() => void askAgain()} />
          </If>
        </View>
      </If>
      <If when={editing()}>
        <ImageHostForm
          current={host()}
          saveLabel="保存图床设置"
          onSaved={() => {
            editing.set(false);
            void load();
          }}
        >
          <Button testID="image-host-cancel" label="取消" onPress={() => editing.set(false)} />
        </ImageHostForm>
      </If>
      <If when={problem()}>
        {(text) => (
          <Text testID="image-host-section-problem" role="alert" class="select-text text-xs leading-5 text-destructive">
            {text()}
          </Text>
        )}
      </If>
    </View>
  );
}
