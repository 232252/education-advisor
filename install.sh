#!/bin/bash
#================================================================
# Education Advisor AI (EAA) - 增强版安装脚本 v2.0
#================================================================
# 用法: bash install.sh [--single-agent] [--no-rust] [--prefix PATH] [--data-dir PATH]
#
# 功能:
#   1. 检测操作系统和架构
#   2. 检查环境依赖
#   3. 下载或编译 eaa CLI
#   4. 初始化数据目录和示例数据
#   5. 配置 EAA_DATA_DIR 环境变量
#   6. 创建全局 wrapper 脚本
#   7. 验证安装
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
NO_RUST=false
DATA_DIR=""
EAA_DATA_DIR=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --single-agent) SINGLE_AGENT=true; shift ;;
        --no-rust) NO_RUST=true; shift ;;
        --prefix)
            if [[ -z "$2" ]]; then
                echo -e "${RED}错误: --prefix 需要一个路径参数${NC}"
                exit 1
            fi
            DATA_DIR="$2"; shift 2 ;;
        --data-dir)
            if [[ -z "$2" ]]; then
                echo -e "${RED}错误: --data-dir 需要一个路径参数${NC}"
                exit 1
            fi
            EAA_DATA_DIR="$2"; shift 2 ;;
        -h|--help)
            echo "用法: bash install.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --single-agent    单Agent模式（不检查Node.js）"
            echo "  --no-rust         跳过Rust编译，尝试下载预编译二进制"
            echo "  --prefix PATH     设置数据目录路径"
            echo "  --data-dir PATH   设置 EAA_DATA_DIR 路径（默认: ~/eaa-data）"
            echo "  -h, --help        显示帮助"
            exit 0 ;;
        *) echo -e "${YELLOW}未知参数: $1${NC}"; shift ;;
    esac
done

# Default data dirs
if [[ -z "$DATA_DIR" ]]; then
    DATA_DIR="$PROJECT_ROOT/data"
fi
if [[ -z "$EAA_DATA_DIR" ]]; then
    EAA_DATA_DIR="$HOME/eaa-data"
fi

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
echo -e "  EAA数据目录: ${CYAN}$EAA_DATA_DIR${NC}"
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

EAA_RELEASE_BIN=""
HAS_EAA=false

# 3a. Check if already compiled
if [ -f "$PROJECT_ROOT/core/eaa-cli/target/release/eaa" ]; then
    echo -e "  ✅ 发现已编译的 eaa CLI"
    EAA_RELEASE_BIN="$PROJECT_ROOT/core/eaa-cli/target/release/eaa"
    HAS_EAA=true

# 3b. Try compiling with Rust
elif [ "$NO_RUST" = false ] && command -v cargo &> /dev/null; then
    echo -e "  🔨 检测到 Rust，开始编译..."
    cd "$PROJECT_ROOT/core/eaa-cli"
    cargo build --release 2>&1 | tail -3
    EAA_RELEASE_BIN="$PROJECT_ROOT/core/eaa-cli/target/release/eaa"
    cd "$PROJECT_ROOT"
    HAS_EAA=true
    echo -e "  ✅ 编译完成"

# 3c. Try downloading prebuilt binary
else
    echo -e "  📦 尝试下载预编译二进制..."
    BINARY_URL="https://github.com/232252/education-advisor/releases/latest/download/eaa-${PLATFORM_TAG}"
    DOWNLOAD_PATH="$PROJECT_ROOT/eaa"

    if command -v curl &> /dev/null; then
        if curl -fsSL "$BINARY_URL" -o "$DOWNLOAD_PATH" 2>/dev/null; then
            chmod +x "$DOWNLOAD_PATH"
            EAA_RELEASE_BIN="$DOWNLOAD_PATH"
            HAS_EAA=true
            echo -e "  ✅ 下载成功: $PLATFORM_TAG"
        else
            echo -e "  ⚠️  未找到 $PLATFORM_TAG 的预编译二进制"
        fi
    elif command -v wget &> /dev/null; then
        if wget -q "$BINARY_URL" -O "$DOWNLOAD_PATH" 2>/dev/null; then
            chmod +x "$DOWNLOAD_PATH"
            EAA_RELEASE_BIN="$DOWNLOAD_PATH"
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
# 4. 初始化数据目录
#----------------------------------------------------------------
echo -e "${BLUE}[4/6]${NC} 初始化数据目录..."

