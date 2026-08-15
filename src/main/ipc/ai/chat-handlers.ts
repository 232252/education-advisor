// =============================================================
// AI 流式对话 handler — 发起(逐事件推送到渲染进程,附 sessionId 路由)
// =============================================================

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import * as IPC from '@shared/ipc-channels'
import type { StreamEvent } from '@shared/types'
import { type BrowserWindow, ipcMain } from 'electron'
import { piAIService } from '../../services/pi-ai-service'
import { chatState } from './chat-state'

export function registerAIChatHandlers(win: BrowserWindow): void {
  // ----- 流式对话 -----
  // 前端调用 ai:chat 后，主进程通过 ai:chat-stream 逐事件推送
  ipcMain.handle(
    IPC.IPC_AI_CHAT,
    async (
      _e,
      params: {
        providerId: string
        modelId: string
        messages: Array<{ role: string; content: string }>
        systemPrompt?: string
        thinking?: string
        maxTokens?: number
      },
    ) => {
      // 异步执行流式对话，逐事件推送到渲染进程
      // P1-41 修复:跟踪会话状态,主动捕获 IIFE 异常,确保错误始终送到前端
      chatState.activeChatCount++
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      // F1 修复: 每个流事件附加 sessionId,渲染端按 sessionId 过滤本请求的事件,
      // 避免全窗口广播把无关 delta 串扰给其他订阅者(如 Chat 页 Agent 流)
      const sendToRenderer = (event: StreamEvent) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.IPC_AI_CHAT_STREAM, { ...event, sessionId })
        }
      }

      ;(async () => {
        try {
          // P1-42 修复:thinking 通过 ModelThinkingLevel 类型安全转换
          // 6 个枚举值: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
          const thinking = params.thinking as ModelThinkingLevel | undefined

          const stream = piAIService.chatStream({
            providerId: params.providerId,
            modelId: params.modelId,
            messages: params.messages,
            systemPrompt: params.systemPrompt,
            thinking,
            maxTokens: params.maxTokens,
          })

          for await (const event of stream) {
            sendToRenderer(event)
          }
        } catch (err: unknown) {
          sendToRenderer({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
          })
        } finally {
          chatState.activeChatCount = Math.max(0, chatState.activeChatCount - 1)
          console.log(`[AI] Chat session ${sessionId} ended (active: ${chatState.activeChatCount})`)
        }
      })()

      return { success: true, message: 'Stream started', sessionId }
    },
  )
}
