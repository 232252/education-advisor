#!/bin/bash
#================================================================
# 教育参谋系统 - 一键安装脚本
#================================================================
# 用法: bash install.sh
#
# 功能:
#   1. 检查环境依赖
#   2. 配置飞书应用参数
#   3. 初始化目录结构
#   4. 验证系统完整性
#   5. 启动服务
#================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=============================================="
echo "   🎓 教育参谋系统 - 自动化安装程序"
echo "=============================================="
echo ""

#----------------------------------------------------------------
# 1. 检查环境依赖
#----------------------------------------------------------------
echo -e "${BLUE}[1/6]${NC} 检查环境依赖..."

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
check_command "python3" || MISSING=1
check_command "node" || MISSING=1
check_command "npm" || MISSING=1

if [ $MISSING -eq 1 ]; then
    echo -e "${RED}错误: 请先安装缺失的依赖${NC}"
    exit 1
fi

echo -e "${GREEN}  环境检查完成${NC}"
echo ""

#----------------------------------------------------------------
# 2. 配置飞书应用参数
#----------------------------------------------------------------
echo -e "${BLUE}[2/6]${NC} 配置飞书应用参数..."

CONFIG_DIR="$PROJECT_ROOT/config"
mkdir -p "$CONFIG_DIR"

CONFIG_FILE="$CONFIG_DIR/app_config.json"
CONFIG_EXAMPLE="$CONFIG_DIR/app_config.example.json"

# 如果已有配置，跳过
if [ -f "$CONFIG_FILE" ]; then
    echo -e "  ℹ️  配置文件已存在，跳过配置步骤"
else
    # 读取配置模板
    if [ -f "$CONFIG_EXAMPLE" ]; then
        cp "$CONFIG_EXAMPLE" "$CONFIG_FILE"
    fi
    
    echo -e "  📝 请编辑配置文件: $CONFIG_FILE"
    echo -e "  ${YELLOW}需要配置以下参数:${NC}"
    echo -e "    - APP_ID (飞书应用ID)"
    echo -e "    - APP_SECRET (飞书应用密钥)"
    echo -e "    - USER_OPEN_ID (您的飞书Open ID)"
    echo ""
    echo -e "  ${YELLOW}按回车继续...${NC}"
    read
    
    # 交互式配置
    echo -e "  请输入 APP_ID (飞书应用ID):"
    read APP_ID
    echo -e "  请输入 APP_SECRET (飞书应用密钥):"
    read APP_SECRET
    echo -e "  请输入 USER_OPEN_ID (您的飞书Open ID):"
    read USER_OPEN_ID
    
    # 更新配置文件
    python3 << EOF
import json
with open('$CONFIG_FILE', 'r') as f:
    config = json.load(f)
config['app']['app_id'] = '$APP_ID'
config['app']['app_secret'] = '$APP_SECRET'
config['app']['user_open_id'] = '$USER_OPEN_ID'
with open('$CONFIG_FILE', 'w') as f:
    json.dump(config, f, indent=2, ensure_ascii=False)
print('配置已保存')
EOF
fi

echo -e "${GREEN}  配置完成${NC}"
echo ""

#----------------------------------------------------------------
# 3. 初始化目录结构
#----------------------------------------------------------------
echo -e "${BLUE}[3/6]${NC} 初始化目录结构..."

mkdir -p "$PROJECT_ROOT/data/students"
mkdir -p "$PROJECT_ROOT/data/conduct_scores"
mkdir -p "$PROJECT_ROOT/data/academic_scores"
mkdir -p "$PROJECT_ROOT/logs"
mkdir -p "$PROJECT_ROOT/workspace/memory/queue/inbox"
mkdir -p "$PROJECT_ROOT/workspace/memory/queue/archive"

echo -e "${GREEN}  目录初始化完成${NC}"
echo ""

#----------------------------------------------------------------
# 4. 初始化示例数据
#----------------------------------------------------------------
echo -e "${BLUE}[4/6]${NC} 初始化示例数据..."

EXAMPLES_DIR="$PROJECT_ROOT/examples"
if [ -d "$EXAMPLES_DIR/students" ]; then
    # 复制示例学生档案
    cp -r "$EXAMPLES_DIR/students/"* "$PROJECT_ROOT/data/students/" 2>/dev/null || true
    echo -e "  ✅ 示例学生档案已复制"
else
    # 创建示例学生
    python3 << 'EOF'
import os
import json
from datetime import datetime

students_dir = '/root/.openclaw/workspace/本系统用于github开源/data/students'
os.makedirs(students_dir, exist_ok=True)

# 创建示例学生档案
students = [
    {
        'name': '张三',
        'grade': '高二',
        'class': '5班',
        'status': '正常',
        'risk_level': '低',
        'notes': '这是示例学生档案，实际使用时请替换为真实数据'
    }
]

for s in students:
    filename = f"{students_dir}/{s['name']}.md"
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(f"""# 学生档案：{s['name']}

## 基本信息
- **姓名**：{s['name']}
- **班级**：{s['grade']}{s['class']}
- **状态**：{s['status']}

## 风险评级
- **当前风险**: 🟢 **{s['risk_level']}风险**

## 备注
{s['notes']}

---
*此档案为示例数据，请替换为真实学生信息*
""")
    print(f"Created: {filename}")
EOF
fi

echo -e "${GREEN}  示例数据初始化完成${NC}"
echo ""

#----------------------------------------------------------------
# 5. 验证系统完整性
#----------------------------------------------------------------
echo -e "${BLUE}[5/6]${NC} 验证系统完整性..."

SCRIPTS_DIR="$PROJECT_ROOT/scripts"
REQUIRED_SCRIPTS=(
    "init_system.py"
    "save_inbox.py"
    "checkpoint_before_response.py"
    "supervisor_quick_scan.py"
    "validator_quick_check.py"
)

ALL_PRESENT=true
for script in "${REQUIRED_SCRIPTS[@]}"; do
    if [ -f "$SCRIPTS_DIR/$script" ]; then
        echo -e "  ✅ $script"
    else
        echo -e "  ❌ $script (缺失)"
        ALL_PRESENT=false
    fi
done

if [ "$ALL_PRESENT" = false ]; then
    echo -e "${YELLOW}  警告: 部分脚本缺失，系统可能无法正常运行${NC}"
fi

echo -e "${GREEN}  系统验证完成${NC}"
echo ""

#----------------------------------------------------------------
# 6. 启动服务
#----------------------------------------------------------------
echo -e "${BLUE}[6/6]${NC} 启动服务..."

echo -e "${GREEN}=============================================="
echo -e "   🎓 教育参谋系统安装完成！"
echo -e "==============================================${NC}"
echo ""
echo -e "下一步:"
echo -e "  1. 确保 OpenClaw 服务已启动"
echo -e "  2. 配置您的飞书应用权限"
echo -e "  3. 运行: python3 $SCRIPTS_DIR/init_system.py"
echo -e "  4. 测试: 发送消息给机器人"
echo ""
echo -e "文档: $PROJECT_ROOT/docs/"
echo ""
