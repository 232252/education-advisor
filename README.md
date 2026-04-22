# 🎓 Education Advisor AI (EAA)

<div align="center">

**智能教育管理助手 — Rust 驱动，AI 赋能**

*为班主任提供学生管理、教育督导、科研辅助的全场景智能服务*

[![CI](https://github.com/232252/education-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/232252/education-advisor/actions)

</div>

---

## ✨ 核心特性

- 🦀 **Rust 数据引擎** — `eaa` CLI，强类型事件溯源，原子写入，断电不丢数据
- 🔍 **智能风险预警** — 多维度评估学生风险等级（高/中/低）
- 📋 **单Agent即用** — 任何AI平台都能用，千问3.5 4B ~ GPT-4o 均可
- 🛡️ **强自约束设计** — 文件沙箱 + CLI驱动 + 12条禁止规则，小模型也不会出错

## 🦀 技术栈

| 组件 | 技术 | 说明 |
|:-----|:-----|:-----|
| **数据引擎** | Rust | 事件溯源、原子写入、文件锁、强类型校验 |
| **AI提示词** | Markdown | 358行单Agent提示词，任何AI平台通用 |
| **Schema** | JSON | 原因码、事件分类，可扩展 |

> **核心是 Rust。** 所有数据读写、校验、并发安全都由 Rust 编译的 `eaa` CLI 完成。
> AI 只负责理解和执行指令，不碰数据底层。

## 🚀 快速开始（3分钟）

### 方式一：让AI帮你部署（最简单）

把 [`DEPLOY_TO_AI.md`](./DEPLOY_TO_AI.md) 发给任意AI助手，它会自动完成部署。

### 方式二：手动部署

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

### 方式三：纯对话模式（无CLI）

将 [`single-agent/SOUL.md`](./single-agent/SOUL.md) 的内容设为AI系统提示词即可。
数据存在对话中，会话结束即丢失。

📖 [详细部署指南](./docs/QUICK_START.md)

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

## 📖 文档

| 文档 | 说明 |
|:-----|:-----|
| [AI自部署指南](./DEPLOY_TO_AI.md) | 把文档发给AI，AI帮你部署 |
| [快速开始](./docs/QUICK_START.md) | 详细安装步骤 |
| [系统架构](./docs/ARCHITECTURE.md) | 整体设计、模块划分、数据流 |
| [CLI参考](./docs/CLI_REFERENCE.md) | eaa 命令完整文档 |
| [事件溯源](./docs/EVENT_SOURCING.md) | 数据模型说明 |
| [安全规范](./docs/SECURITY.md) | 安全策略 |
| [更新日志](./CHANGELOG.md) | 版本变更记录 |

## 📄 许可

[MIT License](./LICENSE)
