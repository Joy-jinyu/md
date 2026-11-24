import { expect, test } from "nsh/test";
import { flush, latestDocument, loadDocument, markChanged, replaceDocument } from "../src/store/document";

test("changes reported by the old editor while a file is replacing the document are not kept", async () => {
  await loadDocument();
  markChanged(() => "old edit");
  const replacing = replaceDocument("# New\n");
  // 写入还没完成，旧编辑器又报了一次改动
  markChanged(() => "late edit from the old editor");
  expect((await replacing).ok).toBe(true);
  // 写完以后、编辑页重新载入之前，再报也不收
  markChanged(() => "later still");
  await flush();
  expect(latestDocument()).toBe("# New\n");
  // 重新载入之后恢复正常
  expect(await loadDocument()).toBe("# New\n");
  markChanged(() => "# New\n\nedited\n");
  expect(latestDocument()).toBe("# New\n\nedited\n");
  await flush();
  expect(await loadDocument()).toBe("# New\n\nedited\n");
});
