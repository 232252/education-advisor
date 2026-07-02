// =============================================================
// Agent IPC 处理器
// =============================================================

import { type BrowserWindow, ipcMain } from 'electron'
import { startIpcTimer } from '../../shared/debug'
import * as IPC from '../../shared/ipc-channels'
import type { AgentConfig } from '../../shared/types'
import { agentService } from '../services/agent-service'

export function registerAgentHandlers(win: BrowserWindow) {
  // 列出所有 Agent
  ipcMain.handle(IPC.IPC_AGENT_LIST, async () => {
    return agentService.listAgents()
  })

  // 获取 Agent 详情
  ipcMain.handle(IPC.IPC_AGENT_GET, async (_e, id: string) => {
    return agentService.getAgent(id)
  })

  // 启用/禁用 Agent
  ipcMain.handle(IPC.IPC_AGENT_TOGGLE, async (_e, id: string, enabled: boolean) => {
    return agentService.toggleAgent(id, enabled)
  })

  // 更新 Agent 配置
  ipcMain.handle(IPC.IPC_AGENT_UPDATE, async (_e, id: string, patch: unknown) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: 'id must be a non-empty string' }
    }
    if (!patch || typeof patch !== 'object') {
      return { success: false, error: 'patch must be a non-null object' }
    }
    return agentService.updateAgent(
      id,
      patch as Partial<Pick<AgentConfig, 'name' | 'description' | 'modelTier' | 'capabilities'>>,
    )
  })

  // 读取 SOUL.md
  ipcMain.handle(IPC.IPC_AGENT_GET_SOUL, async (_e, id: string) => {
    return agentService.getSoul(id)
  })

  // 写入 SOUL.md
  // R3 修复: 验证 content 类型,避免 fs.writeFile 抛 raw TypeError
  ipcMain.handle(IPC.IPC_AGENT_SET_SOUL, async (_e, id: string, content: string) => {
    if (typeof id !== 'string' || typeof content !== 'string') {
      return { success: false, error: 'id and content must be strings' }
    }
    return agentService.setSoul(id, content)
  })

  // 读取 AGENTS.md
  ipcMain.handle(IPC.IPC_AGENT_GET_RULES, async (_e, id: string) => {
    return agentService.getRules(id)
  })

  // 写入 AGENTS.md
  // R3 修复: 验证 content 类型,避免 fs.writeFile 抛 raw TypeError
  ipcMain.handle(IPC.IPC_AGENT_SET_RULES, async (_e, id: string, content: string) => {
    if (typeof id !== 'string' || typeof content !== 'string') {
      return { success: false, error: 'id and content must be strings' }
    }
    return agentService.setRules(id, content)
  })

  // 手动触发 Agent — 异步执行，通过 AGENT_STATUS_UPDATE 推送进度
  // P1-39 修复:捕获 IIFE 异常并 await runAgent,错误也返回前端
  ipcMain.handle(
    IPC.IPC_AGENT_RUN_MANUAL,
    async (_e, id: string, prompt: string, history?: Array<{ role: string; content: string }>) => {
      const stop = startIpcTimer('agent:run-manual')
      try {
        if (typeof id !== 'string' || id.length === 0) {
          return { success: false, message: 'id must be a non-empty string' }
        }
        if (typeof prompt !== 'string') {
          return { success: false, message: 'prompt must be a string' }
        }
        if (prompt.length === 0) {
          return { success: false, message: 'prompt cannot be empty' }
        }
        // R21 修复:同步校验 agent 是否存在(避免对不存在的 agent 返回误导性 success:true)
        const exists = agentService.listAgents().some((a) => a.id === id)
        if (!exists) {
          return { success: false, message: `Agent not found: ${id}` }
        }
        // 不 await:手动触发是 fire-and-forget,通过 stream 推送状态
        // 但同步 try/catch 同步参数错误,异步错误由 runAgent 内部 sendStatus 推送
        agentService.runAgent(id, prompt, win, history).catch((err) => {
          const message = err instanceof Error ? err.message : String(err)
          console.error(`[Agent] Execution error for ${id}:`, message)
          // 已通过 sendStatus 推送到渲染进程,这里仅做兜底日志
        })
        return { success: true, message: 'Agent execution started', id }
      } finally {
        stop()
      }
    },
  )

  // 中止 Agent 执行
  // P1-40 修复:await abortAgent,等 agent 进入 idle 后再返回
  ipcMain.handle(IPC.IPC_AGENT_ABORT, async (_e, id: string) => {
    const stop = startIpcTimer('agent:abort')
    try {
      const aborted = await agentService.abortAgent(id, win)
      return { success: aborted, message: aborted ? 'Agent aborted' : 'Agent not running' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Agent] Abort error for ${id}:`, message)
      return { success: false, message }
    } finally {
      stop()
    }
  })

  // 获取执行历史
  ipcMain.handle(IPC.IPC_AGENT_GET_HISTORY, async (_e, id: string) => {
    return agentService.getHistory(id)
  })

  console.log('[IPC] Agent handlers registered (pi-agent-core integrated)')
}
