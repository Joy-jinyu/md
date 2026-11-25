import { OFFICIAL_ORIGIN } from "./protocol.ts";

/** 是不是浏览器 Origin 头的写法：http(s)://host[:port]，不带路径，默认端口不写。 */
export function isOrigin(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && u.origin === s;
  } catch {
    return false;
  }
}

/** 允许连 WebSocket 的页面来源：线上页面，加上启动参数 --origin 显式给的。没有「开发时全放开」。 */
export function allowedOrigins(extra: readonly string[] = []): string[] {
  return [OFFICIAL_ORIGIN, ...extra];
}

/** 升级请求的 Origin 是否在白名单里。浏览器一定会带 Origin，没带的一律拒绝。 */
export function checkUpgrade(origin: string | undefined, allowed: readonly string[]): boolean {
  return origin !== undefined && allowed.includes(origin);
}

/**
 * Host 头只认 127.0.0.1:<端口> 和 localhost:<端口>：别的域名解析到 127.0.0.1（DNS rebinding）时，
 * 浏览器带的是那个域名。
 */
export function checkHost(host: string | undefined, port: number): boolean {
  const h = host?.toLowerCase();
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}
