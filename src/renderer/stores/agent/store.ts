// =============================================================
// Agent Store 主体 — 组合各 slice 创建 zustand store
// (create 主体自 agentStore.ts 原文件逐字搬移,行为零变化)
// =============================================================

import { create } from 'zustand'
import { createDetailSlice } from './detail-slice'
import { createListSlice } from './list-slice'
import { createRunSlice } from './run-slice'
import { createStatusSlice } from './status-slice'
import type { AgentState, AgentStatusUpdate } from './types'

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  loading: false,
  selectedAgentId: null,
  selectedDetail: null,
  detailLoading: false,
  liveOutput: '',
  liveToolCalls: [],
  isRunning: false,
  lastExecution: null,
  lastError: null,
  _unsubscribeStatus: null,
  //派生订阅者列表 — 在 _handleStatusUpdate 中同步调用
  _statusListeners: new Set<(data: AgentStatusUpdate) => void>(),

  ...createStatusSlice(set, get),
  ...createListSlice(set, get),
  ...createDetailSlice(set, get),
  ...createRunSlice(set),
}))
