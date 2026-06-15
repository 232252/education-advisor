---
title: 简介
description: Education Advisor 是什么，解决什么问题
---

# 🎓 Education Advisor 简介

> **一句话**: 把班主任的日常——操行分记录、学生档案、多 Agent 协作、家长沟通、合规审计——全部装进一个 **17MB** 的 Rust 桌面应用。

## 这是什么？

Education Advisor（简称 EA）是一个面向中小学班主任的 **AI 辅助操行分管理系统**。核心数据模型是**事件溯源的操行分（Conduct Score）**——课堂表现、迟到、违纪等行为的加减分记录。

它不是"成绩管理系统"，而是一个围绕操行分的**多智能体协作平台**：

- 🧠 **18 个专业化 AI Agent**：每个有独立角色设定（SOUL.md）和工作规则（AGENTS.md）
- 🔒 **PII 隐私引擎**：学生姓名 AES-256-GCM 加密脱敏，发给 LLM 前自动匿名化
- 🤖 **多 LLM 编排**：12 个 Provider 统一抽象，流式输出
- 📊 **事件溯源**：所有分数变动不可变、可回放、可审计

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | **Rust**（Tauri 2.0 + eaa_core 库） |
| 前端 | **React 18 + TypeScript**（系统 WebView 渲染） |
| 状态 | Zustand 5 |
| 图表 | ECharts 5 |
| 数据库 | rusqlite（bundled SQLite） |
| 协议 | MIT / Apache-2.0 双协议 |

## 为什么用 Tauri 而不是 Electron？

| 维度 | Electron | Tauri |
|------|----------|-------|
| 体积 | ~90 MB | **17 MB** |
| 内存 | ~150 MB | **40-80 MB** |
| 启动 | 1.5-2s | **0.3-0.6s** |
| 后端 | Node.js | **Rust** |

## 下一步

- [极速上手](/docs/quick-start) — 5 分钟跑起来
- [安装指南](/docs/installation) — 三平台前置依赖
- [整体架构](/docs/architecture) — 深入了解设计
