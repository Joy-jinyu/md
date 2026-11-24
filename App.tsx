import { mount } from "nsh";
import { Head } from "nsh/web";
import { EditorScreen } from "./src/features/editor/EditorScreen";

/** 网页标题和简介（原生应用里 Head 不起作用，窗口名取 nsh.json 的 name）。 */
function App() {
  return (
    <>
      <Head title="Pairdown" description="所见即所得的 Markdown 编辑器，文档只存在你的设备上。" lang="zh-CN" />
      <EditorScreen />
    </>
  );
}

mount(App);
