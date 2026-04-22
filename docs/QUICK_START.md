# 🚀 快速开始（3分钟部署）

> **任何人都能部署**：把本仓库交给任意AI助手，说"帮我部署这个系统"，AI会自动完成。

## 前提条件

| 项目 | 要求 | 说明 |
|:-----|:-----|:-----|
| 操作系统 | Linux / macOS | Windows请用WSL |
| AI助手 | 任意支持系统提示词的AI | ChatGPT/Claude/千问/OpenClaw均可 |

## 方式一：AI自部署（推荐）

1. 把仓库地址发给AI助手
2. 把 [DEPLOY_TO_AI.md](../DEPLOY_TO_AI.md) 的内容发给AI
3. AI会自动完成所有部署步骤
4. 跟着AI提示完成首次配置

## 方式二：手动部署

### 1. 安装 eaa CLI

```bash
# Linux x86_64（最常见）
curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 -o /usr/local/bin/eaa
chmod +x /usr/local/bin/eaa

# 或者从源码编译（需要Rust）
git clone https://github.com/232252/education-advisor.git
cd education-advisor/core/eaa-cli
cargo build --release
cp target/release/eaa /usr/local/bin/
```

### 2. 初始化数据

```bash
# 创建数据目录
mkdir -p ~/eaa-data/entities ~/eaa-data/events

# 下载原因码Schema
mkdir -p ~/eaa-data/schema
curl -L https://raw.githubusercontent.com/232252/education-advisor/main/core/eaa-cli/schema/reason_codes.json \
  -o ~/eaa-data/schema/reason_codes.json

# 设置环境变量
echo 'export EAA_DATA_DIR=~/eaa-data' >> ~/.bashrc
source ~/.bashrc
```

### 3. 初始化学生数据

创建 `~/eaa-data/entities/entities.json`：
```json
{
  "entities": {
    "stu_001": {"id": "stu_001", "name": "张三", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"},
    "stu_002": {"id": "stu_002", "name": "李四", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"}
  }
}
```

创建 `~/eaa-data/entities/name_index.json`：
```json
{"张三": "stu_001", "李四": "stu_002"}
```

创建 `~/eaa-data/events/events.json`：
```json
[]
```

### 4. 验证

```bash
eaa doctor    # 环境检查
eaa info      # 应显示 2名学生, 0条事件
eaa codes     # 应显示所有原因码
eaa validate  # 应显示"所有事件有效"
```

### 5. 配置AI助手

将 `single-agent/SOUL.md` 的全部内容复制到AI助手的系统提示词中。

**各平台配置方式**：
| 平台 | 操作 |
|:-----|:-----|
| OpenClaw | 放入 `workspace/SOUL.md` |
| ChatGPT GPTs | 粘贴到 Instructions |
| Claude Project | 加入 Project Knowledge |
| 千问/通义 | 系统提示词 |

## 方式三：纯对话模式（无CLI）

如果AI平台不支持执行命令，直接将 `single-agent/SOUL.md` 设为系统提示词即可。

**限制**：数据存在对话中，会话结束即丢失。

## 下一步

- [CLI命令手册](./CLI_REFERENCE.md)
- [系统架构](./ARCHITECTURE.md)
- [AI自部署指南](../DEPLOY_TO_AI.md)
