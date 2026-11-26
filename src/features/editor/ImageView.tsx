/**
 * 图片节点的视图：相对路径向存储要字节、转成 blob 地址显示（Image 只拿到这个地址，用完回收）；
 * 外链（http / https）直接交给 Image 载入（网页上靠响应头的 CSP 只放开图片，见 .claude/rules/security.md）；载入失败显示地址、原因和「在浏览器打开」「转存到本地」；
 * 载入中、找不到、载入失败、地址不支持都有占位，不留空白。宽度按百分比或像素，对齐左 / 中 / 右。
 */
import { cleanup, effect, Image, type JSX, signal, Text, untracked, View } from "nsh";
import type { RichNodeViewProps } from "nsh/base";
import { t } from "../../i18n";
import { canTransfer, documentStore } from "../../store/backend";
import { isRelativeSrc, mimeOf, sniffImage } from "../../store/image-file";
import { currentDocId } from "../../store/library";
import { Button } from "../../ui/button";
import { pageUrl } from "../sync/page-url";
import { noteNodeViewLayout } from "./doc-index";
import { columnWidth, isExternalSrc, transferImage } from "./images";
import { openLink } from "./links";
import { nodePress } from "./node-press";

type Size = { width: number; height: number };

type Shown =
  | { kind: "loading"; size?: Size }
  | ({ kind: "ready"; url: string } & Size)
  | { kind: "remoteFailed"; text: () => string }
  | { kind: "problem"; text: () => string };

/** 内嵌的 data: 图片直接给 Image 显示：只认位图类型（SVG 能带脚本，不显示）。 */
const DATA_RASTER = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i;

const attrOf = (p: RichNodeViewProps, name: string) => {
  const v = p.node.attrs[name];
  return v === null || v === undefined ? "" : String(v);
};

/** 设了宽度、没载入过的图片在载入前的占位高度：不知道比例，取一个体感上不太高也不太矮的值，载入后变一次到真实高度。 */
const UNKNOWN_HEIGHT = 120;

/**
 * 这次运行里载入过的图片的原图大小：节点视图重建（改了别处、撤销、重开文档）时直接按它占位，不回到「正在载入图片…」再跳回图片高度。
 * 外链和内嵌图片按地址记，文档库里的图片按「文档 id + 路径」记（blob 地址每次重建都换）。
 */
const knownSizes = new Map<string, Size>();

/** 显示宽度：百分比按正文列算；像素和原图都不超过正文列。 */
function displayWidth(width: string, natural: number): number {
  const col = columnWidth();
  if (width.endsWith("%")) return Math.max(16, Math.round((col * Math.min(100, Number(width.slice(0, -1)))) / 100));
  const px = width === "" ? natural : Number(width);
  return Math.max(16, Math.min(col, px || col));
}

/** 相对路径：取字节 → 按文件头认类型 → blob 地址 → 量原图大小。 */
async function loadAsset(docId: string | null, src: string, keep: (url: string) => void): Promise<Shown> {
  if (!docId) return { kind: "problem", text: () => t(`找不到图片：${src}`, `Image not found: ${src}`) };
  try {
    const asset = await documentStore.getAsset(docId, src);
    if (!asset) return { kind: "problem", text: () => t(`找不到图片：${src}`, `Image not found: ${src}`) };
    const ext = sniffImage(asset.bytes);
    if (!ext) return { kind: "problem", text: () => t(`不是认得的图片：${src}`, `Unrecognized image format: ${src}`) };
    const url = URL.createObjectURL(new Blob([asset.bytes], { type: mimeOf(ext) }));
    keep(url);
    const size = await Image.getSize(url);
    knownSizes.set(`${docId}\n${src}`, size);
    return { kind: "ready", url, width: size.width, height: size.height };
  } catch (e) {
    console.warn("image not loaded", src, e);
    return { kind: "problem", text: () => t(`图片载入失败：${src}（${e instanceof Error ? e.message : String(e)}）`, `Could not load image: ${src} (${e instanceof Error ? e.message : String(e)})`) };
  }
}

/** 地址直接交给 Image（内嵌位图、外链）：先量原图大小，失败时显示 `failed()`。 */
async function loadDirect(src: string, failed: () => Shown): Promise<Shown> {
  try {
    const size = await Image.getSize(src);
    knownSizes.set(src, size);
    return { kind: "ready", url: src, width: size.width, height: size.height };
  } catch (e) {
    console.warn("image not loaded", src.slice(0, 80), e);
    return failed();
  }
}

/** 外链载入失败的原因。https 页面里的 http 图片：浏览器先试着换成 https，换不成就拦下，应用分不出是哪种失败，只按地址和页面推断。 */
function remoteFailure(src: string): string {
  if (/^http:/i.test(src) && /^https:/i.test(pageUrl() ?? "")) return t("外链图片没载入：这是 http 地址，https 的网页里浏览器不让载入（换成 https 地址，或在浏览器里打开）", "The linked image could not load because the browser blocks HTTP images on HTTPS pages. Use an HTTPS URL or open the image in your browser.");
  return t("外链图片没载入：地址不对、对方网站不让引用，或者没有网络", "The linked image could not load. Check the URL, network connection, or the site's image-linking policy.");
}

