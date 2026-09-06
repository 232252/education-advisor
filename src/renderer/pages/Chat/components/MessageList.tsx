// =============================================================
// 消息列表 — 空状态 + 消息流 + 底部滚动锚点 + 复制状态管理
// R2-15: copiedIdx 下沉到 MessageItem 局部态(此前在 List 层,
//        任意一次复制触发全列表重渲);handleCopy 依赖已稳定,List 本身增 memo
// 渐进渲染(2026-09-03): 长对话(百条含表格/公式 Markdown)不再整列表挂载 —
//        首屏只挂载最近 MESSAGE_WINDOW 条,顶部"查看更早消息"按需扩窗,
//        扩窗用"底边距补偿"保持视觉位置;键用全量索引,扩窗不重挂既有项
// =============================================================

import type { ChatMessage } from '@shared/types'
import { memo, type RefObject, useEffect, useRef, useState } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { getMessageKey } from '../lib/chat-message'
import { MessageItem } from './MessageItem'

/** 首屏/切会话时挂载的最近消息条数 */
const MESSAGE_WINDOW = 50
/** 每次点击"查看更早消息"扩出的条数 */
const MESSAGE_WINDOW_STEP = 100

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  canSend: boolean
  /** 会话标识 — 切换会话时重置渲染窗口(不能挂 messages:流式 flush 也改变其身份) */
  sessionKey: string
  /** 底部滚动锚点 ref（由页面持有，配合自动滚动 effect） */
  messagesEndRef: RefObject<HTMLDivElement | null>
  /** 滚动容器 ref — 页面据此直赋值 scrollTop(平滑动画高频重启会抖动) */
  scrollContainerRef?: RefObject<HTMLDivElement | null>
  /** 用户滚动回调 — 页面据此判断是否仍在底部附近(跟随开关) */
  onUserScroll?: (e: React.UIEvent<HTMLDivElement>) => void
}

/**
 * 消息区：遍历渲染消息 + 复制按钮交互状态。
 * R2-15: memo 化 — 流式 50ms 批量 flush 时,消息数组整体引用变化但
 *        未变的消息对象引用稳定,MessageItem 内容 props 不变即短路,避免
 *        长对话每次 flush 全量 VDOM 重 diff。
 */
export const MessageList = memo(function MessageList({
  messages,
  isStreaming,
  canSend,
  sessionKey,
  messagesEndRef,
  scrollContainerRef,
  onUserScroll,
}: MessageListProps) {
  const { t } = useT()
  const [visibleCount, setVisibleCount] = useState(MESSAGE_WINDOW)

  // 切换会话重置窗口
  // biome-ignore lint/correctness/useExhaustiveDependencies: 触发器式 effect,sessionKey 变化即重置可视窗口
  useEffect(() => {
    setVisibleCount(MESSAGE_WINDOW)
  }, [sessionKey])

  // 隐藏区起点;键仍用全量索引 → 扩窗时已挂载项不重挂、不丢失滚动内状态
  const startIdx = Math.max(0, messages.length - visibleCount)
  const hasEarlier = startIdx > 0

  // 扩窗保持视觉位置: 记录点击时"视口底边距"(scrollHeight - scrollTop),
  // 新内容插入渲染后把 scrollTop 补偿到同一底边距 — 经典 prepend 保位
  const bottomGapRef = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 触发器式 effect,扩窗后按记录的底边距补偿滚动位置
  useEffect(() => {
    if (bottomGapRef.current === 0) return
    const el = scrollContainerRef?.current
    if (el) el.scrollTop = el.scrollHeight - bottomGapRef.current
    bottomGapRef.current = 0
  }, [visibleCount, scrollContainerRef])

  const loadEarlier = () => {
    const el = scrollContainerRef?.current
    bottomGapRef.current = el ? el.scrollHeight - el.scrollTop : 0
    setVisibleCount((c) => c + MESSAGE_WINDOW_STEP)
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={onUserScroll}
      className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-gray-50/30 dark:bg-transparent"
    >
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

      {hasEarlier && (
        <div className="flex justify-center py-1">
          <button
            type="button"
            onClick={loadEarlier}
            className="text-xs text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
          >
            {t('page.chat.loadEarlier', '查看更早消息')} ({startIdx})
          </button>
        </div>
      )}

      {messages.map((msg, i) =>
        i < startIdx ? null : (
          <MessageItem
            key={getMessageKey(msg, i)}
            msg={msg}
            isStreaming={isStreaming}
            isLast={i === messages.length - 1}
          />
        ),
      )}
      <div ref={messagesEndRef} />
    </div>
  )
})
