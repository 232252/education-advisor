#!/bin/bash
# EAA 卸载脚本
echo "卸载 Education Advisor AI..."

# 移除全局命令
rm -f /usr/local/bin/eaa
echo "✅ 已移除 /usr/local/bin/eaa"

# 清理bashrc中的环境变量（如果有）
if grep -q "EAA_DATA_DIR" ~/.bashrc 2>/dev/null; then
    sed -i '/EAA_DATA_DIR/d' ~/.bashrc
    echo "✅ 已清理 ~/.bashrc 中的环境变量"
fi

echo ""
echo "⚠️ 数据目录保留（如需删除请手动操作）："
echo "  rm -rf ./data"
echo ""
echo "卸载完成。"