function Placeholder(props: { selected: boolean; width?: number; children: JSX.Element }) {
  return (
    <View
      testID="image-placeholder"
      class="max-w-full gap-1 rounded-(--radius-sm) border border-dashed bg-muted px-3 py-2"
      style={props.width ? { width: props.width, height: UNKNOWN_HEIGHT, maxWidth: columnWidth() } : { maxWidth: columnWidth() }}
      classList={{ "border-primary": props.selected, "border-border-strong": !props.selected }}
    >
      {props.children}
    </View>
  );
}

function RemoteFailed(props: { src: string; text: string; selected: boolean; editor: RichNodeViewProps["editor"] }) {
  const transfer = nodePress(() => void transferImage(props.editor, props.src));
  const browse = nodePress(() => void openLink(props.src, () => false));
  return (
    <Placeholder selected={props.selected}>
      <Text class="text-[12px] text-muted-foreground">{props.text}</Text>
      <Text style={{ numberOfLines: 1 }} class="font-mono text-[13px] text-foreground">
        {props.src}
      </Text>
      <View class="flex-row flex-wrap gap-1">
        <If when={canTransfer()}>
          <View {...transfer.mouse}>
            <Button testID="image-transfer" label={t("转存到本地", "Save a local copy")} onPress={transfer.onPress} />
          </View>
        </If>
        <View {...browse.mouse}>
          <Button label={t("在浏览器打开", "Open in browser")} accessibilityLabel={t("在浏览器里打开这张图片", "Open this image in the browser")} onPress={browse.onPress} />
        </View>
      </View>
    </Placeholder>
  );
}

export function ImageView(p: RichNodeViewProps) {
  const shown = signal<Shown>({ kind: "loading" });
  let blob: string | null = null;
  const release = () => {
    if (blob) URL.revokeObjectURL(blob);
    blob = null;
  };
  let generation = 0;
  let loadedSrc: string | null = null;
  effect(() => {
    const src = attrOf(p, "src").trim();
    // 选中、取消选中、改宽度和对齐时节点的属性会整份换新，这个 effect 也会重跑；地址没变就不重新载入，不然会先回到占位再跳回图片（闪一下、下面的内容跳动）
    if (src === loadedSrc) return;
    loadedSrc = src;
    untracked(() => {
      release();
      const mine = ++generation;
      const settle = (next: Shown) => mine === generation && shown.set(next);
      if (isExternalSrc(src) || DATA_RASTER.test(src)) {
        const known = knownSizes.get(src);
        if (known) return settle({ kind: "ready", url: src, ...known });
        settle({ kind: "loading" });
        const failed = (): Shown => (isExternalSrc(src) ? { kind: "remoteFailed", text: () => remoteFailure(src) } : { kind: "problem", text: () => t("内嵌图片载入失败", "Could not load the embedded image") });
        return void loadDirect(src, failed).then(settle);
      }
      if (!isRelativeSrc(src)) return settle({ kind: "problem", text: () => t(`不支持的图片地址：${src.slice(0, 80)}。只显示文档旁边 assets/ 里的图、http(s) 外链和内嵌的位图；把图片重新插入一次（粘贴或「插入图片…」）就会存进文档库`, `Unsupported image address: ${src.slice(0, 80)}. Use an image in the document’s assets/ folder, an HTTP(S) URL, or an embedded bitmap. Paste the image again or use Insert Image to save it to the library.`) });
      const docId = currentDocId();
      settle({ kind: "loading", size: knownSizes.get(`${docId}\n${src}`) });
      void loadAsset(docId, src, (url) => (mine === generation ? (blob = url) : URL.revokeObjectURL(url))).then(settle);
    });
  });
  cleanup(release);

  const align = () => attrOf(p, "align");
  const alt = () => attrOf(p, "alt");
  const box = (s: Size) => {
    const w = displayWidth(attrOf(p, "width"), s.width);
    return { width: w, height: Math.round((w * s.height) / Math.max(1, s.width)) };
  };
  const body = (): JSX.Element => {
    const s = shown();
    switch (s.kind) {
      case "ready":
        return (
          <View class="rounded-(--radius-sm) border-2" classList={{ "border-primary": p.selected, "border-transparent": !p.selected }}>
            <Image testID="image" src={s.url} role="image" accessibilityLabel={alt() || t("图片", "Image")} style={box(s)} />
          </View>
        );
      case "remoteFailed":
        return <RemoteFailed src={attrOf(p, "src").trim()} text={s.text()} selected={p.selected} editor={p.editor} />;
      case "loading":
        if (s.size) {
          return (
            <View class="rounded-(--radius-sm) border-2" classList={{ "border-primary": p.selected, "border-transparent": !p.selected }}>
              <View testID="image-sized-placeholder" accessibilityLabel={t("正在载入图片", "Loading image")} class="bg-muted" style={box(s.size)} />
            </View>
          );
        }
        return (
          <Placeholder selected={p.selected} width={attrOf(p, "width") ? displayWidth(attrOf(p, "width"), 0) : undefined}>
            <Text class="text-[12px] text-muted-foreground">{t("正在载入图片…", "Loading image…")}</Text>
          </Placeholder>
        );
      default:
        return (
          <Placeholder selected={p.selected}>
            <Text class="text-[13px] text-muted-foreground">{s.text()}</Text>
          </Placeholder>
        );
    }
  };
  return (
    <View
      onLayout={noteNodeViewLayout}
      style={align() ? { width: columnWidth() } : undefined}
      classList={{ "items-start": align() === "left", "items-center": align() === "center", "items-end": align() === "right" }}
    >
      {body()}
    </View>
  );
}
