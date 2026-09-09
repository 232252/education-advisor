// =============================================================
// chat store 状态重置 partial 工厂 — 终止/切换分支的公共键组
// 此前 sessions-slice 与 agent-bridge-slice 各自手写同键组 set(),
// 键集合漂移时(如新增流状态键)需要逐处补齐,故收敛于此。
// =============================================================

import type { ChatState } from './types'

/** 会话视图重置 — createSession/switchSession 共用 */
export function sessionViewReset(id: string): Partial<ChatState> {
  return {
    sessionId: id,
    messages: [],
    lastUsage: null,
    lastCost: 0,
    // lastModel 一并清零: 状态栏徽标不残留上一会话的模型
    lastModel: '',
    historyLoaded: false,
  }
}
