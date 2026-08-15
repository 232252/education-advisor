// =============================================================
// Chat Store 主体 — 组合各 slice 创建 zustand store
// (create 主体自 chatStore.ts 原文件逐字搬移,行为零变化)
// =============================================================

import { create } from 'zustand'
import { createAgentBridgeSlice } from './agent-bridge-slice'
import {
  bindStreamDeltaTarget,
  flushAllDeltas,
  queueStreamDelta,
  queueThinkingDelta,
} from './delta-batch'
import { createMessagesSlice } from './messages-slice'
import { createModelSlice } from './model-slice'
import { createSessionsSlice } from './sessions-slice'
import type { ChatState } from './types'

export const useChatStore = create<ChatState>((set, get) => {
  // F1 修复: 绑定 set,供 flushStreamDeltas 在切换/清空会话前 flush pending delta
  bindStreamDeltaTarget(set)
  return {
    messages: [],
    isStreaming: false,
    isThinking: false,
    streamingAgentId: null,
    currentModel: '',
    currentProvider: '',
    currentModelContext: 0,
    currentModelMaxOutput: 0,
    thinkingLevel: 'off',
    lastUsage: null,
    lastCost: 0,
    sessionId: 'default',
    historyLoaded: false,
    sessions: [],
    selectedAgentId: '',

    appendStreamDelta: (delta) => queueStreamDelta(delta, set),
    appendThinkingDelta: (delta) => queueThinkingDelta(delta, set),
    /** 立即 flush 所有待处理的 delta 批处理 (在 done/error/text_end 时调用) */
    flushDeltas: () => flushAllDeltas(set),

    ...createMessagesSlice(set, get),
    ...createAgentBridgeSlice(set, get),
    ...createModelSlice(set, get),
    ...createSessionsSlice(set, get),
  }
})
