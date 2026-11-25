/**
 * 把页面的 WebSocket 换成连进程内假网关的替身（`gateway-app.tsx` 先引它）：无头测试连不了真网关，整个应用要跑在网关后端上时用。
 * 假网关怎么设由 `open` 的 `host.params` 给：`docs`（文库里的文档）、`imageHost`、`githubToken`、`noImageHostOps`、`uploadFails`、`uploadDelay`（同 fake-gateway 的 state）。
 */
import { host } from "nsh";
import { fakeGateway } from "./fake-gateway";

const params = host.params as unknown as { docs?: Record<string, string>; imageHost?: unknown; githubToken?: string; noImageHostOps?: boolean; uploadFails?: string; uploadDelay?: number };
const gw = fakeGateway(params.docs ?? {});
Object.assign(gw.state, {
  imageHost: params.imageHost ?? null,
  noImageHostOps: params.noImageHostOps ?? false,
  uploadFails: params.uploadFails ?? null,
  uploadDelay: params.uploadDelay ?? 0,
  githubToken: params.githubToken ?? null,
});

class FakeWebSocket {
  onopen: ((e: object) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  private socket: { send(text: string): void; close(): void } | null = null;

  constructor(url: string) {
    const events = { message: (data: string) => this.onmessage?.({ data }), close: (code: number) => this.onclose?.({ code }) };
    gw.connect(url, events, new Promise(() => undefined)).then(
      (s) => {
        this.socket = s;
        this.onopen?.({});
      },
      () => this.onclose?.({ code: 1006 }),
    );
  }

  send(text: string) {
    this.socket?.send(text);
  }

  close() {
    this.socket?.close();
  }
}

(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
