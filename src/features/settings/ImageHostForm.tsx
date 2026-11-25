/** 图床表单：设置页「存储」和「设置图床」对话框共用。布局见 DESIGN.md「屏幕：设置」的「图床表单」。 */
import { type JSX, type Signal, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { messageOf } from "../../doc/message";
import { imageHost } from "../../store/backend";
import type { ImageHostView } from "../../store/document-store";
import { Button } from "../../ui/button";
import { draftOf, type HostDraft, type HostKind, kindOf, toInput } from "./image-host-input";

const FIELD = "h-8 rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary";
const NOTE = "select-text text-xs leading-5 text-muted-foreground";

type Draft = Signal<HostDraft>;

function Labeled(props: { label: string; children: JSX.Element }) {
  return (
    <View class="gap-1">
      <Text class="text-[11px] text-faint">{props.label}</Text>
      {props.children}
    </View>
  );
}

/** 一行输入框，改的是草稿里的 `name` 这一项。 */
function DraftInput(props: { draft: Draft; name: keyof HostDraft; label: string; placeholder: string; testID: string; autoFocus?: boolean; masked?: boolean }) {
  return (
    <Input
      testID={props.testID}
      autoFocus={props.autoFocus}
      masked={props.masked}
      value={props.draft()[props.name]}
      onChange={({ value }) => props.draft.update((d) => ({ ...d, [props.name]: value }))}
      placeholder={props.placeholder}
      accessibilityLabel={props.label}
      autoCapitalize="none"
      autoCorrect={false}
      class={FIELD}
    />
  );
}

/** 种类切换：两个按钮，当前的字前加「✓」、读屏名加「（当前）」（同图片操作条）。 */
function KindPicker(props: { kind: Signal<HostKind> }) {
  const option = (kind: HostKind, label: string) => {
    const on = () => props.kind() === kind;
    return <Button testID={`image-host-kind-${kind}`} label={on() ? `✓ ${label}` : label} accessibilityLabel={on() ? `${label}（当前）` : label} active={on()} onPress={() => props.kind.set(kind)} />;
  };
  return (
    <View accessibilityLabel="图床种类" class="flex-row flex-wrap gap-1">
      {option("upload", "上传接口")}
      {option("github", "GitHub 仓库")}
    </View>
  );
}

/** 上传接口的四项；`headerNames`：已设置的请求头的名字（值页面读不回）。 */
function UploadFields(props: { draft: Draft; headerNames: string[] }) {
  return (
    <>
      <Labeled label="上传地址">
        <DraftInput draft={props.draft} name="url" label="上传地址" placeholder="https://example.com/upload" testID="image-host-url" autoFocus />
      </Labeled>
      <Labeled label="文件字段名">
        <DraftInput draft={props.draft} name="field" label="文件字段名" placeholder="file" testID="image-host-field" />
      </Labeled>
      <Labeled label="请求头（可选，一行一个「名字: 值」）">
        <Input
          testID="image-host-headers"
          value={props.draft().headers}
          onChange={({ value }) => props.draft.update((d) => ({ ...d, headers: value }))}
          multiline
          submitBehavior="newline"
          placeholder="Authorization: Bearer xxx"
          accessibilityLabel="请求头"
          autoCapitalize="none"
          autoCorrect={false}
          class="h-[72px] rounded-(--radius-sm) border border-input bg-background px-2 py-1 font-mono text-[12px] leading-5 text-foreground placeholder:text-faint focus:border-primary"
        />
        <If when={props.headerNames.length > 0}>
          <Text testID="image-host-header-names" class={NOTE}>
            {`已设置：${props.headerNames.join("、")}（值不显示）。留空就不改，填了就整个换掉；要去掉已设置的，先「不再用图床」再重新设置。`}
          </Text>
        </If>
      </Labeled>
      <Labeled label="返回里图片地址的位置（可选）">
        <DraftInput draft={props.draft} name="urlPath" label="返回里图片地址的位置" placeholder="留空自动找，比如 data.url" testID="image-host-path" />
      </Labeled>
    </>
  );
}

/** GitHub 仓库的四项；`hasToken`：网关里已经存着令牌（留空就不改）。 */
function GithubFields(props: { draft: Draft; hasToken: boolean }) {
  return (
    <>
      <Text class={NOTE}>图片提交到这个仓库，正文写 raw.githubusercontent.com 的地址，所以仓库要是公开的。令牌建议用 fine-grained token，只给这一个仓库的 Contents 读写权限；它存在本机网关的配置里，页面读不回。</Text>
      <Labeled label="仓库（用户/仓库）">
        <DraftInput draft={props.draft} name="repo" label="仓库" placeholder="octocat/images" testID="image-host-repo" autoFocus />
      </Labeled>
      <Labeled label="分支">
        <DraftInput draft={props.draft} name="branch" label="分支" placeholder="main" testID="image-host-branch" />
      </Labeled>
      <Labeled label="目录">
        <DraftInput draft={props.draft} name="dir" label="目录" placeholder="images" testID="image-host-dir" />
      </Labeled>
      <Labeled label="令牌">
        <DraftInput draft={props.draft} name="token" label="令牌" placeholder={props.hasToken ? "已设置，留空就不改" : "github_pat_…"} testID="image-host-token" masked />
      </Labeled>
    </>
  );
}

/**
 * `current`：现在的配置（改的时候填进去；密钥只知道有没有）。`onSaved`：存成以后调。
 * `children`：放在保存按钮左边的别的按钮（取消、这次存本地……）。
 */
export function ImageHostForm(props: { current: ImageHostView | null; saveLabel: string; onSaved: () => void; children?: JSX.Element }) {
  const kind = signal<HostKind>(kindOf(props.current));
  const draft = signal<HostDraft>(draftOf(props.current));
  const problem = signal("");
  const saving = signal(false);
  const save = async () => {
    const input = toInput(kind(), draft(), props.current);
    if (typeof input === "string") return problem.set(input);
    const api = imageHost();
    if (!api) return problem.set("要连着本机网关才能设置图床");
    problem.set("");
    saving.set(true);
    try {
      await api.set(input);
      props.onSaved();
    } catch (e) {
      console.error("image host not saved", e);
      problem.set(`没能保存：${messageOf(e)}`);
    } finally {
      saving.set(false);
    }
  };
  const c = props.current;
  return (
    <View testID="image-host-form" class="gap-3">
      <KindPicker kind={kind} />
      <If when={kind() === "github"} else={<UploadFields draft={draft} headerNames={c && c.kind !== "github" ? c.headerNames : []} />}>
        <GithubFields draft={draft} hasToken={c?.kind === "github" && c.hasToken} />
      </If>
      <If when={problem()}>
        {(text) => (
          <Text testID="image-host-problem" role="alert" class="select-text text-xs leading-5 text-destructive">
            {text()}
          </Text>
        )}
      </If>
      <View class="flex-row flex-wrap justify-end gap-1">
        {props.children}
        <Button testID="image-host-save" label={saving() ? "正在保存…" : props.saveLabel} variant="primary" disabled={saving()} onPress={() => void save()} />
      </View>
    </View>
  );
}
