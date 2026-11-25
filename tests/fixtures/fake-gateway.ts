/**
 * 进程内的假网关：按 gateway/src/protocol.ts 回请求、推 changed，给 gateway-store 的测试用（无头测试连不了真 WebSocket）。
 * 版本是「内容 + 序号」，只要内容变了就变，和真网关一样只拿来比相等。
 */
import { type ImageHostInput, type ImageHostView, PROTOCOL_VERSION } from "../../gateway/src/protocol";
import type { Connect, SocketEvents } from "../../src/store/gateway-store";

export function fakeGateway(seed: Record<string, string>) {
  const docs = new Map(Object.entries(seed));
  const versions = new Map<string, string>();
  let n = 0;
  const bump = (path: string) => versions.set(path, `v${(n += 1)}`);
  for (const path of docs.keys()) bump(path);
  let peer: SocketEvents | null = null;
  const state = {
    up: true,
    connects: 0,
    library: "Notes",
    /** 这些请求收下了但永远不回。 */
    mute: [] as string[],
    /** 这个请求照做，但回复之前连接断了（回包丢了）；做一次就清掉。 */
    dropAfter: null as string | null,
    /** 收到 hello 后用这个关闭码断开（网关拒绝来源 4003 之类）。 */
    closeOnHello: null as number | null,
    /** 某种请求原样回这段文字（假装是个乱回话的程序），`$id` 换成请求的序号。 */
    raw: {} as Record<string, string>,
    /** 换掉 hello 的结果。 */
    hello: null as object | null,
    /** transfer 的结果，按地址：给 base64 就当下载成功，给错误码就失败；没列的回 fetch-failed。 */
    downloads: {} as Record<string, { data: string } | { code: string }>,
    /** 图床配置（页面看到的样子）；null 是没设置。 */
    imageHost: null as ImageHostView | null,
    /** GitHub 图床存着的令牌；上传时不等于 `goodToken` 就回 upload-failed（假装 GitHub 不认）。 */
    githubToken: null as string | null,
    goodToken: "github_pat_good",
    /** 旧网关：不认图床的三个 op，回 bad-request。 */
    noImageHostOps: false,
    /** uploadImage 一律回这个错误码（图床挂了）；null 是传得上。 */
    uploadFails: null as string | null,
    /** uploadImage 晚多少毫秒回（图床慢）。 */
    uploadDelay: 0,
    /** 传上去的张数：图床地址按它编号。 */
    uploads: 0,
  };
  /** 图片：文库内路径 → base64。名字按内容编号，同一张图只存一份。 */
  const assets = new Map<string, string>();
  const dirOf = (doc?: string) => (doc && doc.includes("/") ? doc.slice(0, doc.lastIndexOf("/") + 1) : "");
  const storeAsset = (doc: string | undefined, data: string) => {
    const known = [...assets].find(([p, d]) => d === data && p.startsWith(`${dirOf(doc)}assets/`));
    const path = known?.[0] ?? `${dirOf(doc)}assets/img${assets.size + 1}.png`;
    assets.set(path, data);
    return { path, src: path.slice(dirOf(doc).length), existed: !!known };
  };

  const fail = (code: string, message: string, version?: string) => ({ ok: false, error: { code, message, ...(version ? { version } : {}) } });
  function answer(m: Record<string, string>): object {
    const path = m.path;
    switch (m.op) {
      case "hello":
        return { ok: true, result: state.hello ?? { version: PROTOCOL_VERSION, library: state.library } };
      case "list":
        return { ok: true, result: { docs: [...docs].map(([p, t]) => ({ path: p, size: t.length, mtimeMs: 1, ...(p.startsWith("bad") ? { problem: "not-utf8" } : {}) })) } };
      case "read":
        return docs.has(path) ? { ok: true, result: { text: docs.get(path), version: versions.get(path) } } : fail("not-found", "找不到");
      case "write":
        if (!docs.has(path)) return fail("not-found", "找不到");
        if (versions.get(path) !== m.baseVersion) return fail("conflict", "文件在别处改过了", versions.get(path));
        docs.set(path, m.text);
        bump(path);
        return { ok: true, result: { version: versions.get(path) } };
      case "create":
        if (docs.has(path)) return fail("exists", "已存在");
        docs.set(path, m.text ?? "");
        bump(path);
        return { ok: true, result: { version: versions.get(path) } };
      case "rename":
        if (docs.has(m.to)) return fail("exists", "已存在");
        docs.set(m.to, docs.get(path) ?? "");
        versions.set(m.to, versions.get(path) ?? "");
        docs.delete(path);
        return { ok: true, result: {} };
      case "remove":
        docs.delete(path);
        return { ok: true, result: {} };
      case "putAsset":
        return { ok: true, result: storeAsset(m.doc, m.data) };
      case "getAsset": {
        const at = `${dirOf(m.doc)}${m.src}`;
        return assets.has(at) ? { ok: true, result: { path: at, mime: "image/png", data: assets.get(at) } } : fail("not-found", "找不到");
      }
      case "transfer": {
        if (m.direction !== "download") return fail("not-supported", "不支持");
        const got = state.downloads[m.url];
        if (!got) return fail("fetch-failed", "下载失败");
        return "code" in got ? fail(got.code, got.code) : { ok: true, result: storeAsset(m.doc, got.data) };
      }
      case "imageHost":
      case "setImageHost":
      case "uploadImage":
        return imageHostAnswer(m as unknown as Record<string, unknown>);
      default:
        return fail("not-supported", "不支持");
    }
  }

  /** 存配置：和真网关一样，密钥（请求头、令牌）不给就留着原来的，换了种类不留。 */
  function setHost(host: ImageHostInput | null): object {
    const was = state.imageHost;
    if (host === null) {
      state.imageHost = null;
      state.githubToken = null;
      return { ok: true, result: {} };
    }
    if (host.kind === "github") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(host.repo)) return fail("bad-request", "bad repo");
      const token = host.token ?? (was?.kind === "github" ? state.githubToken : null);
      if (!token) return fail("bad-request", "no token");
      state.githubToken = token;
      state.imageHost = { kind: "github", repo: host.repo, branch: host.branch, dir: host.dir, hasToken: true };
      return { ok: true, result: {} };
    }
    if (!/^https?:\/\//.test(host.url)) return fail("bad-url", "bad url");
    const headerNames = host.headers ? Object.keys(host.headers) : was && was.kind !== "github" ? was.headerNames : [];
    state.imageHost = { url: host.url, field: host.field, urlPath: host.urlPath, headerNames };
    return { ok: true, result: {} };
  }

  function upload(): object {
    const h = state.imageHost;
    if (!h) return fail("no-image-host", "no image host");
    if (state.uploadFails) return fail(state.uploadFails, "图床回了 HTTP 500");
    if (h.kind === "github" && state.githubToken !== state.goodToken) return fail("upload-failed", "GitHub 不认这个令牌（401）：令牌不对或者过期了");
    state.uploads += 1;
    const url = h.kind === "github" ? `https://raw.githubusercontent.com/${h.repo}/${h.branch}/${h.dir}/up${state.uploads}.png` : `https://img.example.com/up${state.uploads}.png`;
    return { ok: true, result: { url } };
  }

  function imageHostAnswer(m: Record<string, unknown>): object {
    if (state.noImageHostOps) return fail("bad-request", "unknown op");
    if (m.op === "imageHost") return { ok: true, result: { host: state.imageHost } };
    return m.op === "setImageHost" ? setHost(m.host as ImageHostInput | null) : upload();
  }

  /** 和真 WebSocket 一样：哪一边关的，过一会儿都会报一次 close。 */
  const hangUp = (events: SocketEvents, code: number) => {
    if (peer === events) peer = null;
    setTimeout(() => events.close(code), 0);
  };
  const connect: Connect = async (_url, events) => {
    if (!state.up) throw new Error("连不上网关（1006）");
    state.connects += 1;
    peer = events;
    let open = true;
    return {
      send(text) {
        const m = JSON.parse(text) as Record<string, string> & { id: number };
        if (m.op === "hello" && state.closeOnHello !== null) return hangUp(events, state.closeOnHello);
        if (state.mute.includes(m.op)) return;
        if (m.op in state.raw) return void setTimeout(() => events.message(state.raw[m.op].replace("$id", String(m.id))), 0);
        const reply = { type: "reply", id: m.id, ...answer(m) };
        if (state.dropAfter === m.op) {
          state.dropAfter = null;
          open = false;
          return hangUp(events, 1006);
        }
        setTimeout(() => events.message(JSON.stringify(reply)), m.op === "uploadImage" ? state.uploadDelay : 0);
      },
      close() {
        if (!open) return;
        open = false;
        hangUp(events, 1005);
      },
    };
  };

  return {
    docs,
    assets,
    state,
    connect,
    /** 别的程序改了文件：内容变了，推一条 changed。 */
    edit(path: string, text: string) {
      docs.set(path, text);
      bump(path);
      peer?.message(JSON.stringify({ type: "changed", changes: [{ path, version: versions.get(path) }] }));
    },
    /** 别处（另一个标签页）改了名：和真网关一样，旧路径消失、新路径出现在同一批推送里。 */
    renameElsewhere(from: string, to: string) {
      const version = versions.get(from) ?? null;
      docs.set(to, docs.get(from) ?? "");
      versions.set(to, version ?? "");
      docs.delete(from);
      peer?.message(JSON.stringify({ type: "changed", changes: [{ path: from, version: null }, { path: to, version }] }));
    },
    /** 把自己刚写的那一版再推一次（网关的文件监听也会报自己的写入）。 */
    echo(path: string) {
      peer?.message(JSON.stringify({ type: "changed", changes: [{ path, version: versions.get(path) ?? null }] }));
    },
    /** 连接断了（网关被停掉）。`up` 决定重连时连不连得上。 */
    drop(code = 1006) {
      const p = peer;
      peer = null;
      p?.close(code);
    },
  };
}
