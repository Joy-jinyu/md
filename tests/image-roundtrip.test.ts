import { setNodeAttribute, setNodeSelection } from "nsh/base";
import { expect, test } from "nsh/test";
import { imgTag, parseImgTag } from "../src/doc/img-tag";
import { dumpMarkdown } from "../src/features/editor/convert";
import { canResize, imagesIn } from "../src/features/editor/images";
import { assetPathFromSrc, isRelativeSrc } from "../src/store/image-file";
import { forceRewrite, normalize, openDoc, reread, type Node } from "./fixtures/kit";

const imageAttrs = (nodes: Node[]) => {
  const out: Record<string, unknown>[] = [];
  const walk = (list: Node[]) => list.forEach((n) => (n.type === "image" ? out.push(n.attrs ?? {}) : walk(n.content ?? [])));
  walk(nodes);
  return out.map((a) => ({ src: a.src, alt: a.alt, width: a.width ?? null, align: a.align ?? null }));
};

test("an <img> with a width or an alignment is read as an image; other <img> tags stay as written", () => {
  const doc = '<img src="a.png" width="50%" align="center">\n\nx <img src="b.png" alt="B" width="120"> y\n\n<img src="c.png" style="w" width="9">\n\n<img src="d.png">\n';
  const nodes = normalize(openDoc(doc).json);
  expect(imageAttrs(nodes)).toEqual([
    { src: "a.png", alt: "", width: "50%", align: "center" },
    { src: "b.png", alt: "B", width: "120", align: null },
  ]);
  expect(nodes.filter((n) => n.type === "rawBlock").map((n) => n.attrs?.src)).toEqual(['<img src="c.png" style="w" width="9">', '<img src="d.png">']);
});

test("resizing and aligning an image writes an <img> that reads back the same; clearing both goes back to ![]()", () => {
  const o = openDoc("# T\n\n![pic](assets/a.png)\n\ntail\n");
  const pos = imagesIn(o.session.getJSON() as Node)[0].pos;
  o.session.run(setNodeAttribute(pos, "width", "50%"));
  o.session.run(setNodeAttribute(pos, "align", "center"));
  const sized = dumpMarkdown(o.session.getJSON(), o.origin);
  expect(sized).toBe('# T\n\n<img src="assets/a.png" alt="pic" width="50%" align="center">\n\ntail\n');
  expect(reread(sized)).toEqual(normalize(o.session.getJSON()));
  const again = openDoc(sized);
  expect(forceRewrite(again)).toBe(sized);
  o.session.run(setNodeAttribute(pos, "width", null));
  o.session.run(setNodeAttribute(pos, "align", null));
  expect(dumpMarkdown(o.session.getJSON(), o.origin)).toBe("# T\n\n![pic](assets/a.png)\n\ntail\n");
});

test("an untouched document with images is written back byte for byte", () => {
  const doc = '<img src="assets/a.png" width="50%">\n\n![x](assets/b%20c.png "t")\n\nmid <img src="q.png" align="right"> end\n';
  const o = openDoc(doc);
  expect(dumpMarkdown(o.session.getJSON(), o.origin)).toBe(doc);
  expect(reread(forceRewrite(o))).toEqual(normalize(o.json));
});

test("img tags: quotes and ampersands survive, odd values are not read", () => {
  const image = { src: 'a&b".png', alt: "x < y", title: 'say "hi" & go', width: "300", align: "right" as const };
  expect(parseImgTag(imgTag(image))).toEqual(image);
  expect(parseImgTag(imgTag({ ...image, alt: "a|b" }, true))).toEqual({ ...image, alt: "a|b" });
  expect(imgTag({ ...image, alt: "a|b" }, true).includes("|")).toBe(false);
  expect(parseImgTag('<img src="a.png" width="auto">')).toBe(null);
  expect(parseImgTag('<img src="a.png" align="middle">')).toBe(null);
  expect(parseImgTag('<img src="a.png" onerror="x()" width="3">')).toBe(null);
  expect(parseImgTag('<img src="a.png">')).toBe(null);
});

test("image addresses resolve inside the library only, under an assets folder", () => {
  expect(assetPathFromSrc("notes/a.md", "assets/x.png")).toBe("notes/assets/x.png");
  expect(assetPathFromSrc("notes/a.md", "./assets/x%20y.png")).toBe("notes/assets/x y.png");
  expect(assetPathFromSrc("notes/a.md", "../assets/x.png")).toBe("assets/x.png");
  expect(assetPathFromSrc("a.md", "../assets/x.png")).toBe(null);
  expect(assetPathFromSrc("a.md", "assets/../../x.png")).toBe(null);
  expect(assetPathFromSrc("a.md", "assets/.x.png")).toBe(null);
  expect(assetPathFromSrc("a.md", "img/x.png")).toBe(null);
  expect(assetPathFromSrc("a.md", "assets/x.svg")).toBe(null);
  expect(assetPathFromSrc("a.md", "/etc/assets/x.png")).toBe(null);
  expect(assetPathFromSrc("a.md", "file:///x/assets/a.png")).toBe(null);
  expect([isRelativeSrc("assets/a.png"), isRelativeSrc("https://x/a.png"), isRelativeSrc("data:image/png;base64,AA"), isRelativeSrc("//x/a.png")]).toEqual([true, false, false, false]);
});

