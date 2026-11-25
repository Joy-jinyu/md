# Pairdown 本机网关

让线上页面（https://markdown.pairwise.site/）读写本机一个文件夹（文库）里的 `.md` 文档和图片。网关是一个 Node 进程，只听 `127.0.0.1`，页面用 WebSocket 连它。方案见实施计划第 10 节。

## 一条命令装好

```bash
curl -fsSL https://markdown.pairwise.site/gateway.sh | sh
# 第一次装时就换文库文件夹：
curl -fsSL https://markdown.pairwise.site/gateway.sh | sh -s -- --library ~/notes
```

脚本是本目录的 `install.sh`（`make build-web` 时放到站点根目录）。它把网关装到 `~/.pairdown`，在 macOS 上注册成 launchd 后台服务（`~/Library/LaunchAgents/site.pairwise.md.gateway.plist`，登录后自动启动、退出后自动拉起），并装上 `pairdown` 命令（链到 `/usr/local/bin`、`/opt/homebrew/bin`、`~/.local/bin` 里第一个能写的）。已经装过再跑，只提示已安装并显示状态。别的系统没有后台服务，脚本在前台启动。

```bash
pairdown                          # 状态和配置
pairdown config library ~/notes   # 换文库文件夹（自动重启）
pairdown config origins http://127.0.0.1:8811   # 额外放行的页面来源，none 清空
pairdown config autoUpdate off    # 关掉自动更新
pairdown start | stop | restart | logs | update | uninstall
```

配置在 `~/.pairdown/config.json`，日志在 `~/.pairdown/gateway.log`。

**自动更新**（`src/update.mts`，只有装成后台服务才有）：有页面连上来时（最多 10 分钟一次）取 `https://markdown.pairwise.site/gateway.version`（`make build-web` 写的，是 `gateway/` 目录的 git 树哈希），和装的时候记下的不一样就在后台重新下载 `main` 分支的 `gateway/`，等没有页面连着了退出，由 launchd 拉起新版。也就是说：这个仓库 `main` 分支上的网关代码会在装了的机器上自动运行，和第一次 `curl | sh` 是同一份信任。

## 图床

粘贴、拖进来的图片可以不存本地、直接传到你自己的图床：一个收 `multipart/form-data` 上传的接口（PicGo 的「自定义图床」那种，兰空、sm.ms、本机的 PicGo server 都是）。上传由网关发，页面只把图片字节交给网关。在页面的设置里填，或者：

```bash
pairdown config imageHost https://img.example.com/api/upload   # none 不再用图床
pairdown config imageHostField file                              # 放图片的表单字段名，默认 file
pairdown config imageHostHeader "Authorization: Bearer xxx"      # 上传时带的请求头，none 清空
pairdown config imageHostUrlPath data.url                        # 返回的 JSON 里图片地址在哪；auto 自动找
```

自动找依次试 `url`、`data.url`、`data.links.url`、`result.0`、`data.0`；返回不是 JSON 时把整段当地址。拿到的必须是 http(s) 地址。配置存在 `~/.pairdown/config.json` 的 `imageHost` 里（文件权限 600）；请求头的值不回给页面（页面只看得到名字）、不进日志。从源码直接跑的网关也读写这个文件。上传地址是用户自己填的，可以是本机地址（PicGo server 就在 127.0.0.1），不做内网检查。

## 从源码安装

要 Node 23.6 以上（直接跑 TypeScript，不用编译；本机开发用的是 v25）。

```bash
cd gateway
npm install
```

依赖只有 `ws`；`typescript`、`@types/*` 只用于类型检查。

除了 `src/protocol.ts`，网关的源码和测试都用 `.mts`：仓库根的 `tsconfig.json` 收 `**/*.ts`、`nsh test .` 递归找 `*.test.ts`，用 `.ts` 会被 `make check` / `make test` 当成页面代码去检查和运行。`protocol.ts` 不 import 任何东西，在 nsh 下也能通过检查，页面直接 import 它。

## 启动

```bash
node gateway/src/main.mts --library ~/Documents/Pairdown
# 本地开发页面（make dev-web）也要连时，显式加它的来源：
node gateway/src/main.mts --library ~/Documents/Pairdown --origin http://127.0.0.1:8811
```

