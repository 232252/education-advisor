// =============================================================
// 会话侧栏 — 新建按钮 + 会话列表（切换/删除）
// =============================================================

import { MessageSquare } from 'lucide-react'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { btnStyle, cn } from '../../../lib/ui-utils'
import type { ChatSession } from '../../../stores/chatStore'
import { formatTime } from '../lib/format'

interface SessionSidebarProps {
  sessions: ChatSession[]
  currentSessionId: string
  onCreateSession: () => void
  onSwitchSession: (id: string) => void
  /** 请求删除会话（弹出确认框），由页面持有确认状态 */
  onRequestDelete: (id: string) => void
}

/** 左侧会话列表侧栏 */
export function SessionSidebar({
  sessions,
  currentSessionId,
  onCreateSession,
  onSwitchSession,
  onRequestDelete,
}: SessionSidebarProps) {
  const { t } = useT()

  return (
    <div className="w-64 flex-shrink-0 border-r border-gray-200/60 dark:border-white/[0.06] flex flex-col bg-gray-50/80 dark:bg-surface-tertiary">
      {/* 顶部操作区 */}
      <div className="p-3 border-b border-gray-200/60 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={onCreateSession}
          className={cn('w-full', btnStyle('primary'))}
        >
          + {t('page.chat.newConversation')}
        </button>
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={28} />}
            title={t('page.chat.empty.title')}
            className="py-10"
          />
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`group relative flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200
                  ${
                    session.id === currentSessionId
                      ? 'bg-blue-50 dark:bg-blue-500/[0.1] border border-blue-200/60 dark:border-blue-500/20 shadow-sm'
                      : 'hover:bg-gray-100 dark:hover:bg-white/[0.04] border border-transparent'
                  }`}
            >
              <button
                type="button"
                onClick={() => onSwitchSession(session.id)}
                className="flex-1 min-w-0 text-left bg-transparent"
              >
                <div className="text-sm font-medium truncate dark:text-gray-200">
                  {session.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                  <span>{formatTime(session.createdAt)}</span>
                  <span>·</span>
                  <span>
                    {session.messageCount} {t('common.info')}
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRequestDelete(session.id)
                }}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ml-2 w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-500 transition-all text-xs"
                title={t('common.delete')}
                aria-label="删除对话"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
