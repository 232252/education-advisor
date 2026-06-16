// =============================================================
// AI / LLM IPC 处理器
// 已接入 pi-ai，支持 Provider 列表、模型列表、连接测试、流式对话
// =============================================================

import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import { type BrowserWindow, ipcMain } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { dbService } from '../services/db-service'
import { piAIService } from '../services/pi-ai-service'

// 当前正在进行的流式会话计数(用于跟踪/调试)
let activeChatCount = 0

export function registerAIHandlers(win: BrowserWindow) {
  // ----- 列出所有 Provider -----
  ipcMain.handle(IPC.IPC_AI_LIST_PROVIDERS, async () => {
    try {
      return await piAIService.listProviders()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] ai:list-providers failed:', msg)
      throw err
    }
  })

  // ----- 列出指定 Provider 的模型 -----
  ipcMain.handle(IPC.IPC_AI_LIST_MODELS, async (_e, providerId: string) => {
    try {
      return await piAIService.listModels(providerId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] ai:list-models failed for "${providerId}":`, msg)
      throw err
    }
  })

  // ----- 测试连接 -----
  ipcMain.handle(
    IPC.IPC_AI_TEST_CONNECTION,
    async (_e, providerId: string, apiKey: string, baseUrl?: string) => {
      return piAIService.testConnection(providerId, apiKey, baseUrl)
    },
  )

  // ----- 设置 API Key -----
  ipcMain.handle(IPC.IPC_AI_SET_API_KEY, async (_e, providerId: string, apiKey: string) => {
    piAIService.setApiKey(providerId, apiKey)
    return { success: true }
  })

  // ----- 删除 API Key -----
  ipcMain.handle(IPC.IPC_AI_DELETE_API_KEY, async (_e, providerId: string) => {
    piAIService.deleteApiKey(providerId)
    return { success: true }
  })

  // ----- OAuth 登录(P0 修复)-----
  ipcMain.handle(IPC.IPC_AI_OAUTH_LOGIN, async (_e, providerId: string) => {
    return piAIService.oauthLogin(providerId)
  })

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
      activeChatCount++
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const sendToRenderer = (event: unknown) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.IPC_AI_CHAT_STREAM, event)
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
          activeChatCount = Math.max(0, activeChatCount - 1)
          console.log(`[AI] Chat session ${sessionId} ended (active: ${activeChatCount})`)
        }
      })()

      return { success: true, message: 'Stream started', sessionId }
    },
  )

  // ----- 中止对话 -----
  ipcMain.handle(IPC.IPC_AI_CHAT_ABORT, async () => {
    piAIService.abortCurrentChat()
    return { success: true, activeChats: activeChatCount }
  })

  // ----- 对话持久化: 保存消息 -----
  ipcMain.handle(
    IPC.IPC_CHAT_SAVE_MESSAGE,
    async (
      _e,
      msg: {
        sessionId?: string
        role: string
        content: string
        thinking?: string
        toolCalls?: string
        timestamp: number
        provider?: string
        model?: string
        tokenInput?: number
        tokenOutput?: number
        cost?: number
      },
    ) => {
      const id = dbService.saveChatMessage(msg)
      return { success: id >= 0, id }
    },
  )

  // ----- 对话持久化: 加载消息 -----
  ipcMain.handle(IPC.IPC_CHAT_LOAD_MESSAGES, async (_e, sessionId?: string) => {
    const messages = dbService.loadChatMessages(sessionId)
    return { success: true, messages }
  })

  // ----- 对话持久化: 删除会话 -----
  ipcMain.handle(IPC.IPC_CHAT_DELETE_SESSION, async (_e, sessionId: string) => {
    const success = dbService.deleteChatSession(sessionId)
    return { success }
  })

  // ----- 对话持久化: 列出所有会话 -----
  ipcMain.handle(IPC.IPC_CHAT_LIST_SESSIONS, async () => {
    const rows = dbService.listChatSessions()
    // DB 列名 snake_case → 前端 camelCase 映射
    const sessions = rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      messageCount: r.message_count,
    }))
    return { success: true, sessions }
  })

  // ----- 自定义模型管理 -----
  ipcMain.handle(
    IPC.IPC_AI_ADD_CUSTOM_MODEL,
    async (
      _e,
      params: {
        providerId: string
        modelId: string
        name?: string
        contextWindow?: number
        maxOutputTokens?: number
        supportsReasoning?: boolean
      },
    ) => {
      return piAIService.addCustomModel(params.providerId, {
        id: params.modelId,
        name: params.name,
        contextWindow: params.contextWindow,
        maxOutputTokens: params.maxOutputTokens,
        supportsReasoning: params.supportsReasoning,
      })
    },
  )

  ipcMain.handle(IPC.IPC_AI_DEL_CUSTOM_MODEL, async (_e, providerId: string, modelId: string) => {
    const removed = piAIService.removeCustomModel(providerId, modelId)
    return { success: removed }
  })

  ipcMain.handle(
    IPC.IPC_AI_UPDATE_CUSTOM_MODEL,
    async (
      _e,
      params: {
        providerId: string
        modelId: string
        name?: string
        contextWindow?: number
        maxOutputTokens?: number
        supportsReasoning?: boolean
        costPerInputToken?: number
        costPerOutputToken?: number
        api?: string
        baseUrl?: string
      },
    ) => {
      const updated = piAIService.updateCustomModel(params.providerId, params.modelId, {
        name: params.name,
        contextWindow: params.contextWindow,
        maxOutputTokens: params.maxOutputTokens,
        supportsReasoning: params.supportsReasoning,
        costPerInputToken: params.costPerInputToken,
        costPerOutputToken: params.costPerOutputToken,
        api: params.api,
        baseUrl: params.baseUrl,
      })
      return { success: updated }
    },
  )

  console.log('[IPC] AI handlers registered (pi-ai integrated + chat persistence)')
}