| 参数 | 说明 |
|------|------|
| `--library <文件夹>` | 必填。文库文件夹，必须已存在。所有读写都限制在它里面 |
| `--port <端口>` | 默认 `7341`（`src/protocol.ts` 的 `DEFAULT_PORT`）。**页面固定连 7341**，改了端口页面就连不上；这个参数只用于开发、测试 |
| `--origin <来源>` | 额外放行的页面来源，写成 `http(s)://主机[:端口]`，可以写多次 |
| `-h`, `--help` | 打印说明 |

没有改监听地址的参数：`--host`、`--listen`、`--bind` 都会报错退出。按 Ctrl+C 停止。

## 检查和测试

```bash
cd gateway
npm run check   # tsc 类型检查
npm test        # node:test：起真网关、连真 WebSocket 跑
```

在仓库根目录也可以 `make test-gateway`（先按 package-lock.json 装依赖再跑测试），`make verify` 会连同页面的检查、测试和 Worker 的测试一起跑。

## 文库里的文件

- 文档：文库里（含子目录）所有 `.md` 文件。文档的 id 就是文库内的相对路径（`/` 分隔），如 `notes/a.md`。
- 图片：放在文档所在目录的 `assets/` 下，文件名是内容哈希（SHA-256 前 16 位）加扩展名，同一张图只存一份。
  只认 png、jpg、gif、webp、avif（按文件头判断，不信扩展名和 content-type）；不认 SVG（能带脚本）。
- 隐藏文件和目录（`.` 开头）不列、不读、不写；网关的临时文件也以 `.` 开头（`.pairdown-<随机>.tmp`），启动时清掉上次残留的。
- 文档必须是 UTF-8（开头的 BOM 原样保留）。不是 UTF-8 的（如 GBK）照样列出来但标 `problem: "not-utf8"`，`read` / `write` 回 `not-utf8`，网关不会把它读成乱码再写回去。
- 符号链接：指向的位置也要是文库里合规的文档 / 图片（不能指向文库外、隐藏文件、别的类型），否则当路径不合规。`write` 一个链接文档时写到它指向的文件，链接本身不动；`rename` / `remove` 动的是链接本身。

## 协议

类型和常量都在 `src/protocol.ts`，这个文件不 import 任何东西，页面那一侧直接用同一份。

- 一条 WebSocket 文本消息是一个 JSON。页面发 `{ id, op, ...参数 }`，网关回 `{ type: "reply", id, ok, result | error }`。
- 连上后第一条必须是 `hello`（带 `version: PROTOCOL_VERSION`）；不是 hello、或 10 秒（`HELLO_TIMEOUT_MS`）内不发，就断开（4000）；版本不同回 `version-mismatch` 后断开（4002）。
- 网关主动推 `{ type: "changed", changes: [{ path, version }] }`：文库里的文档或图片变了（含网关自己写的）。一批里某个文件读不了，只跳过它（记日志）。
- 网关主动推 `{ type: "relist" }`：有目录改名、删除、新建，页面重新 `list`，以新列表为准（目录里的文档不一定再单独推 changed）。
- `list` 的每项可能带 `problem`：`"not-utf8"` 或 `"too-large"`，这样的文档不能打开编辑。读不了的子目录、遍历中途消失的文件跳过并记日志。
- 错误码见 `ErrorCode`，含义发布后不变。

上限（常量都在 `src/protocol.ts`）：

| 项 | 上限 | 超了怎样 |
|----|------|---------|
| 单条消息 `MAX_MESSAGE_BYTES` | 16 MiB | 收不下，网关用 1009（`CLOSE_MESSAGE_TOO_BIG`）断开这条连接，回不了错误码；非法帧用 1002 断开。网关进程不受影响 |
| 单张图片 `MAX_ASSET_BYTES` | 10 MiB | `putAsset` / `transfer` / `getAsset` 回 `too-large`。图片字节按 base64 放进 JSON，约 11.9 MiB 以上的图片整条消息就超过 16 MiB，走上一行的断开，所以页面发之前先自己按 10 MiB 挡掉 |
| 单篇文档 `MAX_DOC_BYTES` | 5 MiB | `read` / `write` / `create` 回 `too-large`，`list` 里标 `problem: "too-large"` |
| 连接数 | 32 | 新连接握手后用 4004（`CLOSE_BUSY`）关掉 |
| 同时进行的 `transfer` | 4 | 回 `busy` |

**version 的定义**：文档内容（原始字节）的 SHA-256，十六进制。内容变了它一定变，和改动时间、文件大小无关，所以别的程序改了文件（哪怕大小没变、改动时间没变）也能发现。`write` / `remove` 带的 `baseVersion` 和磁盘上不一致时不写、不删，回 `conflict` 并带当前 `version`。

