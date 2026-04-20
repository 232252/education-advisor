# 🎓 Education Advisor AI (EAA)

<div align="center">

**基于 OpenClaw 框架的智能教育管理助手**

*为班主任和教师提供学生管理、教育督导、科研辅助的全场景智能服务*

**[项目介绍与路线图](./PROJECT_INTRO.md)** · **[快速开始](./docs/QUICK_START.md)** · **[系统架构](./docs/SYSTEM_ARCHITECTURE.md)** · **[安全规范](./docs/SECURITY.md)**

</div>

---

## ✨ 功能特性

- 📋 **学生档案管理** — 自动维护学生档案，记录行为、谈话、成绩
- 🔍 **智能风险预警** — 多维度评估学生风险等级，自动识别高风险学生
- 📊 **督导复盘** — 每日自动生成督导报告，待办事项提醒
- 💬 **谈话计划** — 智能推荐谈话学生，提供谈话话术建议
- 📅 **日历同步** — 与外部日历同步课表和日程（飞书/Google等）
- 📈 **成绩分析** — 自动分析成绩分布，识别学业预警
- 🔐 **数据校验** — 多Agent交叉校验，确保数据准确性
- 🗄️ **事件溯源引擎** — Rust 高性能 CLI（`eaa`），不可变事件流，完全可追溯

## 🚀 快速部署

### 方式一：一键部署（推荐）

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
bash install.sh
```

### 方式二：交给 AI 部署（最简）

将本项目地址交给 OpenClaw 或任意 AI 助手，AI 会自动创建文件并完成部署配置：

```
https://github.com/232252/education-advisor
```

> 🎯 **首次交互体验**：部署完成后，把系统提示词交给一个全新 AI，AI 会自动：
> 1. 自我介绍
> 2. 询问您的基本信息（姓名、学校、年级、班级人数等）
> 3. 引导您选择需要启用的功能
> 4. 支持一键全部配置
> 5. 自动初始化数据

### 方式三：手动部署

```bash
# 1. 安装 OpenClaw
npm install -g openclaw

# 2. 编译事件溯源 CLI（需要 Rust）
cd core/eaa-cli && cargo build --release
# 二进制文件: target/release/eaa

# 3. 配置通信通道（飞书/QQ/Discord/Telegram 任选其一）
# 编辑 OpenClaw 配置文件，选择您需要的通道

# 4. 初始化
python3 scripts/init_system.py
```

## 🗄️ 事件溯源数据引擎

系统内置基于 Rust 的事件溯源 CLI（`eaa`），是**唯一的数据读写入口**。所有数据操作——无论来自哪个 Agent、哪个通道——都通过 `eaa` CLI 完成，确保数据一致性和可追溯性。

### 架构

```
用户/Agent → eaa CLI → 事件流(events.json) → 重放引擎 → 实时分数
```

- **不可变事件流**：所有分数变动以事件追加，不可删除/修改
- **重放计算**：当前分数 = 100 + Σ(事件分值)
- **强制校验**：新增事件必须通过原因码和分值校验
- **可撤销**：通过 REVERT 事件对冲，保留完整审计轨迹

### 常用命令

```bash
eaa info                    # 系统信息
eaa score <姓名>            # 查询分数
eaa history <姓名>          # 事件时间线
eaa ranking [数量]          # 排行榜
eaa search <关键词>          # 搜索事件
eaa add <姓名> <原因码>      # 新增事件
eaa revert <事件ID>         # 撤销事件
eaa stats                   # 统计摘要
eaa codes                   # 原因码列表
eaa tag [标签]              # 标签管理
eaa range <开始> <结束>      # 日期范围查询
```

详见 [CLI 命令手册](./docs/CLI_REFERENCE.md) 和 [事件溯源架构](./docs/EVENT_SOURCING.md)。

## 📁 项目结构

```
education-advisor/
├── README.md                # 项目说明（本文件）
├── PROJECT_INTRO.md         # 项目介绍与发展路线图
├── install.sh               # 一键安装脚本
├── config/
│   └── agents.yaml          # Agent 配置（10个）
├── core/
│   └── eaa-cli/             # 事件溯源 CLI（Rust）
│       ├── src/main.rs      # CLI 源代码
│       ├── Cargo.toml       # Rust 项目配置
│       ├── schema/          # 原因码定义
│       └── data/            # 示例数据（脱敏）
├── agents/                  # 10个 Agent 角色定义
│   ├── main/                # 主协调 Agent
│   ├── supervisor/          # 督导复盘 Agent
│   ├── validator/           # 数据校验 Agent
│   ├── academic/            # 学业分析 Agent
│   ├── psychology/          # 心理监测 Agent
│   ├── safety/              # 安全检查 Agent
│   ├── home_school/         # 家校沟通 Agent
│   ├── research/            # 科研辅助 Agent
│   ├── executor/            # 系统维护 Agent
│   └── talk_planner/        # 谈话计划 Agent
├── docs/                    # 完整文档
├── examples/                # 脱敏示例数据
└── skills/                  # 技能定义
```

## 🔌 支持的通信通道

EAA 基于 OpenClaw 框架，天然支持所有 OpenClaw 通道：

| 通道 | 说明 |
|:-----|:-----|
| 飞书 | 消息、日历、任务、多维表格 |
| QQ | 群聊、私聊、定时提醒 |
| Discord | 服务器、频道、DM |
| Telegram | 群组、私聊 |
| 微信 | 通过桥接方案 |
| Slack | 工作空间 |

**不绑定任何单一通道**，您可以只使用其中一个，也可以同时使用多个。

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
