NSH ?= nsh
ENTRY := App.tsx

.PHONY: help dev dev-web check test verify build-web build-mac clean

help: ## 列出命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

dev: ## macOS 窗口里跑（热重载）
	$(NSH) run --target macos

dev-web: ## 浏览器里跑（热重载）
	$(NSH) run --target web

check: ## 类型检查
	$(NSH) check

# nsh test 递归查找 *.test.ts(x)；给目录时该目录要有 App.tsx，所以从根目录跑
test: ## 跑全部测试（tests/ 下）
	$(NSH) test .

verify: check test ## 类型检查 + 测试

# 产物多套一层应用名：dist/web/Pairdown/、dist/macos/Pairdown.app
build-web: ## 打包静态站到 dist/web/Pairdown/
	$(NSH) package $(ENTRY) --target web -o dist/web

build-mac: ## 打包到 dist/macos/Pairdown.app
	$(NSH) package $(ENTRY) --target macos -o dist/macos

clean: ## 删掉打包产物
	rm -rf dist
