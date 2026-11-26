/** 桌面应用里把一段文字存进「下载」文件夹（nsh 0.6.0 没有「存储为…」对话框，用户 2026-11-24 定：先存到下载）。 */
import { t } from "../../i18n";
import { MAX_FILE_BYTES } from "./file-store";

/** 同名文件最多往后找多少个序号，找不到空位就报错，不无限找下去。 */
const MAX_COPIES = 200;

function numbered(name: string, n: number): string {
  if (n === 0) return name;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? `${name} ${n + 1}` : `${name.slice(0, dot)} ${n + 1}${name.slice(dot)}`;
}

/**
 * 存到 `~/Downloads/<name>`，已有同名文件时加序号（`笔记 2.md`），不覆盖。返回存下的完整路径。
 * 要 nsh.json 的 `capabilities.fs` 给「下载」文件夹读写；nsh 一次最多写 8 MiB，超过时先挡下、报给人看的话（不然是 nsh 的原始错误）。
 */
export async function saveToDownloads(name: string, text: string): Promise<string> {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error(t(`「${name}」超过 8 MB，应用一次写不进去`, `“${name}” exceeds the 8 MB write limit`));
  const { exists, writeFile } = await import("fs/promises");
  const { homedir } = await import("os");
  const folder = `${homedir()}/Downloads`;
  for (let n = 0; n < MAX_COPIES; n++) {
    const path = `${folder}/${numbered(name, n)}`;
    if (await exists(path)) continue;
    await writeFile(path, text);
    return path;
  }
  throw new Error(t(`「下载」里同名的文件太多了（${name}）`, `Too many copies of “${name}” in Downloads`));
}
