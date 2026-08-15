// =============================================================
// Preload API — Agent 域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const agentApi = {
  // [r] 列出所有 agent
  list: () => ipcRenderer.invoke(IPC.IPC_AGENT_LIST),

  // [r] 获取单个 agent 配置
  get: (id: string) => ipcRenderer.invoke(IPC.IPC_AGENT_GET, id),

  // [w] 启用/停用 agent(持久化)
  toggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.IPC_AGENT_TOGGLE, id, enabled),

  // [w] 更新 Agent 配置
  update: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.IPC_AGENT_UPDATE, id, patch),

  // [w] 写回 agent SOUL.md
  setSoul: (id: string, content: string) => ipcRenderer.invoke(IPC.IPC_AGENT_SET_SOUL, id, content),

  // [w] 写回 agent AGENTS.md (rules)
  setRules: (id: string, content: string) =>
    ipcRenderer.invoke(IPC.IPC_AGENT_SET_RULES, id, content),

  // [w] 手动触发 agent 执行
  runManual: (id: string, prompt: string, history?: Array<{ role: string; content: string }>) =>
    ipcRenderer.invoke(IPC.IPC_AGENT_RUN_MANUAL, id, prompt, history),

  // [r] 读取 agent 执行历史
  getHistory: (id: string) => ipcRenderer.invoke(IPC.IPC_AGENT_GET_HISTORY, id),

  // [c] 中断 agent 执行
  abort: (id: string) => ipcRenderer.invoke(IPC.IPC_AGENT_ABORT, id),

  onStatusUpdate: (callback: (data: unknown) => void) => {
    const handler = (_e: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.IPC_AGENT_STATUS_UPDATE, handler)
    return () => {
      ipcRenderer.removeListener(IPC.IPC_AGENT_STATUS_UPDATE, handler)
    }
  },
}
