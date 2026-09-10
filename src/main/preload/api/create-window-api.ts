// =============================================================
// WindowAPI 对象聚合 — Electron preload 与浏览器 WebUI 共用
// =============================================================

import { academicApi } from './academic'
import { agentApi } from './agent'
import { aiApi } from './ai'
import { backupApi } from './backup'
import { chatApi } from './chat'
import { classApi } from './class'
import { cronApi } from './cron'
import { eaaApi } from './eaa'
import { feishuApi } from './feishu'
import { gradingApi } from './grading'
import { logApi } from './log'
import { mcpApi } from './mcp'
import { memoryApi } from './memory'
import { ollamaApi } from './ollama'
import { privacyApi } from './privacy'
import { profileApi } from './profile'
import { reportsApi } from './reports'
import { settingsApi } from './settings'
import { skillApi } from './skill'
import { studentsApi } from './students'
import { sysApi } from './sys'

export function createWindowApi() {
  return {
    ai: aiApi,
    ollama: ollamaApi,
    agent: agentApi,
    eaa: eaaApi,
    privacy: privacyApi,
    cron: cronApi,
    skill: skillApi,
    settings: settingsApi,
    mcp: mcpApi,
    sys: sysApi,
    profile: profileApi,
    academic: academicApi,
    class: classApi,
    students: studentsApi,
    chat: chatApi,
    log: logApi,
    feishu: feishuApi,
    backup: backupApi,
    reports: reportsApi,
    grading: gradingApi,
    memory: memoryApi,
  }
}
