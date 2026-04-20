#!/bin/bash
#================================================================
# Education Advisor AI (EAA) - 增强版安装脚本
#================================================================
# 用法: bash install.sh [--single-agent] [--no-rust] [--prefix PATH]
#
# 功能:
#   1. 检测操作系统和架构
#   2. 检查环境依赖
#   3. 下载或编译 eaa CLI
#   4. 初始化数据目录和示例数据
#   5. 配置向导
#================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SINGLE_AGENT=false
DATA_DIR="$PROJECT_ROOT/data"
NO_RUST=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --single-agent) SINGLE_AGENT=true ;;
        --no-rust) NO_RUST=true ;;
        --prefix) shift; DATA_DIR="$1" ;;
    esac
done

echo "=============================================="
echo "   🎓 Education Advisor AI - 自动化安装"
echo "=============================================="
echo ""

#----------------------------------------------------------------
# 1. 检测操作系统和架构
#----------------------------------------------------------------
echo -e "${BLUE}[1/6]${NC} 检测系统环境..."

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux)  PLATFORM="linux" ;;
    Darwin) PLATFORM="macos" ;;
    MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
    *)      PLATFORM="unknown" ;;
esac

case "$ARCH" in
    x86_64|amd64)  ARCH_TAG="x86_64" ;;
    aarch64|arm64) ARCH_TAG="arm64" ;;
    armv7l)        ARCH_TAG="armv7" ;;
    *)             ARCH_TAG="unknown" ;;
esac

echo -e "  操作系统: ${CYAN}$OS${NC} ($PLATFORM)"
echo -e "  系统架构: ${CYAN}$ARCH${NC} ($ARCH_TAG)"

PLATFORM_TAG="${PLATFORM}-${ARCH_TAG}"
echo -e "  平台标识: ${CYAN}$PLATFORM_TAG${NC}"
echo ""

#----------------------------------------------------------------
# 2. 检查环境依赖
#----------------------------------------------------------------
echo -e "${BLUE}[2/6]${NC} 检查环境依赖..."

check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "  ⚠️  $1 未安装"
        return 1
    else
        echo -e "  ✅ $1"
        return 0
    fi
}

# Node.js is optional for single-agent mode
if [ "$SINGLE_AGENT" = true ]; then
    echo -e "  ℹ️  单Agent模式，跳过 Node.js 检查"
else
    check_command "node" || { echo -e "${RED}错误: 请先安装 Node.js${NC}"; exit 1; }
    check_command "npm" || { echo -e "${RED}错误: 请先安装 npm${NC}"; exit 1; }
fi

check_command "python3" || echo -e "  ℹ️  python3 未安装（可选）"
echo ""

#----------------------------------------------------------------
# 3. 获取 eaa CLI
#----------------------------------------------------------------
echo -e "${BLUE}[3/6]${NC} 获取 eaa CLI..."

EAA_BIN="$PROJECT_ROOT/eaa"
HAS_EAA=false

# 3a. Check if already compiled
if [ -f "$PROJECT_ROOT/core/eaa-cli/target/release/eaa" ]; then
    echo -e "  ✅ 发现已编译的 eaa CLI"
    cp "$PROJECT_ROOT/core/eaa-cli/target/release/eaa" "$EAA_BIN"
    HAS_EAA=true

# 3b. Try compiling with Rust
elif [ "$NO_RUST" = false ] && command -v cargo &> /dev/null; then
    echo -e "  🔨 检测到 Rust，开始编译..."
    cd "$PROJECT_ROOT/core/eaa-cli"
    cargo build --release 2>&1 | tail -3
    cp target/release/eaa "$EAA_BIN"
    cd "$PROJECT_ROOT"
    HAS_EAA=true
    echo -e "  ✅ 编译完成"

# 3c. Try downloading prebuilt binary
else
    echo -e "  📦 尝试下载预编译二进制..."
    BINARY_URL="https://github.com/232252/education-advisor/releases/latest/download/eaa-${PLATFORM_TAG}"

    if command -v curl &> /dev/null; then
        if curl -fsSL "$BINARY_URL" -o "$EAA_BIN" 2>/dev/null; then
            chmod +x "$EAA_BIN"
            HAS_EAA=true
            echo -e "  ✅ 下载成功: $PLATFORM_TAG"
        else
            echo -e "  ⚠️  未找到 $PLATFORM_TAG 的预编译二进制"
        fi
    elif command -v wget &> /dev/null; then
        if wget -q "$BINARY_URL" -O "$EAA_BIN" 2>/dev/null; then
            chmod +x "$EAA_BIN"
            HAS_EAA=true
            echo -e "  ✅ 下载成功: $PLATFORM_TAG"
        else
            echo -e "  ⚠️  未找到 $PLATFORM_TAG 的预编译二进制"
        fi
    else
        echo -e "  ⚠️  需要 curl 或 wget 来下载二进制"
    fi
fi

if [ "$HAS_EAA" = false ]; then
    echo -e "  ${YELLOW}⚠️  eaa CLI 不可用。系统将使用文件模式管理数据。${NC}"
    echo -e "  ${YELLOW}   您可以稍后手动编译或下载：${NC}"
    echo -e "  ${YELLOW}   - 编译: cd core/eaa-cli && cargo build --release${NC}"
    echo -e "  ${YELLOW}   - 下载: https://github.com/232252/education-advisor/releases${NC}"
