# 🎓 Education Advisor AI (EAA)

<div align="center">

**智能教育管理助手**

*为班主任和教师提供学生管理、教育督导、科研辅助的全场景智能服务*

支持 **多Agent（OpenClaw）** 和 **单Agent（任何AI平台）** 两种部署模式

**[项目介绍与路线图](./PROJECT_INTRO.md)** · **[单Agent部署](./single-agent/DEPLOY.md)** · **[安全规范](./docs/SECURITY.md)**

</div>

---

## ✨ 功能特性

- 📋 **学生档案管理** — 自动维护学生档案，记录行为、谈话、成绩
- 🔍 **智能风险预警** — 多维度评估学生风险等级，自动识别高风险学生
- 📊 **督导复盘** — 每日自动生成督导报告，待办事项提醒
- 💬 **谈话计划** — 智能推荐谈话学生，提供谈话话术建议
- 📈 **成绩分析** — 自动分析成绩分布，识别学业预警
- 🔐 **数据校验** — 多Agent交叉校验，确保数据准确性
- 🗄️ **事件溯源引擎** — Rust 高性能 CLI（`eaa`），不可变事件流，完全可追溯

## 🚀 快速部署

### 🌟 方式一：单Agent部署（推荐，适合所有AI平台）

**不需要 OpenClaw，不需要 Rust，任何AI助手都能用！**

1. 将 [`single-agent/SOUL.md`](./single-agent/SOUL.md) 的内容复制到您的AI助手的系统提示词中
2. 开始对话，AI会自动引导您完成配置

支持的平台：ChatGPT 自定义GPT / Claude Project / Gemini Gems / Kimi / 通义千问 / 智谱清言 / 讯飞星火 / **OpenClaw** 及任何支持系统提示词的AI

📖 详细部署指南：[single-agent/DEPLOY.md](./single-agent/DEPLOY.md)

### 方式二：一键部署（OpenClaw多Agent模式）

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
bash install.sh
```

### 方式三：交给 AI 部署

将 [DEPLOY_TO_AI.md](./DEPLOY_TO_AI.md) 的内容复制给您的AI助手，它会自动帮您部署。

## 🗄️ 事件溯源数据引擎（v2.0）

系统内置基于 Rust 的事件溯源 CLI（`eaa`），是**唯一的数据读写入口**。

### 架构

```
用户/Agent → eaa CLI → 事件流(events.json) → 重放引擎 → 实时分数
```

### v2.0 特性

- **原子写入**（tmp → fsync → rename）：断电不丢数据
- **UUID 事件ID**：避免重复、跳号
- **文件锁**（flock）：多Agent并发安全
- **EAA_DATA_DIR 环境变量**：数据目录灵活配置
- **dry-run 预览模式**：操作前可预览效果
- **分数范围校验 + 防重复 Revert**：数据完整性保障
- **模块化架构**：types / storage / commands / validation 分层解耦

### 常用命令

```bash
eaa info                    # 系统信息
eaa score <姓名>            # 查询分数
eaa history <姓名>          # 事件时间线
eaa ranking [数量]          # 排行榜
eaa search <关键词>          # 搜索事件
eaa add <姓名> <原因码>      # 新增事件
eaa add <姓名> <原因码> --note "备注"  # 带备注
eaa add <姓名> <原因码> --delta -3     # 自定义分值
eaa revert <事件ID> --reason "误记"    # 撤销事件
eaa stats                   # 统计摘要
eaa codes                   # 原因码列表
eaa tag [标签]              # 标签管理
eaa range <开始> <结束>      # 日期范围查询
eaa validate                # 校验所有事件
eaa --dry-run add ...       # 预览模式（不实际写入）
```

## 📁 项目结构

```
education-advisor/
├── README.md                # 项目说明（本文件）
├── PROJECT_INTRO.md         # 项目介绍与发展路线图
├── install.sh               # 安装脚本（支持 --data-dir --prefix --single-agent）
├── DEPLOY_TO_AI.md          # AI自部署提示词
├── single-agent/            # 单Agent部署方案
│   ├── SOUL.md              # 单Agent完整提示词（核心文件）
│   ├── DEPLOY.md            # 多平台部署指南
│   └── USER.md              # 用户配置模板
├── core/
│   └── eaa-cli/             # 事件溯源 CLI（Rust v2.0）
│       ├── src/             # 源代码（main/types/storage/commands/validation）
│       ├── Cargo.toml       # Rust 项目配置
│       ├── schema/          # 原因码定义
│       └── data/            # 数据目录（不提交到仓库）
├── agents/                  # Agent 角色定义（10个）
├── docs/                    # 完整文档
└── examples/                # 脱敏示例数据
```

## 🔌 支持的通信通道

EAA 基于 OpenClaw 框架，天然支持所有 OpenClaw 通道：

| 通道 | 说明 |
|:-----|:-----|
| 飞书 | 消息、日历、任务、多维表格 |
| QQ | 群聊、私聊、定时提醒 |
| Discord | 服务器、频道、DM |
| Telegram | 群组、私聊 |
| Slack | 工作空间 |

## ⚙️ Agent 配置

系统包含 10 个 Agent，可按需启用/禁用：

| Agent | 功能 | 必需 |
|:------|:-----|:-----|
| main | 主协调 | ✅ |
| supervisor | 督导复盘 | ✅ |
| validator | 数据校验 | ✅ |
| academic | 学业分析 | 可选 |
| psychology | 心理监测 | 可选 |
| safety | 安全检查 | 可选 |
| home_school | 家校沟通 | 可选 |
| research | 科研辅助 | 可选 |
| executor | 系统维护 | 可选 |
| talk_planner | 谈话计划 | 可选 |

## 🔒 安全规范

> ⚠️ **所有部署者必须阅读 [SECURITY.md](./docs/SECURITY.md)**

- `eaa` CLI 是唯一数据读写入口，禁止直接修改 JSON 文件
- Agent 只能通过 CLI 读写数据，禁止绕过校验
- 学生数据为敏感信息，禁止上传至公开仓库

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📧 联系

- **项目地址**: https://github.com/232252/education-advisor
- **问题反馈**: https://github.com/232252/education-advisor/issues
