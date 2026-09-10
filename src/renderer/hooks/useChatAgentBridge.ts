// =============================================================
// useChatAgentBridge — 把 Agent 状态事件桥到 chatStore
// 必须挂在 App 级(路由之外):此前订阅写在 ChatPage,离开对话页即退订,
// 主进程 Agent 仍在跑,但流式 delta / idle 落库全部丢失 → 跳页后"不再回话"
// / 回来看不到刚发的内容。
// =============================================================

import { useEffect } from 'react'
import { useAgentStore } from '../stores/agent/store'
import { useChatStore } from '../stores/chat/store'

export function useChatAgentBridge(): void {
  useEffect(() => {
    const unsub = useAgentStore.getState().subscribeStatus((data) => {
      useChatStore.getState().handleAgentEvent(data)
    })
    return unsub
  }, [])
}
