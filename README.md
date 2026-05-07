# 🎓 Education Advisor AI (EAA)

<div align="center">

**智能教育管理助手 — Rust 驱动，AI 赋能**

*为班主任提供学生管理、教育督导、科研辅助的全场景智能服务*

[![CI](https://github.com/232252/education-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/232252/education-advisor/actions)

**[项目详细介绍](./PROJECT_INTRO.md)** · **[快速开始](./docs/QUICK_START.md)** · **[系统架构](./docs/SYSTEM_ARCHITECTURE.md)**

</div>

---

## ✨ 核心特性

- 🦀 **Rust 数据引擎 v4.0** — `eaa` CLI，事件溯源、原子写入；结构化输出（JSON/Text）、静态仪表盘、区间汇总、多格式导出
- 🤖 **多Agent协作** — 12个专业化Agent协同工作，各司其职（基于 OpenClaw）
- 🔍 **智能风险预警** — 多维度评估学生风险等级（高/中/低），自动推送
- 🔒 **隐私脱敏引擎** — AES-256-GCM加密映射表，S_XXX化名体系，写入即脱敏
- 📋 **单Agent即用** — 任何AI平台都能用，千问3.5 4B ~ GPT-4o 均可
- 🛡️ **强自约束设计** — 文件沙箱 + CLI驱动 + 12条禁止规则，小模型也不会出错
- ⏰ **定时自动化** — 覆盖全天的自动化工作流，含飞书Bitable自动同步（钩子+定时双重保障）
- 📊 **标准化跑分** — 安兔兔式Benchmark，四维度（安全/数据/任务/性能）评估系统健康
- 🔄 **飞书Bitable同步** — CLI钩子实时同步 + 定时兜底，确保EAA事件库与飞书数据一致
- 🗄️ **PostgreSQL后端** — 可选替换文件系统存储，支持Docker Compose一键部署
- 💬 **多通道支持** — 飞书、QQ、Discord、Telegram、微信等
- 🔐 **数据安全** — 本地存储，数据完全自主可控

## 🦀 技术栈

| 组件 | 技术 | 说明 |
|:-----|:-----|:-----|
| **数据引擎** | Rust v4.0 | 事件溯源、原子写入、文件锁、强类型校验、结构化输出 |
| **隐私引擎** | Rust | AES-256-GCM加密映射表、anonymize/deanonymize |
| **后端存储** | 文件系统/PostgreSQL | 可选SQL数据库，Docker Compose一键部署 |
| **同步机制** | 飞书Bitable | CLI钩子实时同步 + 定时兜底双重保障 |
| **AI提示词** | Markdown | 358行单Agent提示词，任何AI平台通用 |
| **Schema** | JSON | 原因码、事件分类，可扩展 |
| **评测系统** | Benchmark | 安兔兔式标准化跑分，四维度评估 |
| **定时任务** | OpenClaw Cron | 自动化工作流 + Bitable同步定时 |

> **核心是 Rust。** 所有数据读写、校验、并发安全、隐私脱敏都由 Rust 编译的 `eaa` CLI 完成。
> AI 只负责理解和执行指令，不碰数据底层。

---

## 🚀 快速开始（3分钟）

### 方式一：让AI帮你部署（最简单）

把 [`DEPLOY_TO_AI.md`](./DEPLOY_TO_AI.md) 发给任意AI助手，它会自动完成部署。

### 方式二：一键安装

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor

# Nushell（推荐）
nu install.nu

# 或 bash
bash install.sh
```

### 方式三：手动部署

```bash
# 1. 安装 eaa CLI（Linux x86_64）
sudo curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 \
  -o /usr/local/bin/eaa && sudo chmod +x /usr/local/bin/eaa

# 2. 初始化数据
mkdir -p ~/eaa-data/entities ~/eaa-data/events ~/eaa-data/schema ~/eaa-data/privacy
curl -L https://raw.githubusercontent.com/232252/education-advisor/main/core/eaa-cli/schema/reason_codes.json \
  -o ~/eaa-data/schema/reason_codes.json
echo 'export EAA_DATA_DIR=~/eaa-data' >> ~/.bashrc && source ~/.bashrc

# 3. 初始化隐私引擎
eaa privacy enable
eaa privacy add --name "学生A"    # 添加学生到映射表

# 4. 验证
eaa doctor    # 应全部✅
```

### 方式四：纯对话模式（无CLI）

将 [`single-agent/SOUL.md`](./single-agent/SOUL.md) 的内容设为AI系统提示词即可。

📖 [详细部署指南](./docs/QUICK_START.md) | [AI自部署](./DEPLOY_TO_AI.md)

---

## 🗄️ 数据引擎架构

```
用户 → AI助手 → eaa CLI → 事件流追加 → 重放引擎 → 实时分数
                    │
                    ├── 原子写入：tmp → fsync → rename（断电安全）
                    ├── 文件锁：flock（多进程并发安全）
                    ├── UUID事件ID：防止重复/跳号
                    ├── 强类型校验：ReasonCode枚举，非法值拒绝
                    ├── dry-run：--dry-run 只看不写
                    ├── 不可删除：只能revert对冲，审计完整
                    └── 隐私脱敏：anonymize → S_XXX / deanonymize → 真名
```

---

## 📁 项目结构

```
education-advisor/
├── README.md              # 项目说明（本文件）
├── PROJECT_INTRO.md       # 项目详细介绍 + 未来发展路线图
├── DEPLOY_TO_AI.md        # AI自部署指南
├── CHANGELOG.md           # 更新日志（v1.0~v3.2）
├── install.nu             # Nushell安装脚本（推荐）
├── install.sh             # Bash安装脚本（兼容）
├── uninstall.nu           # Nushell卸载脚本
├── LICENSE                # MIT许可证
├── CONTRIBUTING.md        # 贡献指南
├── config/                # 配置目录
│   ├── agents.yaml        # Agent定义（12个Agent完整配置）
│   ├── main_AGENTS.md     # 主AGENTS.md（脱敏版）
│   ├── main_SOUL.md       # 主SOUL.md（脱敏版）
│   ├── main_USER.md       # 主USER.md（脱敏版）
│   └── main_IDENTITY.md   # 主IDENTITY.md（脱敏版）
├── core/                  # 核心组件
│   └── eaa-cli/           # 事件溯源 CLI（Rust）
│       ├── src/           # Rust源码（6个模块，含privacy）
│       ├── schema/        # 原因码定义
│       └── tests/         # 集成测试
├── agents/                # Agent工作区（12个Agent）
│   ├── academic/          # 学业分析
│   ├── counselor/         # 辅导员（谈话计划+学业日报）【v3.2新增】
│   ├── executor/          # 系统维护
│   ├── governor/          # 督导（复盘+校验+风险分析）【v3.2新增】
│   ├── home_school/       # 家校沟通
│   ├── main/              # 主协调
│   ├── psychology/        # 心理监测
│   ├── research/          # 科研辅助
│   ├── safety/            # 安全检查
│   ├── supervisor/        # 督导汇总
│   ├── talk_planner/      # 谈话规划
│   └── validator/         # 数据校验+输出审计
├── single-agent/          # 单Agent模式
│   ├── SOUL.md            # 358行强自约束提示词（含v3.2隐私规则）
│   ├── DEPLOY.md          # 5种平台部署指南
│   └── USER.md            # 用户信息模板
├── docs/                  # 完整文档
│   ├── ARCHITECTURE.md    # 系统架构
│   ├── CLI_REFERENCE.md   # CLI命令手册
│   ├── DEPLOYMENT.md      # 部署指南
│   ├── EVENT_SOURCING.md  # 事件溯源说明
│   ├── QUICK_START.md     # 快速开始
│   ├── SECURITY.md        # 安全规范（含隐私脱敏章节）
│   └── SYSTEM_ARCHITECTURE.md  # 系统架构详细版
├── examples/              # 脱敏示例数据
│   └── students/          # 示例学生档案
├── skills/                # 技能定义
└── releases/              # 预编译二进制（多平台）
```

---

## ⚙️ 配置说明

### Agent配置（12个）

系统包含12个Agent，可按需启用/禁用：

| Agent | 功能 | 状态 | 说明 |
|:------|:-----|:----:|:-----|
| main | 主协调Agent | ✅ 必需 | 消息路由、数据保存、推送 |
| governor | 督导复盘+数据校验 | ✅ 必需 | 6个定时任务，覆盖晨/午/晚 |
| validator | 数据校验+输出审计 | ✅ 必需 | 审计其他Agent输出 |
| counselor | 学业辅导+谈话计划 | ✅ 推荐 | 每日谈话计划+学业日报 |
| academic | 学业分析 | 可选 | 成绩分析、学业预警 |
| psychology | 心理危机监测 | 可选 | 心理危机信号识别 |
| safety | 安全检查 | 可选 | 实验室安全检查 |
| home_school | 家校通知 | 可选 | 通知生成、家长联系 |
| research | 科研辅助 | 可选 | 论文数据、课题管理 |
| executor | 系统维护 | 可选 | 自维护、错误修复 |
| supervisor | 督导汇总 | 可选 | 风险评估、报告生成 |
| talk_planner | 谈话规划 | 可选 | 已整合到counselor |

### 定时任务（18个）

| 时间 | 任务 | Agent | 模型 |
|:-----|:-----|:------|:-----|
| 01:00 | 系统自维护 | executor | 低成本 |
| 03:00 | 记忆梦境提升 | main（系统） | 系统自动 |
| 06:00 | 晨间数据质量检查 | governor | 低成本 |
| 07:00 | **每日早间推送** | main | 高质量 |
| 07:05 | 学业日报+谈话计划 | counselor | 高质量 |
| 08:30 | 家校通知 | main | 低成本 |
| 12:00 | 午间数据校验 | governor | 低成本 |
| 12:00 | 数据校验+Agent审计 | validator | 高质量 |
| 18:00 | 晚间数据校验 | governor | 低成本 |
| 18:00 | 数据校验+Agent审计 | validator | 高质量 |
| 20:00 | 更新谈话计划 | counselor | 低成本 |
| 21:00 | 心理危机检查 | psychology | 高质量 |
| 22:00 | **督导复盘+数字孪生** | governor | 高质量 |
| 22:10 | 论文数据收集 | research | 高质量 |
| 22:30 | **统一晚间推送** | main | 高质量 |
| 周一08:00 | 实验室安全检查 | safety | 低成本 |
| 周五17:00 | 周五谈话提醒 | governor | 低成本 |
| 周日22:00 | 系统周报 | governor | 高质量 |
| 每月1日 | 月度数据检查 | governor | 低成本 |

> **标注"高质量"的7个任务**使用高精度模型确保输出质量，**"低成本"的10个任务**使用经济模型降低运行成本。

---

## 🔒 隐私脱敏体系（v3.2）

### 脱敏引擎

```
eaa privacy anonymize "学生A物理课讲话"   → S_001物理课讲话
eaa privacy deanonymize "S_001物理课讲话" → 学生A物理课讲话
```

### 自动脱敏范围

| 字段 | 脱敏格式 |
|:-----|:---------|
| 学生姓名 | S_001~S_052 |
| 身份证号 | 前6位+****+后4位 |
| 电话号码 | 前3位+****+后2位 |
| 家庭地址 | 只保留县+乡镇 |

### 适用规则

| 场景 | 脱敏 |
|:-----|:----:|
| 推送给教师本人 | ❌ |
| 发给外部AI/其他系统 | ✅ |
| 本地JSON文件存储 | ✅ |
| Cron推送摘要 | ✅ |

详见 [安全规范](./docs/SECURITY.md)

---

## 📖 使用指南

### 基础命令

```
查分/看分           - 查询学生分数
排行/排名           - 排行榜
记分/扣分/加分       - 记录事件
搜索               - 搜索事件
/预警              - 查看高风险学生
/分析 学生姓名      - 深度分析某学生
/复盘              - 今日督导复盘
/谈话计划           - 生成谈话建议
/统计              - 全班统计
/校验              - 数据校验
```

### 隐私命令

```
脱敏 "文本"         - 将真名替换为S_XXX
还原 "文本"         - 将S_XXX还原为真名
```

---

## 🔮 未来发展方向

详细说明请查看 [PROJECT_INTRO.md](./PROJECT_INTRO.md)

| 方向 | 说明 | 阶段 |
|:-----|:-----|:-----|
| **数据智能治理** | 多Agent实时互通、数据自动校验 | 阶段一 ✅ |
| **隐私保护体系** | AES加密映射、自动脱敏、审计合规 | 阶段一 ✅ |
| **交互模式革新** | 穿戴设备无感采集、端云协同处理 | 阶段二 |
| **教学智能化** | 作业自动批改、个性化分层作业生成 | 阶段二 |
| **开源生态建设** | 核心能力开源 → 插件市场 → 社区共建 | 阶段三 |
| **多班级支持** | 一套系统管理多个班级 | 阶段二 |
| **家长端接入** | 家长直接查看孩子状态 | 阶段三 |

---

## 🔧 扩展开发

### 创建新Agent

1. 在 `agents/` 下创建Agent目录
2. 编写 `SOUL.md` 定义角色、职责、禁止事项
3. 编写 `AGENTS.md` 定义具体规则（含隐私脱敏铁律）
4. 在 `config/agents.yaml` 注册
5. 配置Cron定时任务（可选）

### 创建新技能

1. 在 `skills/` 下创建技能目录
2. 编写 `SKILL.md` 定义接口
3. 在Agent中引用

### 开发eaa CLI

```bash
cd core/eaa-cli
cargo build --release     # 编译
cargo test                # 运行测试
cargo clippy              # 代码检查
```

### 运行脚本

本项目提供 Nushell (`.nu`) 和 Bash (`.sh`) 两种脚本：

```bash
# Nushell（推荐，更安全的数据处理）
nu install.nu
nu uninstall.nu

# Bash（兼容所有系统）
bash install.sh
bash uninstall.sh
```

---

## 📖 文档

| 文档 | 说明 |
|:-----|:-----|
| [AI自部署指南](./DEPLOY_TO_AI.md) | 把文档发给AI，AI帮你部署 |
| [项目详细介绍](./PROJECT_INTRO.md) | 功能路线图 + 未来规划 + 架构图 |
| [快速开始](./docs/QUICK_START.md) | 详细安装步骤 |
| [系统架构](./docs/ARCHITECTURE.md) | 整体设计、模块划分、数据流 |
| [CLI参考](./docs/CLI_REFERENCE.md) | eaa 命令完整文档 |
| [事件溯源](./docs/EVENT_SOURCING.md) | 数据模型说明 |
| [安全规范](./docs/SECURITY.md) | 安全策略 + 隐私脱敏规范 |
| [更新日志](./CHANGELOG.md) | 版本变更记录（v1.0~v3.2） |
| [贡献指南](./CONTRIBUTING.md) | 如何参与开发 |

---

## 📄 许可证

[MIT License](./LICENSE)

---

<div align="center">

**如果这个项目对您有帮助，请给我们一个 ⭐**

*让教育更智能，让教师更轻松*

</div>
