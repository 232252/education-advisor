// =============================================================
// WindowAPI 组合 — 各域 API 类型的聚合 + window.api 全局声明
// =============================================================

import type { AcademicAPI } from './academic'
import type { AgentAPI } from './agent'
import type { AiAPI } from './ai'
import type { ChatAPI } from './chat'
import type { ClassAPI } from './class'
import type { CronAPI } from './cron'
import type { EaaAPI } from './eaa'
import type { FeishuAPI } from './feishu'
import type { LogAPI } from './log'
import type { McpAPI } from './mcp'
import type { OllamaAPI } from './ollama'
import type { PrivacyAPI } from './privacy'
import type { ProfileAPI } from './profile'
import type { SettingsAPI } from './settings'
import type { SkillAPI } from './skill'
import type { SysAPI } from './sys'

// window.api 的类型声明（与 preload 脚本对应）
export interface WindowAPI {
  ai: AiAPI
  // 本地模型 (Ollama)
  ollama: OllamaAPI
  agent: AgentAPI
  eaa: EaaAPI
  privacy: PrivacyAPI
  cron: CronAPI
  skill: SkillAPI
  settings: SettingsAPI
  mcp: McpAPI
  profile: ProfileAPI
  academic: AcademicAPI
  class: ClassAPI
  chat: ChatAPI
  // T5: 日志系统 API
  log: LogAPI
  // T7: 飞书集成 API (appSecret 从 keystore 读取，不再通过参数传递)
  feishu: FeishuAPI
  sys: SysAPI
}

// 全局类型扩展
declare global {
  interface Window {
    api: WindowAPI
  }
}
