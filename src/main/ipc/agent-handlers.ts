// =============================================================
// Agent IPC 处理器
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { AgentConfig } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { agentService } from '../services/agent-service'
import { errText } from '../utils/err-text'
import { handleIpc } from './handle'

export function registerAgentHandlers(win: BrowserWindow) {
  // 列出所有 Agent
  // H-1 修复: 加 try-catch,防止 agentService 抛错时渲染进程收到 raw rejection
  // F3 修复: catch 返回 [](renderer 契约是 AgentListItem[]),此前的 {success:false,...} 对象与类型不符
  handleIpc(
    IPC.IPC_AGENT_LIST,
    async () => agentService.listAgents(),
    () => [],
  )

  // 获取 Agent 详情
  // H-1 修复: 加 try-catch
  // F3 模式: 渲染层契约是 AgentDetail | null,错误时返回 null 而非形状不符的对象
  handleIpc(IPC.IPC_AGENT_GET, (_e, id: string) => agentService.getAgent(id), {
    onError: () => null,
    label: (id: string) => `agent:get failed for "${id}"`,
  })

  // 启用/禁用 Agent
  // H-1 修复: 加 try-catch
  handleIpc(
    IPC.IPC_AGENT_TOGGLE,
    (_e, id: string, enabled: boolean) => agentService.toggleAgent(id, enabled),
    {
      label: (id: string) => `agent:toggle failed for "${id}"`,
    },
  )

  // 更新 Agent 配置
  // PERF: 成功时直接返回最新 list + detail,避免前端再发 2 次 IPC (agent:list + agent:get)
  // H-1 修复: service 调用加 try-catch
  handleIpc(
    IPC.IPC_AGENT_UPDATE,
    async (_e, id: string, patch: unknown) => {
      if (!id || typeof id !== 'string') {
        return { success: false, error: 'id must be a non-empty string' }
      }
      if (!patch || typeof patch !== 'object') {
        return { success: false, error: 'patch must be a non-null object' }
      }
      const result = agentService.updateAgent(
        id,
        patch as Partial<
          Pick<AgentConfig, 'name' | 'description' | 'modelTier' | 'capabilities' | 'mcpServers'>
        >,
      )
      if (result.success) {
        // 附带最新 list + detail,前端可省略 2 次 IPC
        const agents = agentService.listAgents()
        const detail = await agentService.getAgent(id)
        return { success: true, agents, detail }
      }
      return result
    },
    {
      label: (id: string) => `agent:update failed for "${id}"`,
    },
  )

  // 写入 SOUL.md / AGENTS.md — 两 handler 同构(类型校验+成功附带 detail),工厂注册
  // R3 修复: 验证 content 类型,避免 fs.writeFile 抛 raw TypeError
  // PERF: 成功时附带最新 detail,避免前端再发 1 次 IPC (agent:get)
  // H-1 修复: service 调用加 try-catch
  const registerDocSetter = (
    channel: string,
    setDoc: (id: string, content: string) => { success: boolean; error?: string },
    label: string,
  ) =>
    handleIpc(
      channel,
      async (_e, id: string, content: string) => {
        if (typeof id !== 'string' || typeof content !== 'string') {
          return { success: false, error: 'id and content must be strings' }
        }
        const result = setDoc(id, content)
        if (result.success) {
          const detail = await agentService.getAgent(id)
          return { success: true, detail }
        }
        return result
      },
      { label: (id: string) => `${label} failed for "${id}"` },
    )

  registerDocSetter(
    IPC.IPC_AGENT_SET_SOUL,
    (id, content) => agentService.setSoul(id, content),
    'agent:set-soul',
  )
  registerDocSetter(
    IPC.IPC_AGENT_SET_RULES,
    (id, content) => agentService.setRules(id, content),
    'agent:set-rules',
  )

  // 手动触发 Agent — 异步执行，通过 AGENT_STATUS_UPDATE 推送进度
  // P1-39 修复:捕获 IIFE 异常并 await runAgent,错误也返回前端
  handleIpc(
    IPC.IPC_AGENT_RUN_MANUAL,
    async (_e, id: string, prompt: string, history?: Array<{ role: string; content: string }>) => {
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
        const message = errText(err)
        console.error(`[Agent] Execution error for ${id}:`, message)
        // 已通过 sendStatus 推送到渲染进程,这里仅做兜底日志
      })
      return { success: true, message: 'Agent execution started', id }
    },
    {
      onError: (msg) => ({ success: false, message: msg }),
      timer: 'agent:run-manual',
    },
  )

  // 中止 Agent 执行
  // P1-40 修复:await abortAgent,等 agent 进入 idle 后再返回
  handleIpc(
    IPC.IPC_AGENT_ABORT,
    async (_e, id: string) => {
      const aborted = await agentService.abortAgent(id, win)
      return { success: aborted, message: aborted ? 'Agent aborted' : 'Agent not running' }
    },
    {
      onError: (msg) => ({ success: false, message: msg }),
      timer: 'agent:abort',
    },
  )

  console.log('[IPC] Agent handlers registered (pi-agent-core integrated)')
}
