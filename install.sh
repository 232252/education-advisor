#!/bin/bash
#================================================================
# Education Advisor AI (EAA) - 一键安装脚本
#================================================================
# 用法: bash install.sh
#
# 功能:
#   1. 检查环境依赖
#   2. 配置通信通道
#   3. 初始化目录结构
#   4. 编译 eaa CLI（如有 Rust）
#   5. 验证系统完整性
#================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=============================================="
echo "   🎓 Education Advisor AI - 自动化安装"
echo "=============================================="
echo ""

#----------------------------------------------------------------
# 1. 检查环境依赖
#----------------------------------------------------------------
echo -e "${BLUE}[1/5]${NC} 检查环境依赖..."

check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "  ❌ $1 未安装"
        return 1
    else
        echo -e "  ✅ $1"
        return 0
    fi
}

MISSING=0
check_command "node" || MISSING=1
check_command "npm" || MISSING=1

if [ $MISSING -eq 1 ]; then
    echo -e "${RED}错误: 请先安装缺失的依赖${NC}"
    exit 1
fi

# 可选依赖
command -v python3 &> /dev/null && echo -e "  ✅ python3" || echo -e "  ℹ️  python3 未安装（可选）"
command -v cargo &> /dev/null && echo -e "  ✅ cargo (Rust)" || echo -e "  ℹ️  cargo 未安装（可选，跳过 eaa CLI 编译）"

echo -e "${GREEN}  环境检查完成${NC}"
echo ""

#----------------------------------------------------------------
# 2. 初始化目录结构
#----------------------------------------------------------------
echo -e "${BLUE}[2/5]${NC} 初始化目录结构..."

mkdir -p "$PROJECT_ROOT/data/students"
mkdir -p "$PROJECT_ROOT/data/conduct_scores"
mkdir -p "$PROJECT_ROOT/data/academic_scores"
mkdir -p "$PROJECT_ROOT/logs"

echo -e "${GREEN}  目录初始化完成${NC}"
echo ""

#----------------------------------------------------------------
# 3. 编译 eaa CLI（可选）
#----------------------------------------------------------------
if command -v cargo &> /dev/null; then
    echo -e "${BLUE}[3/5]${NC} 编译 eaa 事件溯源 CLI..."
    cd "$PROJECT_ROOT/core/eaa-cli"
    cargo build --release 2>&1 | tail -3
    echo -e "  ✅ 编译完成: core/eaa-cli/target/release/eaa"
    cd "$PROJECT_ROOT"
else
    echo -e "${BLUE}[3/5]${NC} 跳过 CLI 编译（未安装 Rust）"
fi
echo ""

#----------------------------------------------------------------
# 4. 初始化示例数据
#----------------------------------------------------------------
echo -e "${BLUE}[4/5]${NC} 初始化示例数据..."

if [ -d "$PROJECT_ROOT/examples/students" ]; then
    cp -r "$PROJECT_ROOT/examples/students/"* "$PROJECT_ROOT/data/students/" 2>/dev/null || true
    echo -e "  ✅ 示例学生档案已复制"
fi

echo -e "${GREEN}  示例数据初始化完成${NC}"
echo ""

#----------------------------------------------------------------
# 5. 验证系统完整性
#----------------------------------------------------------------
echo -e "${BLUE}[5/5]${NC} 验证系统完整性..."

if [ -f "$PROJECT_ROOT/core/eaa-cli/target/release/eaa" ]; then
    cd "$PROJECT_ROOT/core/eaa-cli"
    ./target/release/eaa validate
    cd "$PROJECT_ROOT"
fi

echo -e "${GREEN}=============================================="
echo -e "   🎓 Education Advisor AI 安装完成！"
echo -e "==============================================${NC}"
echo ""
echo -e "下一步:"
echo -e "  1. 配置您的通信通道（飞书/QQ/Discord/Telegram）"
echo -e "  2. 启动 OpenClaw: openclaw gateway start"
echo -e "  3. 给 AI 发送任意消息，开始首次配置引导"
echo ""
echo -e "文档: $PROJECT_ROOT/docs/"
echo ""
