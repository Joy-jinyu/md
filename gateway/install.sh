#!/bin/sh
# Pairdown 本机网关：装到 ~/.pairdown，在后台运行（macOS：登录后自动启动），并装上 pairdown 命令。
#   curl -fsSL <站点>/gateway.sh | sh
# 第一次装时换文库文件夹：… | sh -s -- --library ~/notes；装好以后用 pairdown config library <文件夹>
set -eu

# 站点和源码仓库：make build-web 把两个占位换成部署配置（站点上的 gateway.sh 是换好的），pairdown update 和自动更新经环境变量传进来。
# PAIRDOWN_SOURCE：测试时换成本地打的包
SITE="${PAIRDOWN_SITE:-__PAIRDOWN_SITE__}"
REPO="${PAIRDOWN_REPO:-__PAIRDOWN_REPO__}"
SOURCE="${PAIRDOWN_SOURCE:-https://codeload.github.com/$REPO/tar.gz/refs/heads/main}"

need_config() {
  case "$SITE $REPO" in
    *__PAIRDOWN_*) echo "这份安装脚本没填站点或源码仓库（打包时没配 PAIRDOWN_SITE / PAIRDOWN_REPO）：用站点上的 gateway.sh，或设好这两个环境变量再跑" >&2; exit 1 ;;
  esac
}

need_node() {
  command -v node >/dev/null 2>&1 || { echo "没找到 node：先装 Node 23.6 以上（https://nodejs.org）" >&2; exit 1; }
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>23||(a===23&&b>=6)?0:1)' ||
    { echo "Node 版本太低（现在是 $(node -v)），要 23.6 以上" >&2; exit 1; }
}

# 下载（或更新）网关源码、装依赖、记下版本号。pairdown update 和网关自动更新也调它（install.sh fetch）
fetch() {
  mkdir -p "$root/gateway"
  archive="$root/download.tar.gz"
  curl -fsSL "$SOURCE" -o "$archive"
  # 包里的顶层目录名由 GitHub 定（仓库名-分支名，大小写按仓库本身），从包里读，不按 PAIRDOWN_REPO 猜
  top="$(tar -tzf "$archive" | head -n 1 | cut -d/ -f1)"
  tar -xzf "$archive" -C "$root/gateway" --strip-components=2 "$top/gateway"
  rm -f "$archive"
  (cd "$root/gateway" && npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null)
  # 版本号是一串十六进制；站点上还没有这个文件时拿到的是网页，不记
  if curl -fsSL "$SITE/gateway.version" 2>/dev/null | grep -Ex '[0-9a-f]{7,64}' >"$root/version.new"; then mv "$root/version.new" "$root/version"; else rm -f "$root/version.new"; fi
}

# 改版前装的网关，配置里没有 site / repo：更新成新版后线上页面连不上、也不再自动更新。再跑一次安装命令时补上（已有的值不动）。
# 补了返回 0，本来就有返回 1。值经环境变量交给 node，不拼进脚本。
remember_site() {
  PAIRDOWN_SITE="$SITE" PAIRDOWN_REPO="$REPO" CONFIG="$root/config.json" node -e '
    const fs = require("fs");
    const c = JSON.parse(fs.readFileSync(process.env.CONFIG, "utf8"));
    if (c.site && c.repo) process.exit(1);
    const next = { ...c, site: c.site || process.env.PAIRDOWN_SITE, repo: c.repo || process.env.PAIRDOWN_REPO };
    fs.writeFileSync(process.env.CONFIG, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  '
}

# pairdown 命令：包装脚本记住装的时候用的 node，再链到 PATH 里一个能写的目录
install_cli() {
  mkdir -p "$root/bin"
  node_path="$(node -e 'console.log(process.execPath)')"
  {
    echo '#!/bin/sh'
    echo "export PAIRDOWN_HOME='$root'"
    [ -z "${PAIRDOWN_LABEL:-}" ] || echo "export PAIRDOWN_LABEL='$PAIRDOWN_LABEL'"
    echo "exec '$node_path' '$root/gateway/src/ctl.mts' \"\$@\""
  } >"$root/bin/pairdown"
  chmod +x "$root/bin/pairdown"
  for dir in /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin"; do
    [ "$dir" = "$HOME/.local/bin" ] && mkdir -p "$dir"
    if [ -d "$dir" ] && [ -w "$dir" ]; then
      ln -sf "$root/bin/pairdown" "$dir/pairdown"
      echo "$dir/pairdown" >"$root/link"
      case ":$PATH:" in *":$dir:"*) ;; *) echo "提示：$dir 不在 PATH 里，pairdown 命令要写全：$dir/pairdown" ;; esac
      return
    fi
  done
  echo "提示：没找到能放 pairdown 命令的目录，用全路径：$root/bin/pairdown"
}

# 包成函数、最后一行才调：下载到一半断了不会执行半截脚本
main() {
  root="${PAIRDOWN_HOME:-$HOME/.pairdown}"
  need_config
  if [ "${1:-}" = fetch ]; then
    fetch
    return
  fi
  if [ -f "$root/config.json" ] && [ -x "$root/bin/pairdown" ]; then
    need_node
    if remember_site; then
      echo "Pairdown 网关已经装过了：补上了站点和源码仓库，重启网关。"
      "$root/bin/pairdown" restart
      return
    fi
    echo "Pairdown 网关已经装过了，不用再装。"
    "$root/bin/pairdown" status
    return
  fi
  need_node
  echo "下载网关到 $root …"
  fetch
  if [ "$(uname)" != Darwin ]; then
    echo "后台运行现在只支持 macOS，这里在前台启动（Ctrl+C 停止；下次再跑同一条命令）"
    [ "$#" -gt 0 ] || { mkdir -p "$HOME/Documents/Pairdown"; set -- --library "$HOME/Documents/Pairdown"; }
    exec node "$root/gateway/src/main.mts" --origin "$SITE" "$@"
  fi
  install_cli
  PAIRDOWN_SITE="$SITE" PAIRDOWN_REPO="$REPO" "$root/bin/pairdown" setup "$@"
}

# exit 写在同一行：更新会改写这个文件，sh 不能再往下读
main "$@"; exit $?
