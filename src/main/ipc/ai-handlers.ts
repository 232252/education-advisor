// =============================================================
// AI / LLM IPC 处理器
// 已接入 pi-ai，支持 Provider 列表、模型列表、连接测试、流式对话
// 注册入口: 子域 handler 拆分到 ./ai/ 子目录
//   - provider-handlers.ts      Provider/模型/API Key/OAuth
//   - chat-handlers.ts          流式对话 + 中止
//   - persistence-handlers.ts   对话持久化(SQLite)
//   - custom-model-handlers.ts  自定义模型管理
//   - chat-state.ts             流式会话计数(chat/abort 共享)
// =============================================================

import type { BrowserWindow } from 'electron'
import { registerAIChatHandlers } from './ai/chat-handlers'
import { registerAICustomModelHandlers } from './ai/custom-model-handlers'
import { registerAIChatPersistenceHandlers } from './ai/persistence-handlers'
import { registerAIProviderHandlers } from './ai/provider-handlers'

export function registerAIHandlers(win: BrowserWindow) {
  registerAIProviderHandlers()
  registerAIChatHandlers(win)
  registerAIChatPersistenceHandlers()
  registerAICustomModelHandlers()

  console.log('[IPC] AI handlers registered (pi-ai integrated + chat persistence)')
}
