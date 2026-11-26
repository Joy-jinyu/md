import { mount, signal } from "nsh";
import { Head } from "nsh/web";
import { APP_DESCRIPTION, APP_TITLE } from "./src/app-meta";
import { EditorScreen } from "./src/features/editor/EditorScreen";
import { initializeLocale, locale } from "./src/i18n";

function App() {
  const ready = signal(false);
  void initializeLocale().then(() => ready.set(true));
  return (
    <>
      <Head
        title={APP_TITLE}
        description={APP_DESCRIPTION}
        lang={locale()}
      />
      <If when={ready()}>
        <EditorScreen />
      </If>
    </>
  );
}

mount(App);
