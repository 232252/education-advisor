# 🎓 Education Advisor AI (EAA)

<div align="center">

**智能教育管理助手**

*为班主任提供学生管理、教育督导、科研辅助的全场景智能服务*

[![CI](https://github.com/232252/education-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/232252/education-advisor/actions)

</div>

---

## ✨ 核心特性

- 📋 **事件溯源操行分** — Rust 强类型 CLI（`eaa`），不可变事件流，完全可追溯
- 🔍 **智能风险预警** — 多维度评估学生风险等级
- 📊 **多Agent协作** — 14个专业Agent协同工作（基于OpenClaw）
- 💬 **单Agent可用** — 任何AI平台都能用，无需安装

## 🚀 快速开始

### 单Agent模式（推荐新手）

将 [`single-agent/SOUL.md`](./single-agent/SOUL.md) 复制到您的AI助手系统提示词中即可。

支持：ChatGPT / Claude / Gemini / Kimi / 通义千问 / 智谱清言 / **任何AI平台**

📖 [详细部署指南](./single-agent/DEPLOY.md)

### 多Agent模式（OpenClaw）

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
bash install.sh
```

### 让AI帮你部署

将 [`DEPLOY_TO_AI.md`](./DEPLOY_TO_AI.md) 的内容发给AI，它会自动部署。

## 🗄️ 数据引擎

```
用户/Agent → eaa CLI → 事件流追加 → 重放引擎 → 实时分数
```

| 特性 | 说明 |
|:-----|:-----|
| 原子写入 | tmp→fsync→rename，断电不丢数据 |
| 文件锁 | flock，多Agent并发安全 |
| UUID事件ID | 避免重复/跳号 |
| 强类型校验 | ReasonCode枚举，非法值直接拒绝 |
| dry-run预览 | `--dry-run` 只看不写 |
| 事件不可删 | 只能通过 `revert` 对冲，审计轨迹完整 |

## 📖 文档

| 文档 | 说明 |
|:-----|:-----|
| [系统架构](./docs/ARCHITECTURE.md) | 整体设计、模块划分、数据流 |
| [快速开始](./docs/QUICK_START.md) | 详细安装步骤 |
| [部署指南](./docs/DEPLOYMENT.md) | 多种部署方式说明 |
| [CLI参考](./docs/CLI_REFERENCE.md) | eaa 命令完整文档 |
| [事件溯源](./docs/EVENT_SOURCING.md) | 数据模型说明 |
| [安全规范](./docs/SECURITY.md) | 安全策略 |
| [更新日志](./CHANGELOG.md) | 版本变更记录 |
| [贡献指南](./CONTRIBUTING.md) | 如何参与开发 |

## 📄 许可

[MIT License](./LICENSE)