# EAA data directory (for eaa CLI v2.0)
mkdir -p "$EAA_DATA_DIR/entities"
mkdir -p "$EAA_DATA_DIR/events"
mkdir -p "$EAA_DATA_DIR/logs"

# Copy schema from repo
if [ -d "$PROJECT_ROOT/core/eaa-cli/schema" ]; then
    mkdir -p "$EAA_DATA_DIR/schema"
    cp -r "$PROJECT_ROOT/core/eaa-cli/schema/"* "$EAA_DATA_DIR/schema/" 2>/dev/null || true
    echo -e "  ✅ Schema已复制到 $EAA_DATA_DIR/schema/"
fi

# Create initial data files
[ -f "$EAA_DATA_DIR/entities/entities.json" ] || echo '[]' > "$EAA_DATA_DIR/entities/entities.json"
[ -f "$EAA_DATA_DIR/entities/name_index.json" ] || echo '{}' > "$EAA_DATA_DIR/entities/name_index.json"
[ -f "$EAA_DATA_DIR/events/events.json" ] || echo '[]' > "$EAA_DATA_DIR/events/events.json"

# Legacy data dir
mkdir -p "$DATA_DIR/entities" "$DATA_DIR/events" "$DATA_DIR/students"

echo -e "${GREEN}  数据目录初始化完成: $EAA_DATA_DIR${NC}"
echo ""

#----------------------------------------------------------------
# 5. 单Agent模式设置
#----------------------------------------------------------------
if [ "$SINGLE_AGENT" = true ]; then
    echo -e "${BLUE}[5/6]${NC} 配置单Agent模式..."

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

if [ "$HAS_EAA" = true ] && [ -n "$EAA_RELEASE_BIN" ]; then
    # Create wrapper script
    WRAPPER_PATH="/usr/local/bin/eaa"
    if [ -w "/usr/local/bin" ] 2>/dev/null; then
        cat > "$WRAPPER_PATH" << WRAPPER_EOF
#!/bin/bash
export EAA_DATA_DIR="${EAA_DATA_DIR}"
exec "${EAA_RELEASE_BIN}" "\$@"
WRAPPER_EOF
        chmod +x "$WRAPPER_PATH"
        echo -e "  ✅ 全局命令已创建: $WRAPPER_PATH"
    else
        # Fallback: local wrapper
        LOCAL_WRAPPER="$PROJECT_ROOT/eaa"
        if [ "$LOCAL_WRAPPER" != "$EAA_RELEASE_BIN" ]; then
            cat > "$LOCAL_WRAPPER" << WRAPPER_EOF
#!/bin/bash
export EAA_DATA_DIR="${EAA_DATA_DIR}"
exec "${EAA_RELEASE_BIN}" "\$@"
WRAPPER_EOF
            chmod +x "$LOCAL_WRAPPER"
            echo -e "  ✅ 本地命令已创建: $LOCAL_WRAPPER"
            echo -e "  ${YELLOW}  （无 /usr/local/bin 写入权限，请手动添加到 PATH）${NC}"
        fi
    fi

    # Set EAA_DATA_DIR in bashrc
    if ! grep -q 'EAA_DATA_DIR' ~/.bashrc 2>/dev/null; then
        echo "export EAA_DATA_DIR=\"$EAA_DATA_DIR\"" >> ~/.bashrc
        echo -e "  ✅ EAA_DATA_DIR 已添加到 ~/.bashrc"
    fi

    # Verify eaa CLI
    export EAA_DATA_DIR="$EAA_DATA_DIR"
    if "$EAA_RELEASE_BIN" info 2>/dev/null; then
        echo -e "  ✅ eaa CLI 验证通过"
    else
        echo -e "  ⚠️  eaa CLI 运行异常，请检查 EAA_DATA_DIR 和 schema 文件"
        echo -e "     EAA_DATA_DIR=$EAA_DATA_DIR"
        echo -e "     Schema: ls $EAA_DATA_DIR/schema/"
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
