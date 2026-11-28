import { t } from "../../i18n";
import { macLibraryPath } from "./file-store";

/** 在访达里选中文库中的文件或文件夹。路径先经 macLibraryPath 校验在文库内；`open` 的授权见 nsh.json 的 capabilities.process。 */
export async function revealInFinder(id: string, folder = false): Promise<void> {
  const path = await macLibraryPath(id, folder);
  const { run } = await import("process");
  const result = await run("/usr/bin/open", ["-R", path]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || t("没能在访达中显示。", "Could not reveal in Finder."));
}
