/**
 * 存进文档库的图片：按文件头认类型、按内容取文件名、把正文里的地址换成文库里的路径。三种后端共用，规则和网关一致
 * （gateway/src/image.mts 的 sniffImage、gateway/src/paths.mts 的 assetPathFromSrc）。
 */
import { ASSET_DIR, IMAGE_TYPES, type ImageExt } from "../../gateway/src/protocol";

/** 认得的图片类型（扩展名 → MIME）：features 经这里拿，不直接引 gateway/。 */
export { IMAGE_TYPES };

/** 取出来给界面显示的一张图：类型（按文件头认的）和字节。 */
export interface AssetData {
  mime: string;
  bytes: Uint8Array;
}

/** 图片存不进去（类型不认、太大）：`message` 直接给人看。 */
export class AssetRejected extends Error {}

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/** 按文件头认图片类型，认不出（含 SVG 和别的文本）是 null。不信扩展名和 MIME。 */
export function sniffImage(b: Uint8Array): ImageExt | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpg";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(b, 8, 12))) return "avif";
  return null;
}

export const mimeOf = (ext: ImageExt) => IMAGE_TYPES[ext];

const MIB = 1024 * 1024;

/** 查一张要存的图：认得的类型、不超过 `maxBytes`。不合格抛 AssetRejected（给人看的话）。返回扩展名。 */
export function checkImage(bytes: Uint8Array, maxBytes: number): ImageExt {
  if (bytes.length > maxBytes) throw new AssetRejected(`图片超过 ${Math.round(maxBytes / MIB)} MB，先压缩一下再放进来`);
  const ext = sniffImage(bytes);
  if (!ext) throw new AssetRejected("不是认得的图片格式（只收 png、jpg、gif、webp、avif；SVG 不收）");
  return ext;
}

/** 图片的文件名：内容 SHA-256 的前 16 位 + 扩展名（和网关一样），同一张图只存一份。 */
export function assetName(bytes: Uint8Array, ext: ImageExt): string {
  return `${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${ext}`;
}

/** 字节 → base64（网关协议里图片按 base64 传；导出 HTML 时内联成 data: 地址）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** base64 → 字节；不是合法的 base64 时抛错。 */
export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 正文里写的相对地址：一律 `assets/<文件名>`（图片放在文档所在目录的 assets/ 下）。 */
export const assetSrc = (name: string) => `${ASSET_DIR}/${name}`;

/** 地址带协议（`http:`、`data:`、`file:`……）或以 `/` 开头：不是相对路径。 */
const ABSOLUTE = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/)/;

/** 是不是文档旁边的相对路径图片（`assets/x.png`、`./img/a.jpg`）。 */
export const isRelativeSrc = (src: string) => src !== "" && !ABSOLUTE.test(src.trim());

/** 正文里的地址：先去掉 `?…`、`#…`（`assets/a.png?v=1` 也是 a.png），再解开 URL 编码（`%20`）；解不开照原样。 */
function decodeSrc(src: string): string {
  const path = src.trim().replace(/[?#][\s\S]*$/, "");
  try {
    return decodeURIComponent(path);
  } catch (e) {
    console.warn("image address not decodable", e);
    return path;
  }
}

/**
 * 正文里的图片地址（相对文档所在目录）→ 文库里的相对路径；不合规是 null（不读）：
 * 带协议或绝对路径、`..` 跳出文库、碰隐藏文件、不在某个 assets/ 目录下、扩展名不是认得的图片。
 */
export function assetPathFromSrc(docId: string, src: string): string | null {
  const raw = decodeSrc(src);
  if (!isRelativeSrc(raw) || raw.includes("\\") || raw.includes("\u0000")) return null;
  const parts = [...docId.split("/").slice(0, -1)];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    if (seg.startsWith(".")) return null;
    parts.push(seg);
  }
  const name = parts[parts.length - 1] ?? "";
  const dot = name.lastIndexOf(".");
  const ext = name.slice(dot + 1).toLowerCase();
  if (dot <= 0 || parts.length < 2 || parts[parts.length - 2].toLowerCase() !== ASSET_DIR || !(ext in IMAGE_TYPES)) return null;
  return parts.join("/");
}
