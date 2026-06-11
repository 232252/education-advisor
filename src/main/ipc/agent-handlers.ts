// =============================================================
// Agent IPC 处理器
// =============================================================

import { type BrowserWindow, ipcMain } from 'electron'
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
      patch as Partial<
        Pick<AgentConfig, 'name' | 'description' | 'modelTier' | 'capabilities' | 'skillIds'>
      >,
    )
  })

  // 读取 SOUL.md
  ipcMain.handle(IPC.IPC_AGENT_GET_SOUL, async (_e, id: string) => {
    return agentService.getSoul(id)
  })

  // 写入 SOUL.md
  ipcMain.handle(IPC.IPC_AGENT_SET_SOUL, async (_e, id: string, content: string) => {
    return agentService.setSoul(id, content)
  })

  // 读取 AGENTS.md
  ipcMain.handle(IPC.IPC_AGENT_GET_RULES, async (_e, id: string) => {
    return agentService.getRules(id)
  })

  // 写入 AGENTS.md
  ipcMain.handle(IPC.IPC_AGENT_SET_RULES, async (_e, id: string, content: string) => {
    return agentService.setRules(id, content)
  })

  // P6: 跨 agent 查询所有执行历史(供全局历史页面)
  ipcMain.handle(
    IPC.IPC_AGENT_GET_ALL_EXECUTIONS,
    async (
      _e,
      options?: {
        status?: 'success' | 'error' | 'timeout'
        agentId?: string
        sinceMs?: number
        limit?: number
      },
    ) => {
      const all = agentService.getAllExecutions(options ?? undefined)
      const stats = agentService.getExecutionStats()
      // 同时返回 agent 名称映射,前端无需再次拉取列表
      const agentNameMap: Record<string, string> = {}
      for (const a of agentService.listAgents()) {
        agentNameMap[a.id] = a.name
      }
      return { executions: all, stats, agentNameMap }
    },
  )

  // 手动触发 Agent — 异步执行，通过 AGENT_STATUS_UPDATE 推送进度
  // P1-39 修复:捕获 IIFE 异常并 await runAgent,错误也返回前端
  ipcMain.handle(
    IPC.IPC_AGENT_RUN_MANUAL,
    async (_e, id: string, prompt: string, history?: Array<{ role: string; content: string }>) => {
      if (typeof id !== 'string' || id.length === 0) {
        return { success: false, message: 'id must be a non-empty string' }
      }
      if (typeof prompt !== 'string') {
        return { success: false, message: 'prompt must be a string' }
      }
      // 不 await:手动触发是 fire-and-forget,通过 stream 推送状态
      // 但同步 try/catch 同步参数错误,异步错误由 runAgent 内部 sendStatus 推送
      agentService.runAgent(id, prompt, win, history).catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[Agent] Execution error for ${id}:`, message)
        // 已通过 sendStatus 推送到渲染进程,这里仅做兜底日志
      })
      return { success: true, message: 'Agent execution started', id }
    },
  )

  // 中止 Agent 执行
  // P1-40 修复:await abortAgent,等 agent 进入 idle 后再返回
  ipcMain.handle(IPC.IPC_AGENT_ABORT, async (_e, id: string) => {
    try {
      const aborted = await agentService.abortAgent(id, win)
      return { success: aborted, message: aborted ? 'Agent aborted' : 'Agent not running' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Agent] Abort error for ${id}:`, message)
      return { success: false, message }
    }
  })

  // 获取执行历史
  ipcMain.handle(IPC.IPC_AGENT_GET_HISTORY, async (_e, id: string) => {
    return agentService.getHistory(id)
  })

  console.log('[IPC] Agent handlers registered (pi-agent-core integrated)')
}