test("an <img> value with a numeric entity reads its character; an unknown named entity keeps the tag as written", () => {
  expect(parseImgTag('<img src="a&#x26;b.png" alt="it&#39;s" width="100">')).toEqual({ src: "a&b.png", alt: "it's", title: null, width: "100", align: null });
  expect(parseImgTag('<img src="a.png" alt="x&nbsp;y" width="100">')).toBe(null);
  expect(parseImgTag('<img src="a.png" alt="&#0;" width="100">')).toBe(null);
  const o = openDoc('<img src="a&#x26;b.png" alt="it&#39;s" width="100">\n');
  expect(imageAttrs(normalize(o.json))).toEqual([{ src: "a&b.png", alt: "it's", width: "100", align: null }]);
  expect(reread(forceRewrite(o))).toEqual(normalize(o.json));
});

/** 改宽度、对齐以后写出、读回：和编辑器里的一样，再写一遍也不变（每个位置都要过）。 */
const RESIZE_CASES = [
  "- ![a](assets/a.png)\n- two\n",
  "1. ![a](assets/a.png)\n",
  "- [ ] ![a](assets/a.png)\n",
  "> ![a](assets/a.png)\n",
  "> - ![a](assets/a.png)\n",
  "| h | i |\n| --- | --- |\n| ![a\\|b](assets/a.png) | x |\n",
  "# ![a](assets/a.png) head\n",
  "**![a](assets/a.png)** and text\n",
  '![a](b.png "t")\n',
  '- ![a](assets/a.png "ti\\"tle")\n',
];

test("a resized image in a list, a quote, a table, a heading or with a title reads back as the same image, and writing it again changes nothing", () => {
  for (const doc of RESIZE_CASES) {
    for (const [name, value] of [["width", "50%"], ["align", "center"]] as const) {
      const o = openDoc(doc);
      o.session.run(setNodeAttribute(imagesIn(o.session.getJSON() as Node)[0].pos, name, value));
      const sized = dumpMarkdown(o.session.getJSON(), o.origin);
      expect({ doc, sized, back: reread(sized) }).toEqual({ doc, sized, back: normalize(o.session.getJSON()) });
      expect({ doc, again: forceRewrite(openDoc(sized)) }).toEqual({ doc, again: sized });
    }
  }
});

test("an image inside a link cannot be resized: the link and the image survive even if a width is set", () => {
  const doc = "[![alt](assets/a.png)](https://e.com)\n";
  const o = openDoc(doc);
  const pos = imagesIn(o.session.getJSON() as Node)[0].pos;
  o.session.run(setNodeSelection(pos));
  expect(canResize(o.session)).toBe(false);
  o.session.run(setNodeAttribute(pos, "width", "50%"));
  const md = dumpMarkdown(o.session.getJSON(), o.origin);
  expect(md).toBe(doc);
  expect(imageAttrs(reread(md))).toEqual([{ src: "assets/a.png", alt: "alt", width: null, align: null }]);
  const plain = openDoc("![alt](assets/a.png)\n");
  plain.session.run(setNodeSelection(imagesIn(plain.session.getJSON() as Node)[0].pos));
  expect(canResize(plain.session)).toBe(true);
});

test("an alt text with a line break or a pipe does not split a table row, written as ![]() or as <img>", () => {
  for (const width of [null, "50%"]) {
    const o = openDoc("| h |\n| --- |\n| ![](assets/a.png) |\n");
    const pos = imagesIn(o.session.getJSON() as Node)[0].pos;
    o.session.run(setNodeAttribute(pos, "alt", "line1\nline2 | x"));
    o.session.run(setNodeAttribute(pos, "width", width));
    const md = dumpMarkdown(o.session.getJSON(), o.origin);
    expect(imageAttrs(reread(md))).toEqual([{ src: "assets/a.png", alt: "line1 line2 | x", width, align: null }]);
    expect(forceRewrite(openDoc(md))).toBe(md);
  }
});

test("an address with ?query or #fragment still finds the image file", () => {
  expect(assetPathFromSrc("n/a.md", "assets/x.png?v=1")).toBe("n/assets/x.png");
  expect(assetPathFromSrc("a.md", "assets/x.png#top")).toBe("assets/x.png");
  expect(assetPathFromSrc("a.md", "assets/x.svg?v=.png")).toBe(null);
});
