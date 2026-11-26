import { mount, signal } from "nsh";
import { Head } from "nsh/web";
import { EditorScreen } from "./src/features/editor/EditorScreen";
import { initializeLocale, locale, t } from "./src/i18n";

function App() {
  const ready = signal(false);
  void initializeLocale().then(() => ready.set(true));
  return (
    <>
      <Head
        title="Pairdown"
        description={t("所见即所得的 Markdown 编辑器，文档只存在你的设备上。", "A WYSIWYG Markdown editor that keeps documents on your device.")}
        lang={locale()}
      />
      <If when={ready()}>
        <EditorScreen />
      </If>
    </>
  );
}

mount(App);
