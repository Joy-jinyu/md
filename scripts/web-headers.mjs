/**
 * 生成网页版的 `_headers`（Cloudflare Workers 静态资源按它给响应加头）：`node scripts/web-headers.mjs <产物目录>`，make build-web 末尾调。
 * 为什么要这层：nsh.json 为了外链图片放了 `network.http` 任意域名 GET，nsh 生成的 `connect-src` 跟着放成任意域名；
 * 响应头再给一条只列白名单的 `connect-src`，浏览器两条都要满足，页面的 fetch / WebSocket 就只能连白名单，图片（<img>）不受影响。
 * 白名单唯一来源是 nsh.json：`capabilities.network.hosts`（只给 https）+ `web.connect`（本机网关，只给 ws）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOST = /^[a-z0-9.-]+$/i;
const HOST_PORT = /^[a-z0-9.-]+:\d+$/i;

function sources(config) {
  const hosts = config.capabilities?.network?.hosts ?? [];
  const connect = config.web?.connect ?? [];
  const bad = [...hosts.filter((h) => !HOST.test(h)), ...connect.filter((c) => !HOST_PORT.test(c))];
  if (bad.length > 0) throw new Error(`nsh.json 里这些地址不是「域名」或「主机:端口」，不能写进 connect-src：${bad.join(", ")}`);
  return ["'self'", ...hosts.map((h) => `https://${h}`), ...connect.map((c) => `ws://${c}`)];
}

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error("用法：node scripts/web-headers.mjs <产物目录>");
const config = JSON.parse(readFileSync(new URL("../nsh.json", import.meta.url), "utf8"));
const csp = [`connect-src ${sources(config).join(" ")}`, "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"].join("; ");
const text = ["/*", `  Content-Security-Policy: ${csp}`, "  Referrer-Policy: no-referrer", "  X-Content-Type-Options: nosniff", ""].join("\n");
writeFileSync(join(outDir, "_headers"), text);
console.log(`写好了 ${join(outDir, "_headers")}`);
