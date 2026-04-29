# 🚀 单Agent部署指南

> **教育参谋AI助手可部署到任何支持系统提示词的AI平台。**
> 支持 eaa CLI 的平台可获得完整功能，不支持 CLI 的平台使用纯对话模式。

---

## 方式一：OpenClaw 部署（推荐，功能最全）

**支持 eaa CLI，数据持久化，多通道推送。**

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

### 安装 eaa CLI（手动）

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
eaa doctor
eaa info
```

### 初始化学生数据

创建 `~/eaa-data/entities/entities.json`（以3个学生为例）：
```json
{
  "entities": {
    "stu_001": {"id": "stu_001", "name": "张三", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"},
    "stu_002": {"id": "stu_002", "name": "李四", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"},
    "stu_003": {"id": "stu_003", "name": "王五", "aliases": [], "status": "ACTIVE", "created_at": "2025-09-01"}
  }
}
```

创建 `~/eaa-data/entities/name_index.json`：
```json
{"张三": "stu_001", "李四": "stu_002", "王五": "stu_003"}
```

创建 `~/eaa-data/events/events.json`：
```json
[]
```

### 验证部署

```bash
eaa doctor    # 应全部✅
eaa info      # 应显示 3名学生, 0条事件
eaa validate  # 应显示"所有事件有效"
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
| DeepSeek | 设置 → 系统提示词 |
| 本地部署（Ollama等） | Modelfile 中的 SYSTEM 指令 |

---

## 数据持久化对比

| 平台 | eaa CLI | 数据持久化 | 建议 |
|:-----|:--------|:-----------|:-----|
| OpenClaw | ✅ 可用 | ✅ 文件系统 | **最佳选择** |
| ChatGPT GPT | ❌ 不可用 | ⚠️ 对话上下文 | 定期导出数据 |
| Claude Project | ❌ 不可用 | ✅ 项目文件 | 可上传文件保存 |
| Gemini Gems | ❌ 不可用 | ⚠️ 对话上下文 | 定期导出数据 |
| 本地部署 | ✅ 可用 | ✅ 文件系统 | 次佳选择 |
| 其他平台 | ❌ 不可用 | ⚠️ 取决于平台 | 定期复制到本地 |

> 💡 **建议**：无论使用哪个平台，都建议定期将重要数据导出保存到本地文件。

---

## 故障排除

### eaa CLI 编译失败
```bash
# 确认已安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# 更新 Rust
rustup update
# 清理后重试
cd core/eaa-cli && cargo clean && cargo build --release
```

### eaa doctor 报错
```bash
# 确认环境变量
echo $EAA_DATA_DIR
# 如果为空
source ~/.bashrc 2>/dev/null || source ~/.profile
# 确认数据目录
ls $EAA_DATA_DIR/entities $EAA_DATA_DIR/events $EAA_DATA_DIR/schema
```

### 国内网络下载慢
```bash
# GitHub 在国内可能不稳定，先克隆仓库再本地复制
git clone https://github.com/232252/education-advisor.git
cp education-advisor/core/eaa-cli/schema/reason_codes.json ~/eaa-data/schema/
cp education-advisor/releases/linux-x86_64/eaa /usr/local/bin/eaa
```

### 数据丢失（无 CLI 模式）
- 无 CLI 模式下数据存储在对话上下文中，会话结束即丢失
- 解决方案：切换到 OpenClaw 部署，或定期手动复制数据到本地文件

---

## 下一步

部署完成后，请阅读：
- [SOUL.md](./SOUL.md) — AI助手的完整提示词
- [USER.md](./USER.md) — 用户信息模板
- [CLI参考](../docs/CLI_REFERENCE.md) — eaa 命令手册
