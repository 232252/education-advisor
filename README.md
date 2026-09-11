# Education Advisor

**给班主任的本地桌面教育参谋。** 操行分、谈心计划、周报、家校话术、学业分析、**AI 批改作业** — 数据在你电脑上，模型你自己选。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Code of Conduct](https://img.shields.io/badge/行为准则-Contributor%20Covenant%202.1-4baaaa.svg)](./CODE_OF_CONDUCT.md)
[![Contributing](https://img.shields.io/badge/贡献指南-CONTRIBUTING-brightgreen.svg)](./CONTRIBUTING.md)
[![Security](https://img.shields.io/badge/安全政策-SECURITY-red.svg)](./SECURITY.md)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/electron-43-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

<p align="center">
  <a href="#这是什么">简介</a> ·
  <a href="#批改作业">批改作业</a> ·
  <a href="#界面一览">界面</a> ·
  <a href="#快速开始">开始使用</a> ·
  <a href="#18-个-agent">Agent</a> ·
  <a href="./CONTRIBUTING.md">贡献</a> ·
  <a href="./SECURITY.md">安全</a> ·
  <a href="./LICENSE">MIT</a>
</p>

> English: a **local-first** Electron app for homeroom teachers — 18 specialized agents, AES-256-GCM PII shielding, 30+ LLM providers, and a built-in AI grading desk. Data never has to leave the machine.

---

## 这是什么

面向国内初高中班主任的 **跨平台桌面应用**（Electron 43 + React 19 + TypeScript + Rust 数据引擎）。不是聊天机器人，也不是 SaaS：所有学生数据落在本机事件库里，LLM 只看到脱敏后的切片。

你可以用它：

| | |
| --- | --- |
| **日常班务** | 加分扣分、操行排名、风险预警、周报草稿 |
| **学业** | 考试录入、学科对比、学生档案、报告中心 |
| **批改作业** | 拍照/扫描 → AI 按量规给分 → 教师复核 → 发布进学业分析 |
| **家校** | 家长沟通话术草稿、飞书多维表格同步（可选） |
| **隐私** | 姓名/身份证等出域前 AES-256-GCM 脱敏，可逆、可审计 |

18 个角色明确的 Agent（班务、督导、心理观察、纪律、周报……）按权限做事，数字必须来自工具，写操作要确认。小模型（3–4B）也能跑。

---

## 批改作业

侧边栏一级入口 **「批改作业」**。本机完成整条闭环，卷面不出校：

```text
建任务 / 量规  →  导入试卷  →  AI 批改  →  教师复核  →  导出痕迹  →  发布成绩
     │                │            │           │            │            │
  可从样卷识别      看首页姓名     视觉模型     改分/评语    红框批注 PDF   写入学业分析
```

1. **新建任务** — 学期、班级、科目；量规可手填，也可「从样卷识别」拍 1～8 张样卷自动抽题。
2. **导入试卷** — jpg / png / webp / bmp；同名多页自动合成一份；**文件名不用改**，系统读首页姓名栏对花名册。
3. **AI 批改** — 按量规逐份串行批改，可中止、可重试失败卷。须配置支持看图的「批改模型」。
4. **复核** — 左原图、右逐题得分；教师改分优先于 AI；评分点一点即加减。
5. **导出批阅痕迹** — 原卷叠红框批注、得分和评语，可打印或另存 PDF。
6. **发布成绩** — 写入既有学业管线，考试分析 / 学生档案 / 报告中心 / Agent 立刻可见。

量规与批改链路以开源项目 [Submitty](https://github.com/Submitty/Submitty) 为蓝本。完整说明见 [`docs/features/GRADING.md`](./docs/features/GRADING.md)。

---

## 界面一览

| 页面 | 路由 | 做什么 |
| --- | --- | --- |
| 仪表盘 | `#/dashboard` | 操行与学业总览、趋势、对比 |
| 对话 | `#/chat` | 跟参谋说话，工具调用全程可见 |
| 学生 | `#/students` | 花名册、操行、档案、家校 |
| 班级 | `#/classes` | 建班、分班、花名册导入 |
| 学业 | `#/academics` | 考试、成绩、学科对比 |
| **批改作业** | `#/grading` | 量规、阅卷、复核、发布 |
| Agent | `#/agents` | 18 个角色的开关与人设 |
| 模型 | `#/models` | 30+ 厂商、API Key、批改模型 |
| 技能 | `#/skills` | Markdown 技能注入提示词 |
| 任务 | `#/scheduler` | 定时任务与执行日志 |
| 报告中心 | `#/reports` | 周报 / 阶段材料 |
| 隐私 | `#/privacy` | 脱敏映射表、开关、备份 |
| 设置 | `#/settings` | 主题、语言、飞书、本机 WebUI |

---

## 为什么不一样

1. **数据在本地** — Rust 事件库 append-only，可审计；换模型不换数据。
2. **18 个工种，不是一个人格** — 班务只记分，校验员核对账，心理观察员只标不写。
3. **小模型规则** — 数字必须来自工具，写操作必须确认。见 [`config/SMALL_MODEL_RULES.md`](./config/SMALL_MODEL_RULES.md)。
4. **隐私默认打开** — 出域前化名，家长信可按收件人过滤。详见 [`SECURITY.md`](./SECURITY.md)。
5. **模型你自己选** — OpenAI / Anthropic / DeepSeek / 通义 / 智谱 / Ollama 等，目录跟 Pi 走。

---

## 快速开始

需要 **Node.js ≥ 22**、能编译原生模块的 C++ 工具链。详细步骤见 [`docs/QUICK_START.md`](./docs/QUICK_START.md)。

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
npm ci
npm run build:eaa    # 编译本仓库 core/eaa-cli 的 Rust 引擎
npm run dev          # 另开终端再跑 npm run dev:electron
```

第一次打开：

1. **设置**里选语言（中文 / English）和主题。
2. **模型**里填至少一个 API Key；批改作业还要选支持看图的「批改模型」。
3. **班级 / 学生**导入花名册（Excel 一次导入，不要把身份证贴进对话）。
4. 可选：打开隐私引擎、配置飞书、开启本机 WebUI（默认关，HTTPS + 令牌）。

打安装包：

```bash
npm run build
npm run package            # Windows NSIS 安装包
npm run package:portable   # 绿色版 exe
```

---

## 18 个 Agent

每个角色是一对 Markdown（`SOUL.md` + `AGENTS.md`）加 [`config/agents.yaml`](./config/agents.yaml) 里的权限与日程。写新角色看 [`docs/AGENT_AUTHORING.md`](./docs/AGENT_AUTHORING.md)。

| | 角色 | 干什么 |
| --- | --- | --- |
| `main` | 教育参谋 | 理解意图、调度、查分记分 |
| `class-monitor` | 班务助理 | 日常加减分 |
| `governor` | 督导治理 | 数据校验与复盘 |
| `counselor` | 学业规划 | 谈话计划、末位跟踪 |
| `academic` | 学业分析 | 成绩趋势、预警名单 |
| `psychology` | 心理观察 | 只报模式，不下诊断 |
| `discipline-officer` | 纪律 | 严重违纪与复查 |
| `student-care` | 关怀 | 只加分、找亮点 |
| `home_school` | 家校 | 给家长看的草稿 |
| `weekly-reporter` | 周报 | 班级操行周报 |
| `risk-alert` | 预警 | 高风险名单与证据链 |
| `data-analyst` | 数据分析 | 分布、对比、TOP 原因 |
| `safety` | 安全 | 实验室 / 校园安全记录 |
| `validator` / `executor` | 质检 / 巡检 | 数据异常只报告不擅改 |
| `research` | 科研助理 | 课题用的描述统计 |
| `bug-hunter` | 质量守门 | 复现与回归，不直接改生产 |

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`PROJECT_INTRO.md`](./PROJECT_INTRO.md) | 项目长文介绍 |
| [`docs/QUICK_START.md`](./docs/QUICK_START.md) | 安装与排错 |
| [`docs/features/GRADING.md`](./docs/features/GRADING.md) | 批改作业完整流程 |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | 架构 |
| [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md) | 配置项 |
| [`docs/PRIVACY_ENGINE.md`](./docs/PRIVACY_ENGINE.md) | 隐私引擎 |
| [`docs/FAQ.md`](./docs/FAQ.md) | 常见问题 |
| [`ROADMAP.md`](./ROADMAP.md) | 路线图 |

---

## 开源社区

本仓库遵循 GitHub 社区标准。参与前请阅读：

| 文件 | 说明 |
| --- | --- |
| [行为准则 Code of Conduct](./CODE_OF_CONDUCT.md) | Contributor Covenant 2.1。**禁止**在 Issue / PR 中贴真实学生数据。 |
| [贡献指南 Contributing](./CONTRIBUTING.md) | 开发环境、提交规范、如何加 Agent。 |
| [MIT 许可证](./LICENSE) | 可商用、可分叉，保留版权声明即可。 |
| [安全政策 Security](./SECURITY.md) | 漏洞请私下报告，不要开公开 Issue。 |

```bash
npm run typecheck
npm run lint
npm run test
```

---

## 许可证与致谢

[MIT License](./LICENSE) © 2026 Education Advisor AI Contributors。

感谢 [earendil-works/pi](https://github.com/earendil-works/pi)（LLM 与 Agent 运行时）、[Submitty](https://github.com/Submitty/Submitty)（批改数据模型参照）、Electron / better-sqlite3 / Rust 生态，以及每一位把操行本改到深夜的老师。

**如果这个项目帮到你，欢迎点 Star。让教育更智能，让教师更轻松。**
