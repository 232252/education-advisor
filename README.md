# 🎓 Education Advisor AI (EAA)

<div align="center">

**智能教育管理助手 — Rust 驱动，AI 赋能**

*为班主任提供学生管理、教育督导、科研辅助的全场景智能服务*

[![CI](https://github.com/232252/education-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/232252/education-advisor/actions)

**[项目详细介绍](./PROJECT_INTRO.md)** · **[快速开始](./docs/QUICK_START.md)** · **[系统架构](./docs/SYSTEM_ARCHITECTURE.md)**

</div>

---

## ✨ 核心特性

- 🦀 **Rust 数据引擎** — `eaa` CLI，强类型事件溯源，原子写入，断电不丢数据
- 🤖 **多Agent协作** — 10个专业化Agent协同工作，各司其职（基于 OpenClaw）
- 🔍 **智能风险预警** — 多维度评估学生风险等级（高/中/低）
- 📋 **单Agent即用** — 任何AI平台都能用，千问3.5 4B ~ GPT-4o 均可
- 🛡️ **强自约束设计** — 文件沙箱 + CLI驱动 + 12条禁止规则，小模型也不会出错
- 💬 **多通道支持** — 飞书、QQ、Discord、Telegram、微信等
- 🔐 **数据安全** — 本地存储，数据完全自主可控

## 🦀 技术栈

| 组件 | 技术 | 说明 |
|:-----|:-----|:-----|
| **数据引擎** | Rust | 事件溯源、原子写入、文件锁、强类型校验 |
| **AI提示词** | Markdown | 358行单Agent提示词，任何AI平台通用 |
| **Schema** | JSON | 原因码、事件分类，可扩展 |

> **核心是 Rust。** 所有数据读写、校验、并发安全都由 Rust 编译的 `eaa` CLI 完成。
> AI 只负责理解和执行指令，不碰数据底层。

---

## 🚀 快速开始（3分钟）

### 方式一：让AI帮你部署（最简单）

把 [`DEPLOY_TO_AI.md`](./DEPLOY_TO_AI.md) 发给任意AI助手，它会自动完成部署。

### 方式二：一键安装

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
bash install.sh
```

### 方式三：手动部署

```bash
# 1. 安装 eaa CLI（Linux x86_64）
sudo curl -L https://github.com/232252/education-advisor/releases/latest/download/eaa-linux-x86_64 \
  -o /usr/local/bin/eaa && sudo chmod +x /usr/local/bin/eaa

# 2. 初始化数据
mkdir -p ~/eaa-data/entities ~/eaa-data/events ~/eaa-data/schema
curl -L https://raw.githubusercontent.com/232252/education-advisor/main/core/eaa-cli/schema/reason_codes.json \
  -o ~/eaa-data/schema/reason_codes.json
echo 'export EAA_DATA_DIR=~/eaa-data' >> ~/.bashrc && source ~/.bashrc

# 3. 验证
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
                    └── 不可删除：只能revert对冲，审计完整
```

---

## 📁 项目结构

```
education-advisor/
├── README.md              # 项目说明（本文件）
├── PROJECT_INTRO.md       # 项目详细介绍 + 未来发展路线图
├── DEPLOY_TO_AI.md        # AI自部署指南
├── install.sh             # 一键安装脚本
├── LICENSE                # MIT许可证
├── CONTRIBUTING.md        # 贡献指南
├── CHANGELOG.md           # 更新日志
├── config/                # 配置目录
│   └── agents.yaml        # Agent定义（10个Agent完整配置）
├── core/                  # 核心组件
│   └── eaa-cli/           # 事件溯源 CLI（Rust）
│       ├── src/           # Rust源码（5个模块）
│       ├── schema/        # 原因码定义
│       └── tests/         # 集成测试
├── agents/                # Agent工作区（10个Agent的SOUL.md）
├── single-agent/          # 单Agent模式
│   ├── SOUL.md            # 358行强自约束提示词
│   ├── DEPLOY.md          # 5种平台部署指南
│   └── USER.md            # 用户信息模板
├── docs/                  # 完整文档
│   ├── ARCHITECTURE.md    # 系统架构
│   ├── CLI_REFERENCE.md   # CLI命令手册
│   ├── DEPLOYMENT.md      # 部署指南
│   ├── EVENT_SOURCING.md  # 事件溯源说明
│   ├── QUICK_START.md     # 快速开始
│   ├── SECURITY.md        # 安全规范
│   └── SYSTEM_ARCHITECTURE.md  # 系统架构详细版
├── examples/              # 脱敏示例数据
│   └── students/          # 示例学生档案
├── skills/                # 技能定义
└── releases/              # 预编译二进制（多平台）
```

---

## ⚙️ 配置说明

### Agent配置

系统包含10个Agent，可按需启用/禁用：

| Agent | 功能 | 必需 |
|:------|:-----|:-----|
| main | 主协调Agent | ✅ |
| governor | 督导复盘 + 数据校验 | ✅ |
| validator | 数据校验 + 输出审计 | ✅ |
| academic | 学业分析 | 可选 |
| psychology | 心理危机监测 | 可选 |
| safety | 安全检查 | 可选 |
| home_school | 家校通知 | 可选 |
| research | 科研辅助 | 可选 |
| executor | 系统维护 | 可选 |
| counselor | 学业辅导 + 谈话计划 | 可选 |

### 定时任务

| 时间 | 任务 | Agent |
|:-----|:-----|:------|
| 01:00 | 系统自维护 | executor |
| 07:00 | 早间推送 | main |
| 08:30 | 家校通知 | home_school |
| 12:00/18:00 | 数据校验 | validator |
| 21:00 | 心理危机检查 | psychology |
| 22:00 | 督导复盘 | governor |
| 22:10 | 论文数据收集 | research |
| 22:30 | 统一晚间推送 | main |

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

---

## 🔮 未来发展方向

详细说明请查看 [PROJECT_INTRO.md](./PROJECT_INTRO.md)

| 方向 | 说明 | 阶段 |
|:-----|:-----|:-----|
| **数据智能治理** | 多Agent实时互通、数据自动校验 | 阶段一 ✅ |
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
3. 在 `config/agents.yaml` 注册
4. 配置Cron定时任务（可选）

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
| [安全规范](./docs/SECURITY.md) | 安全策略 |
| [更新日志](./CHANGELOG.md) | 版本变更记录 |
| [贡献指南](./CONTRIBUTING.md) | 如何参与开发 |

---

## 📄 许可证

[MIT License](./LICENSE)

---

<div align="center">

**如果这个项目对您有帮助，请给我们一个 ⭐**

*让教育更智能，让教师更轻松*

</div>
