/** 设置里的「语言」一类：界面语言，改了马上生效。布局见 DESIGN.md「屏幕：设置」。 */
import { signal, View } from "nsh";
import { changeLocale, locale, t } from "../../i18n";
import type { Locale } from "../../store/settings";
import { Callout, Group, Row, Segmented } from "./parts";

export function LanguagePanel() {
  const problem = signal(false);
  let attempt = 0;
  async function select(value: Locale) {
    const current = ++attempt;
    problem.set(false);
    const error = await changeLocale(value);
    if (current === attempt) problem.set(error !== null);
  }
  return (
    <View class="gap-4">
      <Group>
        <Row
          label={t("界面语言", "Interface language")}
          description={t("编辑器、设置、命令和菜单都用这种语言，文档内容和文件名不变。", "Used for the editor, settings, commands, and menus. Documents and file names stay as they are.")}
          control={
            <Segmented<Locale>
              label={t("界面语言", "Interface language")}
              value={locale()}
              options={[
                { value: "en", label: "English", testID: "language-en" },
                { value: "zh-CN", label: "简体中文", testID: "language-zh-CN" },
              ]}
              onChange={(value) => void select(value)}
            />
          }
        />
      </Group>
      <If when={problem()}>
        <Callout tone="danger">{t("没能保存语言设置，请再试一次。", "Could not save the language preference. Try again.")}</Callout>
      </If>
    </View>
  );
}
