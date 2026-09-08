// =============================================================
// WindowAPI 组合 — 各域 API 类型的聚合 + window.api 全局声明
// 类型单一来源在 @shared/api(与 preload 实现同源),此处仅聚合
// =============================================================

import type { AcademicAPI } from '@shared/api/academic'
import type { AgentAPI } from '@shared/api/agent'
import type { AiAPI } from '@shared/api/ai'
import type { BackupAPI } from '@shared/api/backup'
import type { ChatAPI } from '@shared/api/chat'
import type { ClassAPI } from '@shared/api/class'
import type { CronAPI } from '@shared/api/cron'
import type { EaaAPI } from '@shared/api/eaa'
import type { FeishuAPI } from '@shared/api/feishu'
import type { GradingAPI } from '@shared/api/grading'
import type { LogAPI } from '@shared/api/log'
import type { McpAPI } from '@shared/api/mcp'
import type { MemoryAPI } from '@shared/api/memory'
import type { OllamaAPI } from '@shared/api/ollama'
import type { PrivacyAPI } from '@shared/api/privacy'
import type { ProfileAPI } from '@shared/api/profile'
import type { ReportsAPI } from '@shared/api/reports'
import type { SettingsAPI } from '@shared/api/settings'
import type { SkillAPI } from '@shared/api/skill'
import type { StudentsAPI } from '@shared/api/students'
import type { SysAPI } from '@shared/api/sys'

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
  // 学生 Excel 批量导入 (M30)
  students: StudentsAPI
  chat: ChatAPI
  // T5: 日志系统 API
  log: LogAPI
  // T7: 飞书集成 API (appSecret 从 keystore 读取，不再通过参数传递)
  feishu: FeishuAPI
  // 全量数据备份/恢复
  backup: BackupAPI
  sys: SysAPI
  // R2-12 报告中心
  reports: ReportsAPI
  // AI 批改作业
  grading: GradingAPI
  // R2+ 记忆管理
  memory: MemoryAPI
}

// 全局类型扩展
declare global {
  interface Window {
    api: WindowAPI
  }
}
