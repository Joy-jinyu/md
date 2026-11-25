#!/bin/sh
# Pairdown 本机网关：下载（或更新）到 ~/.pairdown/gateway 并启动。
#   curl -fsSL https://markdown.pairwise.site/gateway.sh | sh
# 换文库文件夹、加别的参数：… | sh -s -- --library ~/notes（参数原样交给网关，见 gateway/README.md）
set -eu

# 包成函数、最后一行才调：下载到一半断了不会执行半截脚本
main() {
  home="${PAIRDOWN_HOME:-$HOME/.pairdown}/gateway"
  source_url="https://codeload.github.com/Joy-jinyu/md/tar.gz/refs/heads/main"

  command -v node >/dev/null 2>&1 || { echo "没找到 node：先装 Node 23.6 以上（https://nodejs.org）" >&2; exit 1; }
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)' ||
    { echo "Node 版本太低（现在是 $(node -v)），要 23.6 以上" >&2; exit 1; }

  echo "下载网关到 $home …"
  mkdir -p "$home"
  curl -fsSL "$source_url" | tar -xz -C "$home" --strip-components=2 "md-main/gateway"
  (cd "$home" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

  if [ "$#" -eq 0 ]; then
    library="$HOME/Documents/Pairdown"
    mkdir -p "$library"
    set -- --library "$library"
  fi
  echo "启动网关（Ctrl+C 停止；下次再跑同一条命令即可）"
  exec node "$home/src/main.mts" "$@"
}

main "$@"
