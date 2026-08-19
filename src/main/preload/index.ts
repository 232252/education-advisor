// =============================================================
// Preload 脚本 — contextBridge 安全桥接
// 在渲染进程暴露 window.api，类型安全地调用主进程功能
//
// 最小权限原则:
// - 每个方法标注权限级别: [r] read-only / [w] write / [c] critical
// - [c] critical 方法应在 UI 层加二次确认(删除/重置/外部链接等)
// - 不暴露 ipcRenderer/fs/path/process 等危险 API
// - 事件订阅返回取消订阅函数,避免泄漏监听器
//
// 各域 api 对象构造拆分到 ./api/ 子目录,此处聚合为最终暴露对象
// ⚠ 形状契约: window.api 的键名/参数/返回与 renderer/lib/ipc-client.ts
//   的 WindowAPI 接口一一对应,不得改动
// =============================================================

import { contextBridge } from 'electron'
import { academicApi } from './api/academic'
import { agentApi } from './api/agent'
import { aiApi } from './api/ai'
import { backupApi } from './api/backup'
import { chatApi } from './api/chat'
import { classApi } from './api/class'
import { cronApi } from './api/cron'
import { eaaApi } from './api/eaa'
import { feishuApi } from './api/feishu'
import { logApi } from './api/log'
import { mcpApi } from './api/mcp'
import { ollamaApi } from './api/ollama'
import { privacyApi } from './api/privacy'
import { profileApi } from './api/profile'
import { settingsApi } from './api/settings'
import { skillApi } from './api/skill'
import { sysApi } from './api/sys'

// =============================================================
// 暴露给渲染进程的安全 API
// =============================================================
contextBridge.exposeInMainWorld('api', {
  // ----- AI / LLM -----
  ai: aiApi,

  // ----- 本地模型 (Ollama) -----
  ollama: ollamaApi,

  // ----- Agent -----
  agent: agentApi,

  // ----- EAA -----
  eaa: eaaApi,

  // ----- 隐私引擎 -----
  privacy: privacyApi,

  // ----- 定时任务 -----
  cron: cronApi,

  // ----- 技能 -----
  skill: skillApi,

  // ----- 设置 -----
  settings: settingsApi,

  // ----- MCP (Model Context Protocol) -----
  mcp: mcpApi,

  // ----- 系统 -----
  sys: sysApi,

  // ----- 学生档案 -----
  profile: profileApi,

  // ----- 学业管理 (Academics) -----
  academic: academicApi,

  // ----- 班级管理（本地：存档/删除） -----
  class: classApi,

  // ----- 对话持久化 -----
  chat: chatApi,

  // ----- 日志系统 -----
  log: logApi,

  // ----- 数据备份/恢复 -----
  backup: backupApi,

  // ----- 飞书集成 -----
  feishu: feishuApi,
})
