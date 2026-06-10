// =============================================================
// IPC 处理器统一注册入口
// =============================================================

import type { BrowserWindow } from 'electron'
import { agentService } from '../services/agent-service'
import { eaaBridge } from '../services/eaa-bridge'
import { registerAgentHandlers } from './agent-handlers'
import { registerAIHandlers } from './ai-handlers'
import { registerCronHandlers } from './cron-handlers'
import { registerEAAHandlers } from './eaa-handlers'
import { registerFeishuHandlers } from './feishu-handlers'
import { registerLogHandlers } from './log-handlers'
import { registerPrivacyHandlers } from './privacy-handlers'
import { registerProfileHandlers } from './profile-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerSkillHandlers } from './skill-handlers'
import { registerSysHandlers } from './sys-handlers'
import { registerSystemMaintenanceHandlers } from './system-maintenance-handlers'

export async function registerAllHandlers(win: BrowserWindow) {
  registerAIHandlers(win)
  registerAgentHandlers(win)
  registerEAAHandlers(win)
  registerPrivacyHandlers(win)
  registerCronHandlers(win)
  registerSkillHandlers(win)
  registerSettingsHandlers(win)
  registerSysHandlers(win)
  registerProfileHandlers()
  registerLogHandlers()
  registerFeishuHandlers()
  registerSystemMaintenanceHandlers()

  // 初始化 EAA Bridge（创建数据目录、复制 reason-codes、doctor 健康检查）
  const eaaStatus = await eaaBridge.initialize()
  console.log(`[IPC] EAA Bridge: ${eaaStatus.message}`)

  // 初始化 Agent 运行时（加载配置、桥接 cron 调度、注入 Skill）
  await agentService.init(win)

  console.log('[IPC] All handlers registered')
}
