import { lookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { GatewayError } from "./errors.mts";
import { MAX_ASSET_BYTES } from "./protocol.ts";

/** 下载外链图片要用的外部能力，测试里换掉。 */
export type TransferDeps = {
  /** 主机名 → 它解析到的全部地址。 */
  resolve: (host: string) => Promise<string[]>;
  /** 这个地址能不能连：默认挡回环、内网、链路本地、组播等。 */
  forbidden: (address: string) => boolean;
  timeoutMs: number;
  maxRedirects: number;
  maxBytes: number;
};

// IPv4 和 IPv6 分两张表：同一张表里放 ::ffff:0:0/96 时，node 会把所有 IPv4 地址都当成命中它
const blocked4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked4.addSubnet(net, prefix, "ipv4");
// 内嵌 IPv4 的几段整段挡掉，里面可能藏着内网 IPv4：::ffff:0:0/96（IPv4 映射）、::/96（IPv4 兼容，已废弃）、
// 64:ff9b::/96 和 64:ff9b:1::/48（NAT64）、2002::/16（6to4）
const blocked6 = new BlockList();
for (const [net, prefix] of [
  ["::", 128], ["::1", 128], ["::", 96], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked6.addSubnet(net, prefix, "ipv6");

/** 回环、内网、链路本地、运营商 NAT、组播、保留地址：转存下载一律不连。认不出的地址也算不能连。 */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return family === 4 ? blocked4.check(address, "ipv4") : blocked6.check(address, "ipv6");
}

export const defaultTransferDeps: TransferDeps = {
  resolve: async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address),
  forbidden: isForbiddenAddress,
  timeoutMs: 15_000,
  maxRedirects: 5,
  maxBytes: MAX_ASSET_BYTES,
};

/** 只认 http / https 的完整网址。 */
function parseUrl(raw: unknown): URL {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw new GatewayError("bad-url", "网址写错了");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new GatewayError("bad-url", "只能下载 http / https 的图片");
  return u;
}

/**
 * 先解析、逐个检查地址，再把连接钉在检查过的地址上（lookup 不再查第二次 DNS），
 * 防止「检查时是公网、连接时变成内网」的 DNS rebinding。
 */
async function vettedLookup(u: URL, deps: TransferDeps): Promise<LookupFunction | undefined> {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host) !== 0;
  const addrs = literal ? [host] : await deps.resolve(host).catch(() => {
    throw new GatewayError("fetch-failed", `解析不了主机：${host}`);
  });
  if (addrs.length === 0 || addrs.some((a) => deps.forbidden(a))) {
    throw new GatewayError("forbidden-address", `不下载本机或内网地址：${host}`);
  }
  if (literal) return undefined;
  return (_h, opts, cb) => {
    const all = addrs.map((address) => ({ address, family: isIP(address) }));
    if (opts.all) (cb as (e: null, a: typeof all) => void)(null, all);
    else cb(null, all[0].address, all[0].family);
  };
}

/** 发一次 GET，不跟重定向。 */
async function requestOnce(u: URL, deps: TransferDeps, signal: AbortSignal): Promise<IncomingMessage> {
  const lookupFn = await vettedLookup(u, deps);
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(u, { lookup: lookupFn, signal, headers: { accept: "image/*", "user-agent": "Pairdown-Gateway" } }, resolve);
    req.on("error", (e) => reject(e instanceof GatewayError ? e : new GatewayError("fetch-failed", `下载失败：${e.message}`)));
  });
}

/** 收完响应体，超过上限就中止。 */
async function readBody(res: IncomingMessage, max: number): Promise<Buffer> {
  const declared = Number(res.headers["content-length"]);
  if (Number.isFinite(declared) && declared > max) throw new GatewayError("too-large", "图片超过 10 MiB");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res) {
    size += (chunk as Buffer).byteLength;
    if (size > max) {
      res.destroy();
      throw new GatewayError("too-large", "图片超过 10 MiB");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function checkImageResponse(res: IncomingMessage): void {
  const status = res.statusCode ?? 0;
  if (status < 200 || status >= 300) throw new GatewayError("fetch-failed", `服务器回了 ${status}`);
  const type = (res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/") || type === "image/svg+xml") throw new GatewayError("bad-type", `不是图片：${type || "没有类型"}`);
}

/** 下载外链图片的字节。每一跳重定向都重新检查协议和地址。图片类型最后还要由调用方按文件头再认一遍。 */
export async function downloadImage(raw: unknown, deps: TransferDeps = defaultTransferDeps): Promise<Buffer> {
  const signal = AbortSignal.timeout(deps.timeoutMs);
  let u = parseUrl(raw);
  try {
    for (let hop = 0; ; hop++) {
      const res = await requestOnce(u, deps, signal);
      const location = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume();
        if (hop >= deps.maxRedirects) throw new GatewayError("fetch-failed", "重定向太多");
        u = parseUrl(new URL(location, u).href);
        continue;
      }
      try {
        checkImageResponse(res);
        return await readBody(res, deps.maxBytes);
      } finally {
        res.resume();
      }
    }
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw new GatewayError("fetch-failed", signal.aborted ? "下载超时" : `下载失败：${(e as Error).message}`);
  }
}
