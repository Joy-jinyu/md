/**
 * 这一轮要新建 Gist 的文档（还没上传过的）：逐篇勾选，确认后才上传，没勾的标成「不同步这篇」。已经连着 Gist 的推、拉不经过这里。
 * 布局见 DESIGN.md「M5：同步」的「还没上传过的」一节。
 */
import { t } from "../../i18n";
import { signal, Text, View } from "nsh";
import { Checkbox } from "nsh/base";
import { Button } from "../../ui/button";
import type { Issue } from "./engine";
import { holdUploads, resolving, uploadChosen } from "./resolve";

type Upload = Extract<Issue, { kind: "upload" }>;

export function UploadConfirm(props: { issue: Upload }) {
  // 记没勾的：再同步一次换了一批文档时，新列出来的默认勾上
  const unpicked = signal<ReadonlySet<string>>(new Set());
  const picked = (id: string) => !unpicked().has(id);
  const chosen = () => new Set(props.issue.docs.filter((d) => picked(d.id)).map((d) => d.id));
  const flip = (id: string, on: boolean) =>
    unpicked.update((set) => {
      const next = new Set(set);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  const busy = () => resolving() !== null;
  const count = () => chosen().size;
  return (
    <View testID="sync-upload" class="gap-2 rounded-(--radius-sm) bg-card px-3 py-2">
      <Text class="select-text text-[13px] font-medium text-strong">{t(`这 ${props.issue.docs.length} 篇还没上传过`, `${props.issue.docs.length} ${props.issue.docs.length === 1 ? "document has" : "documents have"} never been uploaded`)}</Text>
      <Text class="select-text text-xs leading-5 text-muted-foreground">{t("勾上的每篇建成一个私密 Gist（不公开列出，拿到链接的人能看）。没勾的标成「不同步这篇」，以后打开那篇、在同步面板里点「恢复同步」就会同步。", "Each selected document becomes a secret Gist. Anyone with the link can read it. Unselected documents are excluded from sync. You can resume syncing any of them in the sync panel.")}</Text>
      <View class="gap-1">
        <Each of={props.issue.docs} key={(d) => d.id}>
          {(doc) => (
            <Checkbox
              testID={`sync-upload-pick-${doc().id}`}
              checked={picked(doc().id)}
              onChange={({ checked }) => flip(doc().id, checked)}
              class="min-h-7 flex-row items-center gap-2 rounded-(--radius-sm) px-1 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              indicatorClass="h-4 w-4 items-center justify-center rounded-(--radius-sm) border border-border bg-background checked:border-primary checked:bg-primary"
              indicator={
                <If when={picked(doc().id)}>
                  <Text class="text-[11px] leading-none text-primary-foreground">✓</Text>
                </If>
              }
            >
              <Text style={{ numberOfLines: 1 }} class="min-w-0 flex-1 text-[13px] text-foreground">
                {doc().name}
              </Text>
            </Checkbox>
          )}
        </Each>
      </View>
      <View class="flex-row flex-wrap justify-end gap-1">
        <Button testID="sync-upload-later" label={t("先不上传", "Upload later")} disabled={busy()} onPress={() => holdUploads(props.issue)} />
        <Button
          testID="sync-upload-confirm"
          label={count() > 0 ? t(`上传这 ${count()} 篇`, `Upload ${count()} ${count() === 1 ? "document" : "documents"}`) : t("这些都不同步", "Exclude all from sync")}
          variant="primary"
          disabled={busy()}
          onPress={() => void uploadChosen(props.issue, chosen())}
        />
      </View>
    </View>
  );
}
