# 🤖 AI自部署指南

> **将以下内容完整复制给您的AI助手，它会自动帮您部署教育参谋系统。**

---

您好！我需要您帮我部署一个**教育参谋AI助手系统**。请严格按照以下步骤操作，每完成一步向我报告结果。

## 第1步：确认环境能力

请先检查并告诉我以下信息：

1. 您是否有**文件读写权限**？（需要创建目录和文件）
2. 您是否有**执行命令的权限**？（需要运行CLI工具）
3. 您的**操作系统**是什么？（Linux/macOS/Windows/不确定）

如果两项权限都没有，请告诉我，我会提供纯对话模式的部署方案。

**预期结果**：您告诉我您的环境能力。

---

## 第2步：创建数据目录

如果您有文件读写权限，请执行：

```bash
mkdir -p ~/education-data/entities
mkdir -p ~/education-data/events
mkdir -p ~/education-data/snapshots
mkdir -p ~/education-data/logs
mkdir -p ~/education-data/reverts
mkdir -p ~/education-data/schema
mkdir -p ~/education-data/students
```

如果您没有命令执行权限但有文件操作能力，请逐个创建以上目录。

**预期结果**：`~/education-data/` 目录及所有子目录已创建。请确认。

---

## 第3步：创建原因码配置文件

在 `~/education-data/schema/` 目录下创建文件 `reason_codes.json`，内容如下：

```json
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
```

**预期结果**：文件已创建，JSON格式正确。

---

## 第4步：创建初始数据文件

### 4.1 实体索引文件

创建 `~/education-data/entities/entities.json`：

```json
[]
```

创建 `~/education-data/entities/name_index.json`：

```json
{}
```

### 4.2 事件流文件

创建 `~/education-data/events/events.json`：

```json
[]
```

**预期结果**：4个JSON文件已创建，每个文件初始内容为 `[]` 或 `{}`。

---

## 第5步：获取 eaa CLI（可选但推荐）

eaa CLI 是一个命令行工具，用于管理学生操行分数据。如果您有命令执行权限，请尝试安装：

### 5A. 下载预编译二进制（推荐）

```bash
# 检测系统架构
ARCH=$(uname -m)
OS=$(uname -s)

if [ "$OS" = "Linux" ] && [ "$ARCH" = "x86_64" ]; then
    echo "检测到 Linux x86_64，下载对应二进制..."
    # 从 GitHub Release 下载
    curl -L -o ~/education-data/eaa https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64
    chmod +x ~/education-data/eaa
    ~/education-data/eaa info
elif [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
    echo "检测到 macOS Apple Silicon"
    curl -L -o ~/education-data/eaa https://github.com/232252/education-advisor/releases/latest/download/eaa-macos-arm64
    chmod +x ~/education-data/eaa
    ~/education-data/eaa info
else
    echo "未找到预编译二进制，请尝试从源码编译或使用文件模式"
fi
```

### 5B. 从源码编译（需要Rust）

```bash
# 检查Rust
if command -v cargo &>/dev/null; then
    cd /path/to/education-advisor/core/eaa-cli
    cargo build --release
    cp target/release/eaa ~/education-data/eaa
else
    echo "未安装Rust，跳过CLI编译"
fi
```

### 5C. 无CLI模式

如果您无法安装 eaa CLI（比如在某些AI平台上），**完全没关系**。系统会使用JSON文件直接管理数据，所有功能照常可用。

**预期结果**：告诉我 eaa CLI 是否安装成功，或者选择无CLI模式。

---

## 第6步：初始化系统提示词

将以下内容设置为您的**系统提示词**（System Prompt / Custom Instructions）：

请读取文件 `single-agent/SOUL.md` 的全部内容，将其作为系统提示词配置。

如果您无法读取文件，请告诉我，我会直接发送给您。

**预期结果**：系统提示词已配置。

---

## 第7步：填写用户信息

将以下模板填写您的真实信息，然后告诉我：

```
姓名：[您的姓名]
学校：[学校名称]
地区：[省市区]
年级：[如：高中2024级]
班级：[如：5班]
学生人数：[如：52人]
任教学科：[如：物理、数学]
是否班主任：[是/否]
是否有实验室管理职责：[是/否]
```

**预期结果**：系统记录了您的个人信息。

---

## 第8步：开始使用

现在系统已部署完成！您可以：

1. 告诉我您的学生名单，我会批量创建档案
2. 直接开始记录操行分事件
3. 说「/待办」查看当前待办事项
4. 说「/帮助」查看所有可用命令

---

## 故障排除

### 问题：无法创建文件
→ 使用纯对话模式，AI会在对话中管理数据，建议定期复制重要信息保存

### 问题：eaa CLI 下载失败
→ 使用文件模式，或手动从 GitHub Release 页面下载

### 问题：JSON文件格式错误
→ 告诉AI具体错误信息，AI会帮您修复

### 问题：AI忘记之前的数据
→ AI的对话上下文有长度限制，建议：
  - 定期让AI导出数据到文件
  - 新对话开始时告诉AI读取之前保存的文件

---

> 📋 部署完成后，请保存本文件以备将来参考。
