// =============================================================
// 顶部工具栏 — Agent 选择器 + 模型配置 + 思考级别 + 清空按钮
// 纯 Agent 模式: 三者常驻显示
// =============================================================

import { effectiveThinkingLevel, THINKING_LEVELS } from '@shared/thinking-levels'
import type { AgentListItem } from '@shared/types'
import { memo, useState } from 'react'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { ModelSelector } from '../../../components/ModelSelector'
import { useT } from '../../../i18n'

interface ChatToolbarProps {
  /** 可用 Agent 列表（仅启用的） */
  enabledAgents: AgentListItem[]
  selectedAgentId: string
  onSelectAgent: (id: string) => void
  thinkingLevel: string
  /** 当前模型接受的档。null 时先列出全部。 */
  reasoningLevels: readonly string[] | null
  onThinkingLevelChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  selectedProvider: string
  selectedModel: string
  onModelSelect: (provider: string, model: string) => void
  onClearMessages: () => void
  /** 对话模式（DSH 行开关预设）；缺省 standard */
  chatMode?: string
  onModeChange?: (mode: string) => void
}

/** 顶部工具栏（Agent / 模型 / 思考级别 常驻） */
export const ChatToolbar = memo(function ChatToolbar({
  enabledAgents,
  selectedAgentId,
  onSelectAgent,
  thinkingLevel,
  reasoningLevels,
  onThinkingLevelChange,
  selectedProvider,
  selectedModel,
  onModelSelect,
  onClearMessages,
  chatMode,
  onModeChange,
}: ChatToolbarProps) {
  const [confirmClear, setConfirmClear] = useState(false)
  const { t } = useT()
  const allowed = reasoningLevels ?? THINKING_LEVELS
  const shownThinking = effectiveThinkingLevel(thinkingLevel, allowed)
  const thinkingTitle =
    shownThinking === thinkingLevel
      ? t('page.chat.toolbar.thinkingLevel', '思考级别')
      : t('page.chat.toolbar.thinkingUnsupported', '这个模型没有当前档，这一轮按关闭发送')
  return (
    <div className="flex items-center justify-between px-6 py-2 border-b border-gray-200/60 dark:border-white/[0.06] flex-wrap gap-2">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Agent 选择器 — 常驻显示 */}
        <select
          value={selectedAgentId}
          onChange={(e) => onSelectAgent(e.target.value)}
          className="bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300
                         focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-transparent min-w-[160px] transition-colors"
          title={t('page.chat.toolbar.selectAgent', '选择 Agent')}
        >
          {enabledAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {a.role}
            </option>
          ))}
        </select>

        {/* 分隔线 */}
        <div className="h-4 w-px bg-gray-200 dark:bg-white/[0.08]" />

        {/* 模型配置 — 常驻显示 */}
        <ModelSelector
          selectedProvider={selectedProvider}
          selectedModel={selectedModel}
          onSelect={onModelSelect}
        />

        <select
          value={shownThinking}
          onChange={onThinkingLevelChange}
          className="bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300
                         focus:outline-none focus:border-blue-500 transition-colors"
          title={thinkingTitle}
        >
          {allowed.includes('off') && (
            <option value="off">
              {t('page.chat.thinking', '思考')} {t('page.chat.toolbar.think.off', '关')}
            </option>
          )}
          {allowed.includes('minimal') && (
            <option value="minimal">
              {t('page.chat.thinking', '思考')} {t('page.chat.toolbar.think.minimal', '最少')}
            </option>
          )}
          {allowed.includes('low') && (
            <option value="low">
              {t('page.chat.thinking', '思考')} {t('page.chat.toolbar.think.low', '低')}
            </option>
          )}
          {allowed.includes('medium') && (
            <option value="medium">
              {t('page.chat.thinking', '思考')} {t('page.chat.toolbar.think.medium', '中')}
            </option>
          )}
          {allowed.includes('high') && (
            <option value="high">
              {t('page.chat.thinking', '思考')} {t('page.chat.toolbar.think.high', '高')}
            </option>
          )}
          {allowed.includes('xhigh') && (
            <option value="xhigh">
              {t('page.chat.thinking', '思考')} {t('page.chat.toolbar.think.xhigh', '最高')}
            </option>
          )}
          {allowed.includes('max') && (
            <option value="max">
              {t('page.chat.thinking', '思考')} {t('page.chat.toolbar.think.max', '极限')}
            </option>
          )}
        </select>

        {/* 对话模式 — DSH 行开关预设：普通 / 计划评审 / 代码编排 */}
        <select
          value={chatMode ?? 'standard'}
          onChange={(e) => onModeChange?.(e.target.value)}
          aria-label={t('page.chat.toolbar.modeAria', '对话模式')}
          className="bg-white border border-gray-300 dark:bg-surface-elevated dark:border-white/[0.08] rounded-lg px-2 py-1.5 text-xs text-gray-600 dark:text-gray-300
                         focus:outline-none focus:border-blue-500 transition-colors"
          title={t(
            'page.chat.toolbar.modeTitle',
            '对话模式：计划模式先出计划供你评审；代码编排让模型写代码批量调工具',
          )}
        >
          <option value="standard">{t('page.chat.toolbar.mode.standard', '普通')}</option>
          <option value="plan">{t('page.chat.toolbar.mode.plan', '计划')}</option>
          <option value="ptc">{t('page.chat.toolbar.mode.ptc', '代码编排')}</option>
        </select>
      </div>
      <Button
        variant="ghost"
        onClick={() => setConfirmClear(true)}
        aria-label={t('page.chat.toolbar.clearAria', '清空当前会话显示')}
        title={t('page.chat.toolbar.clearTitle', '清空当前会话显示(不删除会话)')}
      >
        {t('page.chat.toolbar.clear', '清空')}
      </Button>
      {/* 清空为不可逆操作(仅会话数据保留),需二次确认 */}
      <ConfirmDialog
        open={confirmClear}
        title={t('page.chat.toolbar.clearConfirmTitle', '清空当前会话')}
        message={t(
          'page.chat.toolbar.clearConfirmMessage',
          '确定要清空当前会话的消息显示吗?该操作无法撤销(会话记录本身不会被删除)。',
        )}
        confirmText={t('page.chat.toolbar.clear', '清空')}
        variant="danger"
        onConfirm={() => {
          setConfirmClear(false)
          onClearMessages()
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
})
