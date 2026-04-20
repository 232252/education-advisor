# 🚀 单Agent部署指南

本文档说明如何将教育参谋AI助手部署到各种AI平台。

## 方式一：OpenClaw 部署

**推荐给有技术基础的教师。**

### 步骤

```bash
# 1. 安装 OpenClaw
npm install -g openclaw

# 2. 克隆项目
git clone https://github.com/232252/education-advisor.git
cd education-advisor

# 3. 运行安装脚本
bash install.sh

# 4. 将 single-agent/SOUL.md 内容复制到 OpenClaw 的 SOUL.md
cp single-agent/SOUL.md ~/.openclaw/workspace/SOUL.md

# 5. 编辑 USER.md 填写您的信息
cp single-agent/USER.md ~/.openclaw/workspace/USER.md
# 然后编辑填写

# 6. 启动
openclaw gateway start
```

### 配置通信通道

编辑 OpenClaw 配置文件，选择您需要的通道（飞书/QQ/Discord/Telegram）。

---

## 方式二：ChatGPT 自定义 GPT

**推荐给有 ChatGPT Plus/Team/Enterprise 的教师。**

### 步骤

1. 打开 ChatGPT → 左侧菜单 → **Explore GPTs** → **Create a GPT**
2. 在 **Configure** 标签页中：
   - **Name**：教育参谋AI助手
   - **Description**：班主任全场景智能教育管理助手
   - **Instructions**：将 `single-agent/SOUL.md` 的**全部内容**粘贴到这里
   - **Conversation starters**：
     - 「你好，我是XX老师，帮我配置系统」
     - 「查看操行分排行」
     - 「/预警」
     - 「/复盘」
3. 点击 **Save**

> ⚠️ 注意：ChatGPT 没有 eaa CLI，数据将通过对话上下文管理。建议定期导出重要数据。

---

## 方式三：Claude Project

**推荐给有 Claude Pro/Team 的教师。**

### 步骤

1. 打开 Claude → 左侧 **Projects** → **Create Project**
2. **Project name**：教育参谋AI助手
3. **Set custom instructions**：将 `single-agent/SOUL.md` 的**全部内容**粘贴进去
4. **Add content**（可选）：上传 `USER.md`（填写好您的信息）
5. 开始对话

---

## 方式四：Gemini Gems

**推荐给有 Google One AI Premium 的教师。**

### 步骤

1. 打开 Gemini → 左侧 **Gem manager** → **Create new Gem**
2. **Name**：教育参谋AI助手
3. **Instructions**：将 `single-agent/SOUL.md` 的**全部内容**粘贴进去
4. 点击 **Save**

---

## 方式五：其他 AI 助手

任何支持「系统提示词」或「自定义指令」的AI平台都可以使用：

1. 找到该平台的「系统提示词」或「System Prompt」设置
2. 将 `single-agent/SOUL.md` 的全部内容粘贴进去
3. 开始对话

### 常见平台

| 平台 | 设置位置 |
|:-----|:---------|
| Kimi | 设置 → 自定义提示词 |
| 文心一言 | 设置 → 个性化指令 |
| 通义千问 | 设置 → 自定义人设 |
| 智谱清言 | 设置 → 系统提示词 |
| 讯飞星火 | 设置 → 角色设定 |
| 零一万物 | 设置 → 系统指令 |

---

## 用户配置

部署后，请编辑 `single-agent/USER.md` 填写您的个人信息，或直接在对话中告诉AI。

---

## 数据持久化说明

不同AI平台的数据持久化能力不同：

| 平台 | 数据持久化 | 建议 |
|:-----|:-----------|:-----|
| OpenClaw | ✅ 文件系统，完全持久 | 最佳选择 |
| ChatGPT GPT | ⚠️ 对话上下文，有长度限制 | 定期导出数据 |
| Claude Project | ✅ 项目文件，较好持久 | 可上传文件保存数据 |
| Gemini Gems | ⚠️ 对话上下文 | 定期导出数据 |
| 其他平台 | ⚠️ 取决于平台 | 定期复制重要数据到本地 |

> 💡 **建议**：无论使用哪个平台，都建议定期将重要数据（学生档案、操行分记录）导出保存到本地文件。
