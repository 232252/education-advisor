// =============================================================
// 消息列表 — 空状态 + 消息流 + 底部滚动锚点 + 复制状态管理
// R2-15: copiedIdx 下沉到 MessageItem 局部态(此前在 List 层,
//        任意一次复制触发全列表重渲);handleCopy 依赖已稳定,List 本身增 memo
// =============================================================

import type { ChatMessage } from '@shared/types'
import { memo, type RefObject } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { getMessageKey } from '../lib/chat-message'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  canSend: boolean
  /** 底部滚动锚点 ref（由页面持有，配合自动滚动 effect） */
  messagesEndRef: RefObject<HTMLDivElement | null>
}

/**
 * 消息区：遍历渲染消息 + 复制按钮交互状态。
 * R2-15: memo 化 — 流式 50ms 批量 flush 时,消息数组整体引用变化但
 * 未变的消息对象引用稳定,MessageItem 内容 props 不变即短路,避免
 * 长对话(几十条含表格/公式 Markdown)每次 flush 全量 VDOM 重 diff。
 */
export const MessageList = memo(function MessageList({
  messages,
  isStreaming,
  canSend,
  messagesEndRef,
}: MessageListProps) {
  const { t } = useT()

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-gray-50/30 dark:bg-transparent">
      {messages.length === 0 && (
        <EmptyState
          icon={<span className="text-3xl">💬</span>}
          title={t('page.chat.empty.title', '开始对话')}
          description={
            canSend
              ? t('page.chat.empty.subtitle', '输入消息即可开始')
              : t('page.chat.empty.selectAgent', '请先选择一个 Agent')
          }
          className="h-full"
        />
      )}

      {messages.map((msg, i) => (
        <MessageItem
          key={getMessageKey(msg, i)}
          msg={msg}
          isStreaming={isStreaming}
          isLast={i === messages.length - 1}
        />
      ))}
      <div ref={messagesEndRef} />
    </div>
  )
})
