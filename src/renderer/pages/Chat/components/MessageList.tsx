// =============================================================
// 消息列表 — 空状态 + 消息流 + 底部滚动锚点 + 复制状态管理
// =============================================================

import type { ChatMessage } from '@shared/types'
import { type RefObject, useState } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { getMessageKey } from '../lib/chat-message'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  canSend: boolean
  /** 底部滚动锚点 ref（由页面持有，配合自动滚动 effect） */
  messagesEndRef: RefObject<HTMLDivElement | null>
}

/** 消息区：遍历渲染消息 + 复制按钮交互状态 */
export function MessageList({ messages, isStreaming, canSend, messagesEndRef }: MessageListProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  // 复制助手消息内容到剪贴板
  const handleCopy = async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1500)
    } catch {
      /* 剪贴板不可用时静默忽略 */
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-gray-50/30 dark:bg-transparent">
      {messages.length === 0 && (
        <EmptyState
          icon={<span className="text-3xl">💬</span>}
          title="开始对话"
          description={canSend ? '输入消息即可开始' : '请先选择一个 Agent'}
          className="h-full"
        />
      )}

      {messages.map((msg, i) => (
        <MessageItem
          key={getMessageKey(msg, i)}
          msg={msg}
          index={i}
          isStreaming={isStreaming}
          isLast={i === messages.length - 1}
          copied={copiedIdx === i}
          onCopy={handleCopy}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
}