## 安全模型

| 规则 | 做法 | 测试 |
|------|------|------|
| 只听回环地址 | 监听地址写死 `127.0.0.1`（`LISTEN_HOST`），没有参数能改 | `test/cli.test.mts`、`test/gateway.test.mts`「只听 127.0.0.1」 |
| 只接受白名单页面 | WebSocket 升级时查 Origin：只放行 `https://markdown.pairwise.site` 和 `--origin` 显式加的；没有 Origin 也拒绝。拒绝时先握手再用 4003 关，页面能看到原因。没有「开发时全放开」 | `test/gateway.test.mts`「Origin」 |
| 防 DNS rebinding | Host 头只认 `127.0.0.1:<端口>`、`localhost:<端口>`，否则回 421 不握手 | 「Host 头」 |
| 路径不出文库 | 所有读、写、建、改名、删、取图片都过 `src/paths.mts` 的 `resolveInLibrary`：拒绝 `..`、绝对路径、隐藏文件、扩展名不对；按 `realpath` 解开符号链接后再查一遍，跳出文库、指向隐藏文件或别的类型都拒绝。目录名比较先 NFKC 再转小写（macOS 上 `aſsets` 就是 `assets`） | 「路径穿越」「符号链接」，`test/library-edge.test.mts` |
| 不覆盖、不留半个文件 | 写临时文件并 fsync，再改名；新建和存图片用硬链接，目标已存在就失败；写失败删掉临时文件，启动时清残留。`rename` 的目标是源的硬链接也算已存在 | 「读写」「create / rename」，`test/library-edge.test.mts` |
| 不写坏非 UTF-8 文档 | 解码用 fatal 的 `TextDecoder`，解不了回 `not-utf8`，`write` 前也查磁盘上的内容 | 「非 UTF-8」 |
| 一条连接拖不垮网关 | 每条 WebSocket 都挂 `error` 监听（超限消息、非法帧只断这一条）；hello 限时；连接数、`transfer` 并发有上限；op 只查自己的表（`constructor` 之类回 `bad-request`） | `test/connection.test.mts` |
| 转存只下公网图片 | 只放行 http / https；先解析域名，任何一个地址是回环 / 内网 / 链路本地 / 组播、内嵌 IPv4 的 IPv6 段（IPv4 映射 / 兼容、NAT64、6to4）等就不连；连接钉在检查过的地址上（不再查第二次 DNS）；每一跳重定向重新检查；content-type 必须是图片（不收 SVG），文件头还要再认一遍；限 10 MiB；15 秒超时 | `test/transfer.test.mts`（内网规则用注入的解析器验证） |
| 日志不打文档内容 | 日志只记被拒绝的连接和内部错误的信息；Host / Origin 头截到 120 字、去掉控制字符；文件错误只记错误码和调用名，不带绝对路径 | 「日志」 |

不在防护范围内：本机别的程序在路径检查和真正读写之间换掉符号链接（本机已经能动文库的程序本来就能改文件）。

## 页面侧接入要注意

- 页面的 `nsh.json` 里 `web.connect` 是 `["127.0.0.1:7341"]`，打包后 `connect-src` 是 `'self' http://127.0.0.1:7341 https://127.0.0.1:7341 ws://127.0.0.1:7341 wss://127.0.0.1:7341`（nsh 0.6.0 不收带协议的写法，`ws://…` 报 invalid host pattern）。换端口要同时改这里。页面侧实现在 `src/store/gateway-store.ts`。
- Chrome 对「公网页面连本机」有 Local Network Access 限制，实测结果见实施计划。
- 正文里的图片地址如果是 URL 编码过的（`%20`），页面先解码再发 `getAsset`。
- 收到 `changed` 时拿 `version` 和自己手上的比，相同就是自己刚写的。收到 `relist` 就重新 `list`。
- `list` 里带 `problem` 的文档显示出来但不让打开编辑；`read` 回 `not-utf8` / `too-large` 时给人看得懂的提示。
- 图片超过 10 MiB 在页面就挡掉，不要发 `putAsset`（太大的消息网关只能断开连接，见上面的上限表）。连接被 1009 / 4004 关掉时提示原因，别立刻重连刷屏。
- `rename` 只改文档本身，不搬它的 `assets/`。


## 已知问题

- Linux 上文库里有读不了的子目录（权限 000）时，Node 的递归监听会在内部抛 EACCES，网关可能退出（2026-11-25 CI 实测）。macOS 不受影响。对应的测试在 Linux 上跳过。
