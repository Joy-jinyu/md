/** 图床表单：设置页「存储」和「设置图床」对话框共用。布局见 DESIGN.md「屏幕：设置」的「图床表单」。 */
import { type JSX, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { messageOf } from "../../doc/message";
import { imageHost } from "../../store/backend";
import type { ImageHostInput, ImageHostView } from "../../store/document-store";
import { Button } from "../../ui/button";

const FIELD = "h-8 rounded-(--radius-sm) border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-faint focus:border-primary";
const HTTP_URL = /^https?:\/\/[^\s/]+\S*$/i;
/** HTTP 头的名字能用的字符（RFC 9110 的 token）。 */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** 请求头一行一个「名字：值」；空行跳过。写法不对返回给人看的原因。 */
function parseHeaders(text: string): Record<string, string> | string {
  const headers: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim() : "";
    if (!HEADER_NAME.test(name)) return `第 ${i + 1} 行的请求头写法不对，要写成「名字：值」`;
    headers[name] = line.slice(colon + 1).trim();
  }
  return headers;
}

/** 填的内容 → 要存的配置；不合法返回原因。请求头留空：已有配置时不改（不传 headers），新设置时是没有请求头。 */
function toInput(url: string, field: string, headers: string, urlPath: string, hasCurrent: boolean): ImageHostInput | string {
  const address = url.trim();
  if (!HTTP_URL.test(address)) return "上传地址要是 http:// 或 https:// 开头的完整地址";
  const base = { url: address, field: field.trim() || "file", urlPath: urlPath.trim() };
  if (headers.trim() === "") return hasCurrent ? base : { ...base, headers: {} };
  const parsed = parseHeaders(headers);
  return typeof parsed === "string" ? parsed : { ...base, headers: parsed };
}

function Labeled(props: { label: string; children: JSX.Element }) {
  return (
    <View class="gap-1">
      <Text class="text-[11px] text-faint">{props.label}</Text>
      {props.children}
    </View>
  );
}

/** 请求头输入框；`named`：已设置的头的名字（值页面读不回）。 */
function HeadersField(props: { value: string; onChange: (value: string) => void; named: string[] }) {
  return (
    <Labeled label="请求头（可选，一行一个「名字: 值」）">
      <Input
        testID="image-host-headers"
        value={props.value}
        onChange={({ value }) => props.onChange(value)}
        multiline
        submitBehavior="newline"
        placeholder="Authorization: Bearer xxx"
        accessibilityLabel="请求头"
        autoCapitalize="none"
        autoCorrect={false}
        class="h-[72px] rounded-(--radius-sm) border border-input bg-background px-2 py-1 font-mono text-[12px] leading-5 text-foreground placeholder:text-faint focus:border-primary"
      />
      <If when={props.named.length > 0}>
        <Text testID="image-host-header-names" class="select-text text-xs leading-5 text-muted-foreground">
          {`已设置：${props.named.join("、")}（值不显示）。留空就不改，填了就整个换掉；要去掉已设置的，先「不再用图床」再重新设置。`}
        </Text>
      </If>
    </Labeled>
  );
}

/**
 * `current`：现在的配置（改的时候填进去；请求头只知道名字）。`onSaved`：存成以后调。
 * `children`：放在保存按钮左边的别的按钮（取消、这次存本地……）。
 */
export function ImageHostForm(props: { current: ImageHostView | null; saveLabel: string; onSaved: () => void; children?: JSX.Element }) {
  const url = signal(props.current?.url ?? "");
  const field = signal(props.current?.field ?? "file");
  const headers = signal("");
  const urlPath = signal(props.current?.urlPath ?? "");
  const problem = signal("");
  const saving = signal(false);
  const save = async () => {
    const input = toInput(url(), field(), headers(), urlPath(), props.current !== null);
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
  return (
    <View testID="image-host-form" class="gap-3">
      <Labeled label="上传地址">
        <Input testID="image-host-url" autoFocus value={url()} onChange={({ value }) => url.set(value)} placeholder="https://example.com/upload" accessibilityLabel="上传地址" autoCapitalize="none" autoCorrect={false} class={FIELD} />
      </Labeled>
      <Labeled label="文件字段名">
        <Input testID="image-host-field" value={field()} onChange={({ value }) => field.set(value)} placeholder="file" accessibilityLabel="文件字段名" autoCapitalize="none" autoCorrect={false} class={FIELD} />
      </Labeled>
      <HeadersField value={headers()} onChange={(v) => headers.set(v)} named={props.current?.headerNames ?? []} />
      <Labeled label="返回里图片地址的位置（可选）">
        <Input testID="image-host-path" value={urlPath()} onChange={({ value }) => urlPath.set(value)} placeholder="留空自动找，比如 data.url" accessibilityLabel="返回里图片地址的位置" autoCapitalize="none" autoCorrect={false} class={FIELD} />
      </Labeled>
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
