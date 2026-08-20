#!/usr/bin/env bash
# =============================================================
# Education Advisor — Linux 开发/测试启动脚本
# 解决两个 Linux 环境问题:
#   1. 残留的 wayland-0 socket 会导致 GTK "Lost connection to
#      Wayland compositor" 而退出 → 显式强制 X11 后端
#   2. 无头环境(Xvfb)需要 --no-sandbox --disable-gpu
# 用法:
#   scripts/run-linux.sh [--cdp] [-- [electron 参数...]]
# =============================================================
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

CDP=0
for a in "$@"; do
  [ "$a" = "--cdp" ] && CDP=1
done

export GDK_BACKEND=x11
unset WAYLAND_DISPLAY 2>/dev/null || true
export ELECTRON_DISABLE_SANDBOX=1

EXTRA=()
[ "$CDP" = "1" ] && EXTRA+=(--remote-debugging-port=9222)

echo "[run-linux] electron 43 + X11 (GDK_BACKEND=x11), CDP=$CDP"
exec npx electron . --no-sandbox --disable-gpu "${EXTRA[@]}" "$@"
