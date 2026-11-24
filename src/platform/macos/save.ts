/** 桌面应用里把一段文字存进「下载」文件夹（nsh 0.6.0 没有「存储为…」对话框，用户 2026-11-24 定：先存到下载）。 */

/** 同名文件最多往后找多少个序号，找不到空位就报错，不无限找下去。 */
const MAX_COPIES = 200;

function numbered(name: string, n: number): string {
  if (n === 0) return name;
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? `${name} ${n + 1}` : `${name.slice(0, dot)} ${n + 1}${name.slice(dot)}`;
}

/**
 * 存到 `~/Downloads/<name>`，已有同名文件时加序号（`笔记 2.md`），不覆盖。返回存下的完整路径。
 * 要 nsh.json 的 `capabilities.fs` 给「下载」文件夹读写；nsh 一次最多写 8 MiB，超过时它会报错。
 */
export async function saveToDownloads(name: string, text: string): Promise<string> {
  const { exists, writeFile } = await import("fs/promises");
  const { homedir } = await import("os");
  const folder = `${homedir()}/Downloads`;
  for (let n = 0; n < MAX_COPIES; n++) {
    const path = `${folder}/${numbered(name, n)}`;
    if (await exists(path)) continue;
    await writeFile(path, text);
    return path;
  }
  throw new Error(`「下载」里同名的文件太多了（${name}）`);
}
