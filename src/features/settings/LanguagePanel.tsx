import { signal, Text, View } from "nsh";
import { changeLocale, locale, t } from "../../i18n";
import type { Locale } from "../../store/settings";
import { Button } from "../../ui/button";

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
    <View class="gap-3">
      <View class="flex-row flex-wrap gap-2" accessibilityLabel={t("界面语言", "Interface language")}>
        <Button
          testID="language-en"
          label={locale() === "en" ? t("English（当前）", "English (current)") : "English"}
          variant={locale() === "en" ? "primary" : "ghost"}
          onPress={() => void select("en")}
        />
        <Button
          testID="language-zh-CN"
          label={locale() === "zh-CN" ? t("简体中文（当前）", "简体中文 (current)") : "简体中文"}
          variant={locale() === "zh-CN" ? "primary" : "ghost"}
          onPress={() => void select("zh-CN")}
        />
      </View>
      <If when={problem()}>
        <Text class="text-sm text-destructive">{t("没能保存语言设置，请再试一次。", "Could not save the language preference. Try again.")}</Text>
      </If>
    </View>
  );
}
