// =============================================================
// IPC 处理器统一注册入口
// =============================================================

import type { BrowserWindow } from 'electron'
import { agentService } from '../services/agent-service'
import { eaaBridge } from '../services/eaa-bridge'
import { registerAcademicHandlers } from './academic-handlers'
import { registerAgentHandlers } from './agent-handlers'
import { registerAIHandlers } from './ai-handlers'
import { registerBackupHandlers } from './backup-handlers'
import { registerChannelHandlers } from './channel-handlers'
import { registerClassHandlers } from './class-handlers'
import { registerCronHandlers } from './cron-handlers'
import { registerEAAHandlers } from './eaa-handlers'
import { registerFeishuHandlers } from './feishu-handlers'
import { registerGradingHandlers } from './grading-handlers'
import { registerLogHandlers } from './log-handlers'
import { registerMcpHandlers } from './mcp-handlers'
import { registerMemoryHandlers } from './memory-handlers'
import { registerOllamaHandlers } from './ollama-handlers'
import { registerPrivacyHandlers } from './privacy-handlers'
import { registerProfileHandlers } from './profile-handlers'
import { registerReportsHandlers } from './reports-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerSkillHandlers } from './skill-handlers'
import { registerStudentExcelHandlers } from './students/excel-import-handlers'
import { registerSysHandlers } from './sys-handlers'

export async function registerAllHandlers(win: BrowserWindow) {
  registerAIHandlers(win)
  registerAgentHandlers(win)
  registerEAAHandlers(win)
  registerPrivacyHandlers(win)
  registerCronHandlers(win)
  registerSkillHandlers(win)
  registerSettingsHandlers(win)
  registerSysHandlers(win)
  registerChannelHandlers(win)
  registerReportsHandlers()
  registerProfileHandlers()
  registerLogHandlers()
  registerFeishuHandlers(win)
  registerOllamaHandlers(win)
  registerClassHandlers()
  registerStudentExcelHandlers()
  registerMcpHandlers(win)
  registerAcademicHandlers()
  registerGradingHandlers(win)
  registerBackupHandlers(win)
  registerMemoryHandlers(win)

  // 初始化 EAA Bridge（创建数据目录、复制 reason-codes、doctor 健康检查）
  // 与 Agent 运行时互不依赖(agent-service 全文零引用 eaaBridge,各自只读
  // 自己的配置文件),并行发起缩短 loadURL 前的启动关键路径(2026-09-04)
  const [eaaStatus] = await Promise.all([eaaBridge.initialize(), agentService.init(win)])
  console.log(`[IPC] EAA Bridge: ${eaaStatus.message}`)

  console.log('[IPC] All handlers registered')
}
