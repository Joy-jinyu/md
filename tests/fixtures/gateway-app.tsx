/** 连着假网关的应用入口（测试 `open("./fixtures/gateway-app.tsx", { host: { params } })`）：先换掉 WebSocket，再启动应用。 */
import "./gateway-socket";
import "../../App";
