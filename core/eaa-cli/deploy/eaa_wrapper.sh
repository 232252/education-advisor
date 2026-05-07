#!/bin/bash
# EAA CLI Wrapper v5.0 - 统一入口（双后端 + Python扩展）
# 安装: sudo cp eaa_wrapper.sh /usr/local/bin/eaa && sudo chmod +x /usr/local/bin/eaa
# 注意: 部署前需设置 EAA_PRIVACY_PASSWORD 环境变量

export EAA_DATA_DIR="${EAA_DATA_DIR:-/vol2/copaw-data/data}"
EAA_BIN="/usr/local/bin/eaa.v5"
EAA_BIN_V4="/usr/local/bin/eaa.bin.bak"
EAA_EXT="/opt/eaa/scripts/eaa_extended.py"

# 扩展命令
EXTENDED_COMMANDS="profile grades talks export-profiles"

# 如果匹配扩展命令，交给Python
FIRST_ARG="$1"
for ext_cmd in $EXTENDED_COMMANDS; do
    if [ "$FIRST_ARG" = "$ext_cmd" ]; then
        exec python3 "$EAA_EXT" "$@"
    fi
done

# 优先使用 v5.0 二进制
if [ -x "$EAA_BIN" ]; then
    exec "$EAA_BIN" "$@"
elif [ -x "$EAA_BIN_V4" ]; then
    exec "$EAA_BIN_V4" "$@"
else
    echo "错误: eaa 二进制未找到，请先编译或下载"
    echo "编译: cd core/eaa-cli && cargo build --release"
    echo "下载: https://github.com/232252/education-advisor/releases"
    exit 1
fi
