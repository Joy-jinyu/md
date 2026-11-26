# 站点 Worker 的 /token：网页版登录换 token

网页版 Pairdown 用 GitHub 的网页授权登录：GitHub 授权后带着 `code` 回到页面，页面要拿 `code` 换 token。换 token 要 client secret，而且 `github.com/login/oauth/access_token` 不支持浏览器跨域，所以由站点自己的 Cloudflare Worker 在同源的 `/token` 上代办。macOS 应用走 Device Flow，不用它。

站点是一个 Worker（项目 `pairdown`，配置在仓库根目录的 `wrangler.jsonc`）：静态文件是 nsh 打包的网页，脚本是这里的 `src/worker.mts`。`assets.run_worker_first` 只有 `/token`，别的请求不经过脚本，直接回静态文件。

`/token` 只做一件事：`POST /token`，请求体 `{"code", "state", "code_verifier", "redirect_uri"}`（只认这四个字段；`redirect_uri` 必须逐字符等于「本站来源 + `/`」，也就是 OAuth App 登记的回调地址），`Origin` 必须等于本站（同源；别的来源、没带 Origin 回 403）；带上 client id 和 client secret，连同 `code_verifier`、`redirect_uri` 去 GitHub 换 token，返回 `{"access_token", "token_type", "scope"}`，失败时返回 `{"error": "<GitHub 的错误码>"}`。同源请求不需要跨域头，回包不带 `Access-Control-*`，预检（OPTIONS）回 405。请求体超过 2KB 回 413（先看 Content-Length，再边读边数，不整个读进来）。`state` 由页面自己校验，Worker 不转发给 GitHub。不记日志（没有 `console.*`，`wrangler.jsonc` 里关了 observability）。

网页登录用 PKCE（S256）：页面发起授权时生成 `code_verifier`、把它的 SHA-256 作为 `code_challenge` 带给 GitHub 授权页，回来换 token 时由这里转交 `code_verifier`。GitHub 的 OAuth App 文档写了支持（`code_challenge_method` 只收 `S256`），App 设置里不用另外打开。

token 会不会过期（待核实）：OAuth App 有没有「Token expiration」选项不确定（GitHub App 才确定有），没在 App 设置页里核对过。应用里没有刷新 token 的逻辑：真会过期的话，过期后 GitHub 回 401，应用退出登录，要重新登录。

## 1. 建 GitHub OAuth App

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App（`<站点>` 是部署配置的 `PAIRDOWN_SITE`）：

| 项 | 填什么 |
|---|---|
| Application name | Pairdown |
| Homepage URL | `<站点>/` |
| Authorization callback URL | `<站点>/`（网页登录回到这里；页面传的 `redirect_uri` 固定是这一个，见 `src/sync/config.ts` 的 `oauthCallbackUrl`，两边必须逐字符一致） |
| Enable Device Flow | 勾上（macOS 应用要用） |

建好后记下 **Client ID**，再点 Generate a new client secret 记下 **client secret**（只显示一次，不要存进仓库）。权限（scope）由应用请求时指定，只要 `gist`。

## 2. 配置和发布

```bash
# 页面要的：仓库根目录的 .env（照 .env.example），CI 里是同名的仓库 secret
PAIRDOWN_SITE=https://<站点>
PAIRDOWN_GITHUB_CLIENT_ID=<Client ID>

# Worker 要的 client secret：存成站点 Worker 的 secret（只设一次，以后每次发布都保留），在仓库根目录跑
npx wrangler@4 login
npx wrangler@4 secret put GITHUB_CLIENT_SECRET   # 粘贴 client secret

make deploy-web   # 打包并发布：绑 PAIRDOWN_SITE 的域名，client id 用 --var 从 PAIRDOWN_GITHUB_CLIENT_ID 传给 Worker（和页面同一个值）
```

本机开发页（`make dev-web`）登不上：GitHub 只把登录送回 App 登记的回调地址。要在本机试网页登录，得另建一个回调是本机地址的开发用 OAuth App，用 `wrangler dev` 起站点 Worker。

撤销：OAuth App 在 GitHub → Settings → Developer settings → Pairdown → Advanced 里删；Worker 的 secret 用 `npx wrangler@4 secret delete GITHUB_CLIENT_SECRET` 删。

## 待办

- 限流：现在没有。被人拿来刷 GitHub 的 token 接口时只能靠 GitHub 自己的限制；要加就用 Cloudflare 的 Rate Limiting 规则或 Workers 的 rate limit binding，按来源 IP 限。

## 测试

```bash
cd worker && node --test test/*.test.mts   # 要 Node 23.6 以上（直接跑 .mts）
```

`src/worker.mts` 的 `handle(request, env, fetchFn)` 是纯函数（Request → Response），测试里把去 GitHub 的那一步换成假的。
