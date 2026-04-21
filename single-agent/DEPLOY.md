# 🚀 单Agent部署指南

本文档说明如何将教育参谋AI助手部署到各种AI平台。

## 方式一：OpenClaw 部署（推荐）

**推荐给有技术基础的教师，支持 eaa CLI。**

### 步骤

```bash
# 1. 安装 OpenClaw
npm install -g openclaw

# 2. 克隆项目
git clone https://github.com/232252/education-advisor.git
cd education-advisor

# 3. 运行安装脚本（自动编译 eaa CLI）
bash install.sh

# 4. 配置工作区
cp single-agent/SOUL.md ~/.openclaw/workspace/SOUL.md
cp single-agent/USER.md ~/.openclaw/workspace/USER.md
# 编辑 USER.md 填写您的信息

# 5. 启动
openclaw gateway start
```

### 配置通信通道

编辑 OpenClaw 配置文件，选择您需要的通道（飞书/QQ/Discord/Telegram）。

### 安装 eaa CLI

安装脚本会自动处理。如需手动安装：

```bash
# 方式A：从源码编译（需要 Rust）
cd core/eaa-cli && cargo build --release
# 二进制在 target/release/eaa

# 方式B：下载预编译二进制
curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 -o /usr/local/bin/eaa
chmod +x /usr/local/bin/eaa

# 初始化数据目录
mkdir -p ~/eaa-data/{entities,events,logs}
cp -r core/eaa-cli/schema/ ~/eaa-data/schema/
export EAA_DATA_DIR=~/eaa-data

# 验证
eaa info
```

---

## 方式二：ChatGPT 自定义 GPT

1. 打开 ChatGPT → **Explore GPTs** → **Create a GPT**
2. **Configure** 标签页：
   - **Name**：教育参谋AI助手
   - **Description**：班主任全场景智能教育管理助手
   - **Instructions**：粘贴 `single-agent/SOUL.md` 全部内容
   - **Conversation starters**：
     - 「你好，我是XX老师，帮我配置系统」
     - 「查看操行分排行」
     - 「/预警」
3. 点击 **Save**

> ⚠️ ChatGPT 没有 eaa CLI，数据通过对话上下文管理。建议定期导出重要数据。

---

## 方式三：Claude Project

1. 打开 Claude → **Projects** → **Create Project**
2. **Project name**：教育参谋AI助手
3. **Set custom instructions**：粘贴 `single-agent/SOUL.md` 全部内容
4. **Add content**（可选）：上传 `USER.md`
5. 开始对话

---

## 方式四：Gemini Gems

1. 打开 Gemini → **Gem manager** → **Create new Gem**
2. **Name**：教育参谋AI助手
3. **Instructions**：粘贴 `single-agent/SOUL.md` 全部内容
4. 点击 **Save**

---

## 方式五：其他 AI 助手

任何支持「系统提示词」或「自定义指令」的AI平台都可以使用：

| 平台 | 设置位置 |
|:-----|:---------|
| Kimi | 设置 → 自定义提示词 |
| 文心一言 | 设置 → 个性化指令 |
| 通义千问 | 设置 → 自定义人设 |
| 智谱清言 | 设置 → 系统提示词 |
| 讯飞星火 | 设置 → 角色设定 |

---

## 数据持久化说明

| 平台 | eaa CLI | 数据持久化 | 建议 |
|:-----|:--------|:-----------|:-----|
| OpenClaw | ✅ 可用 | ✅ 文件系统 | 最佳选择 |
| ChatGPT GPT | ❌ 不可用 | ⚠️ 对话上下文 | 定期导出数据 |
| Claude Project | ❌ 不可用 | ✅ 项目文件 | 可上传文件保存 |
| Gemini Gems | ❌ 不可用 | ⚠️ 对话上下文 | 定期导出数据 |
| 其他平台 | ❌ 不可用 | ⚠️ 取决于平台 | 定期复制到本地 |

> 💡 **建议**：无论使用哪个平台，都建议定期将重要数据导出保存到本地文件。

---

## 故障排除

### eaa CLI 编译失败
- 确认已安装 Rust：`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- 更新 Rust：`rustup update`
- 清理后重试：`cd core/eaa-cli && cargo clean && cargo build --release`

### eaa info 报错
- 确认 `EAA_DATA_DIR` 环境变量已设置
- 确认数据目录存在：`ls $EAA_DATA_DIR`
- 确认 schema 文件存在：`ls $EAA_DATA_DIR/schema/reason_codes.json`

### 数据丢失（无 CLI 模式）
- 无 CLI 模式下数据存储在对话上下文中，会话结束即丢失
- 解决方案：切换到 OpenClaw 部署，或定期导出数据
