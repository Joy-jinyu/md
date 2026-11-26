NSH ?= nsh
ENTRY := App.tsx

.PHONY: help dev dev-web dev-landing check test test-gateway test-worker verify build-web build-mac deploy-web clean nsh-debt

help: ## 列出命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

dev: ## macOS 窗口里跑（热重载）
	$(NSH) run --target macos

dev-web: ## 浏览器里跑（热重载）
	$(NSH) run --target web

check: ## 类型检查
	$(NSH) check

# nsh test 递归查找 *.test.ts(x)；给目录时该目录要有 App.tsx，所以从根目录跑
# nsh 0.7.0 起默认按核数并行跑（全量约 30 秒）。机器很忙时量耗时的用例偶尔超时，单独重跑那个文件即可
test: ## 跑全部测试（tests/ 下）
	$(NSH) test .

# 网关、Worker 是 Node 程序（要 Node ≥ 23.6 直接跑 .mts）：有 package-lock.json 照它装（npm ci），没有就 npm install（不写锁文件）
NPM_INSTALL = if [ -f package-lock.json ]; then npm ci; else npm install --no-package-lock; fi

test-gateway: ## 跑本机网关的测试（gateway/）
	cd gateway && $(NPM_INSTALL) && node --test test/*.test.mts

test-worker: ## 跑登录中转 Worker 的测试（worker/）
	cd worker && $(NPM_INSTALL) && node --test test/*.test.mts

verify: check test test-gateway test-worker ## 类型检查 + 页面、网关、Worker 的测试

nsh-debt: ## 检查 NSH_DEBT.md 里的 nsh 债务是否还在（用本机装的 nsh；CI 每天跑一次）
	node .github/nsh-debt/check.mjs

# 产物多套一层应用名：dist/web/Pairdown/、dist/macos/Pairdown.app
build-web: ## 打包静态站到 dist/web/Pairdown/
	$(NSH) package $(ENTRY) --target web -o dist/web
	node scripts/web-headers.mjs dist/web/Pairdown
	cp gateway/install.sh dist/web/Pairdown/gateway.sh
	git rev-parse HEAD:gateway > dist/web/Pairdown/gateway.version
	mkdir -p dist/web/Pairdown/lp
	cp -R landing/. dist/web/Pairdown/lp/
	cp assets/icon/icon.png dist/web/Pairdown/lp/pairdown.png
	node scripts/web-loading.mjs dist/web/Pairdown

dev-landing: build-web ## 本机预览落地页：http://127.0.0.1:8813/lp/
	python3 -m http.server 8813 --bind 127.0.0.1 --directory dist/web/Pairdown

build-mac: ## 打包到 dist/macos/Pairdown.app
	$(NSH) package $(ENTRY) --target macos -o dist/macos

deploy-web: build-web ## 打包并发布到 Cloudflare（markdown.pairwise.site；要先 npx wrangler login）
	npx --yes wrangler@4 deploy

clean: ## 删掉打包产物
	rm -rf dist
