# pairdown-auth：网页版登录的中转 Worker

网页版 Pairdown 用 GitHub 的网页授权登录：GitHub 授权后带着 `code` 回到页面，页面要拿 `code` 换 token。换 token 要 client secret，而且 `github.com/login/oauth/access_token` 不支持浏览器跨域，所以经这个 Cloudflare Worker 中转。macOS 应用走 Device Flow，不用它。

它只做一件事：`POST /token`，请求体 `{"code", "state", "code_verifier", "redirect_uri"}`（只认这四个字段；`redirect_uri` 的来源也得在 `ALLOWED_DOMAINS` 里），来源（`Origin`）必须在 `ALLOWED_DOMAINS` 里；带上 client id 和 client secret，连同 `code_verifier`、`redirect_uri` 去 GitHub 换 token，返回 `{"access_token", "token_type", "scope"}`，失败时返回 `{"error": "<GitHub 的错误码>"}`。请求体超过 2KB 回 413（先看 Content-Length，再边读边数，不整个读进来）。`state` 由页面自己校验，Worker 不转发给 GitHub。不记日志（没有 `console.*`，`wrangler.toml` 里关了 observability）。

网页登录用 PKCE（S256）：页面发起授权时生成 `code_verifier`、把它的 SHA-256 作为 `code_challenge` 带给 GitHub 授权页，回来换 token 时由这里转交 `code_verifier`。GitHub 的 OAuth App 文档写了支持（`code_challenge_method` 只收 `S256`），App 设置里不用另外打开。

## 现状（2026-11-25）

- OAuth App「Pairdown」已建（Client ID `Ov23liULOP1R8U49R9od`，回调 `https://markdown.pairwise.site/`，Device Flow 已开）。
- Worker 已部署：`https://pairdown-auth.1825326327.workers.dev`，`ALLOWED_DOMAINS` 只有 `https://markdown.pairwise.site`。实测：不带 Origin / 别的 Origin 回 403 `origin_not_allowed`。
- client secret 已存进 Worker 的 secret（`GITHUB_CLIENT_SECRET`）。实测：对的来源带假 code，回 400 `{"error":"bad_verification_code"}`（GitHub 的错误码原样转回）；预检回 204。
- `src/sync/config.ts`、`nsh.json` 已填。网页登录要等站点带着新配置重新发布（`make deploy-web`）才生效；macOS 的 Device Flow 不经过这个 Worker，重新打包就能用。
- token 会不会过期（待核实）：之前记的是「App 的 Optional features → Token expiration 默认开着、token 8 小时过期」，但 OAuth App 有没有这个选项不确定（GitHub App 才确定有），没在 App 设置页里核对过，不能当事实。应用里没有刷新 token 的逻辑：真会过期的话，过期后 GitHub 回 401，应用退出登录，要重新登录。

**这个目录里的 wrangler 命令一定要带 `--config ./wrangler.toml`**：wrangler 先往上找 `wrangler.json(c)`，会找到仓库根目录那份站点配置（项目 `pairdown`）。2026-11-25 实测：在 `worker/` 下不带 `--config` 跑 `wrangler deploy`，发布的是网页站点而不是这个 Worker（当时已回滚到原版本）；`secret put`、`delete` 同理，不带就会落到站点那个项目上。

撤销：`cd worker && npx wrangler@4 delete --config ./wrangler.toml`；OAuth App 在 GitHub → Settings → Developer settings → Pairdown → Advanced 里删。

下面是从头做一遍的步骤。

## 1. 建 GitHub OAuth App

GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:

| 项 | 填什么 |
|---|---|
| Application name | Pairdown |
| Homepage URL | `https://markdown.pairwise.site/` |
| Authorization callback URL | `https://markdown.pairwise.site/`（网页登录回到这里；页面传的 `redirect_uri` 是当前页面地址去掉参数，必须在它之下） |
| Enable Device Flow | 勾上（macOS 应用要用） |

建好后记下 **Client ID**，再点 Generate a new client secret 记下 **client secret**（只显示一次，不要存进仓库）。权限（scope）由应用请求时指定，只要 `gist`。

## 2. 部署 Worker

```bash
cd worker
# wrangler.toml 里填上 GITHUB_CLIENT_ID；ALLOWED_DOMAINS 写页面的 origin（只写 OAuth App 回调地址所在的源）
# 本机开发页（http://127.0.0.1:8811）登不上：GitHub 只把登录送回 App 登记的回调地址，光把它加进 ALLOWED_DOMAINS 没用。
# 要在本机试网页登录，得另建一个回调是 http://127.0.0.1:8811/ 的开发用 OAuth App 和对应的 Worker 配置。
npx wrangler@4 login
npx wrangler@4 deploy --config ./wrangler.toml
npx wrangler@4 secret put GITHUB_CLIENT_SECRET --config ./wrangler.toml   # 粘贴 client secret
```

部署后会给一个地址，比如 `https://pairdown-auth.<账号>.workers.dev`（也可以绑自定义域名）。

## 3. 让应用用上

1. `src/sync/config.ts`：`GITHUB_CLIENT_ID` 填 Client ID，`AUTH_WORKER_URL` 填 Worker 地址（不带结尾的 `/`）。
2. `nsh.json`：Worker 的域名加进 `capabilities.network.hosts`（网页的 `connect-src` 也由它生成；`api.github.com`、`github.com`、`gist.githubusercontent.com` 已经在里面）。
3. 重新打包发布（`make build-web`、`make deploy-web`、`make build-mac`）。

## 待办

- 限流：现在没有。被人拿来刷 GitHub 的 token 接口时只能靠 GitHub 自己的限制；要加就用 Cloudflare 的 Rate Limiting 规则或 Workers 的 rate limit binding，按来源 IP 限。

## 测试

```bash
cd worker && node --test test/*.test.mts   # 要 Node 23.6 以上（直接跑 .mts）
```

`src/worker.mts` 的 `handle(request, env, fetchFn)` 是纯函数（Request → Response），测试里把去 GitHub 的那一步换成假的。