fi

echo ""

#----------------------------------------------------------------
# 4. 初始化目录结构
#----------------------------------------------------------------
echo -e "${BLUE}[4/6]${NC} 初始化数据目录..."

mkdir -p "$DATA_DIR/entities"
mkdir -p "$DATA_DIR/events"
mkdir -p "$DATA_DIR/snapshots"
mkdir -p "$DATA_DIR/logs"
mkdir -p "$DATA_DIR/reverts"
mkdir -p "$DATA_DIR/students"
mkdir -p "$PROJECT_ROOT/schema"

# Create initial files if they don't exist
[ -f "$DATA_DIR/entities/entities.json" ] || echo '[]' > "$DATA_DIR/entities/entities.json"
[ -f "$DATA_DIR/entities/name_index.json" ] || echo '{}' > "$DATA_DIR/entities/name_index.json"
[ -f "$DATA_DIR/events/events.json" ] || echo '[]' > "$DATA_DIR/events/events.json"

# Schema
if [ ! -f "$PROJECT_ROOT/schema/reason_codes.json" ]; then
    cat > "$PROJECT_ROOT/schema/reason_codes.json" << 'SCHEMA'
{
  "SPEAK_IN_CLASS": {"description": "课堂讲话", "value": -2, "category": "discipline"},
  "SLEEP_IN_CLASS": {"description": "课堂睡觉", "value": -2, "category": "discipline"},
  "LATE": {"description": "迟到", "value": -1, "category": "attendance"},
  "ABSENT": {"description": "旷课", "value": -5, "category": "attendance"},
  "HOMEWORK_INCOMPLETE": {"description": "未完成作业", "value": -2, "category": "academic"},
  "FIGHTING": {"description": "打架", "value": -10, "category": "safety"},
  "CHEATING": {"description": "作弊", "value": -8, "category": "academic"},
  "BULLYING": {"description": "霸凌", "value": -10, "category": "safety"},
  "GOOD_DEED": {"description": "好人好事", "value": 3, "category": "positive"},
  "EXCELLENT_HOMEWORK": {"description": "优秀作业", "value": 2, "category": "positive"},
  "CLASS_PARTICIPATION": {"description": "课堂积极表现", "value": 2, "category": "positive"},
  "COMPETITION_AWARD": {"description": "竞赛获奖", "value": 5, "category": "positive"}
}
SCHEMA
fi

echo -e "${GREEN}  目录和初始数据初始化完成${NC}"
echo ""

#----------------------------------------------------------------
# 5. 单Agent模式设置
#----------------------------------------------------------------
if [ "$SINGLE_AGENT" = true ]; then
    echo -e "${BLUE}[5/6]${NC} 配置单Agent模式..."

    # Copy single-agent files to workspace
    mkdir -p "$PROJECT_ROOT/workspace"
    cp "$PROJECT_ROOT/single-agent/SOUL.md" "$PROJECT_ROOT/workspace/SOUL.md" 2>/dev/null || true
    cp "$PROJECT_ROOT/single-agent/USER.md" "$PROJECT_ROOT/workspace/USER.md" 2>/dev/null || true

    echo -e "  ✅ 单Agent文件已复制到 workspace/"
    echo -e "  ${YELLOW}  请编辑 workspace/USER.md 填写您的信息${NC}"
else
    echo -e "${BLUE}[5/6]${NC} 跳过单Agent配置（多Agent模式）"
fi
echo ""

#----------------------------------------------------------------
# 6. 验证和完成
#----------------------------------------------------------------
echo -e "${BLUE}[6/6]${NC} 验证安装..."

if [ "$HAS_EAA" = true ]; then
    cd "$PROJECT_ROOT"
    if "$EAA_BIN" info &>/dev/null; then
        echo -e "  ✅ eaa CLI 运行正常"
    else
        echo -e "  ⚠️  eaa CLI 运行异常（数据目录可能不匹配）"
    fi
fi

echo ""
echo -e "${GREEN}=============================================="
echo -e "   🎓 Education Advisor AI 安装完成！"
echo -e "==============================================${NC}"
echo ""

if [ "$SINGLE_AGENT" = true ]; then
    echo -e "部署方式:"
    echo -e "  ${CYAN}单Agent模式${NC}"
    echo ""
    echo -e "下一步:"
    echo -e "  1. 编辑 workspace/USER.md 填写您的信息"
    echo -e "  2. 将 workspace/SOUL.md 的内容复制到您的AI助手的系统提示词中"
    echo -e "  3. 开始与AI对话，完成首次配置引导"
    echo ""
    echo -e "支持的平台: OpenClaw / ChatGPT GPT / Claude Project / Gemini Gems / 其他"
    echo -e "详见: single-agent/DEPLOY.md"
else
    echo -e "部署方式:"
    echo -e "  ${CYAN}多Agent模式（OpenClaw）${NC}"
    echo ""
    echo -e "下一步:"
    echo -e "  1. 配置您的通信通道（飞书/QQ/Discord/Telegram）"
    echo -e "  2. 启动 OpenClaw: openclaw gateway start"
    echo -e "  3. 给 AI 发送任意消息，开始首次配置引导"
fi

echo ""
echo -e "文档: $PROJECT_ROOT/docs/"
echo ""
