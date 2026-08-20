// =============================================================
// 单条消息项 — 头像 / 气泡 / 工具调用 / 思考过程 / 复制按钮
// =============================================================

import type { ChatMessage } from '@shared/types'
import { Bot, Check, Copy } from 'lucide-react'
import { Markdown } from '../../../components/Markdown'
import { useT } from '../../../i18n'
import { ToolCallRow } from './ToolCallRow'
import { TypingDots } from './TypingDots'

interface MessageItemProps {
  msg: ChatMessage
  index: number
  isStreaming: boolean
  isLast: boolean
  copied: boolean
  onCopy: (idx: number, text: string) => void
}

/** 消息列表中的单条消息（用户/助手气泡） */
export function MessageItem({ msg, index, isStreaming, isLast, copied, onCopy }: MessageItemProps) {
  const { t } = useT()
  return (
    <div
      className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} ${msg.role !== 'user' ? 'gap-2.5 items-end' : ''}`}
    >
      {/* 助手头像 */}
      {msg.role !== 'user' && (
        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 dark:from-blue-400 dark:to-indigo-500 flex items-center justify-center shadow-sm shadow-blue-500/20 mb-0.5">
          <Bot size={16} className="text-white" strokeWidth={2.2} />
        </div>
      )}
      <div className={`flex flex-col ${msg.role !== 'user' ? 'max-w-[70%]' : ''}`}>
        <div
          className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                  ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-md shadow-md shadow-blue-500/15'
                      : 'bg-white text-gray-800 dark:bg-surface-tertiary dark:text-gray-100 rounded-bl-md border border-gray-200/70 dark:border-white/[0.06] shadow-sm'
                  }`}
        >
          {/* 工具调用（放顶部） */}
          {msg.toolCalls && msg.toolCalls.length > 0 && (
            <div className="mb-2 space-y-1">
              {msg.toolCalls.map((tc) => (
                <ToolCallRow key={tc.id} tc={tc} />
              ))}
            </div>
          )}
          {/* 思考过程 */}
          {msg.thinking && (
            <details className="mb-2">
              <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer hover:text-gray-700 dark:hover:text-gray-300">
                {t('page.chat.message.thinkingProcess', '思考过程')}
              </summary>
              <div className="mt-1 text-xs text-gray-400 dark:text-gray-500 whitespace-pre-wrap pl-2 border-l border-gray-300 dark:border-white/[0.06]">
                {msg.thinking}
              </div>
            </details>
          )}
          {/* 消息内容（放底部） — 助手用 Markdown 渲染, 用户保持纯文本 */}
          {msg.role === 'user' ? (
            <div className="whitespace-pre-wrap">
              {msg.content || (isStreaming && isLast ? <TypingDots /> : '')}
            </div>
          ) : msg.content ? (
            <Markdown content={msg.content} />
          ) : isStreaming && isLast ? (
            <TypingDots />
          ) : (
            ''
          )}
        </div>
        {/* 助手消息 hover 复制按钮（流式中的最后一条不显示） */}
        {msg.role !== 'user' && msg.content && !(isStreaming && isLast) && (
          <button
            type="button"
            onClick={() => onCopy(index, msg.content)}
            className="self-start mt-1 inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity duration-150 px-1"
            aria-label={
              copied ? t('page.chat.message.copied', '已复制') : t('page.chat.message.copy', '复制')
            }
          >
            {copied ? (
              <>
                <Check size={12} strokeWidth={2.5} className="text-green-500" />
                {t('page.chat.message.copied', '已复制')}
              </>
            ) : (
              <>
                <Copy size={12} strokeWidth={2} />
                {t('page.chat.message.copy', '复制')}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
