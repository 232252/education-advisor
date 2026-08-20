// =============================================================
// Agent 详情面板 — 头部信息 + Tab 切换（config/run/soul/rules/history）
// =============================================================

import type { AgentDetail } from '@shared/types'
import { memo, useState } from 'react'
import { useT } from '../../../i18n'
import { getAgentStatusLabel, getModelTierLabel } from '../lib/agent-display'
import type { AgentUpdatePatch, TabKey } from '../types'
import { ConfigTab } from './ConfigTab'
import { EditorTab } from './EditorTab'
import { HistoryTab } from './HistoryTab'
import { RunTab } from './RunTab'

interface DetailPanelProps {
  detail: AgentDetail
  onRun: (id: string, prompt: string) => Promise<void>
  onAbort: (id: string) => Promise<void>
  onSaveSoul: (id: string, content: string) => Promise<void>
  onSaveRules: (id: string, content: string) => Promise<void>
  onUpdate: (id: string, patch: AgentUpdatePatch) => Promise<void>
}

export const AgentDetailPanel = memo(function AgentDetailPanel({
  detail,
  onRun,
  onAbort,
  onSaveSoul,
  onSaveRules,
  onUpdate,
}: DetailPanelProps) {
  const { t } = useT()
  const [tab, setTab] = useState<TabKey>('run')

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'config', label: t('page.agents.tab.config', '配置') },
    { key: 'run', label: t('page.agents.tab.run', '执行') },
    { key: 'soul', label: 'SOUL.md' },
    { key: 'rules', label: 'AGENTS.md' },
    {
      key: 'history',
      label: `${t('page.agents.tab.history', '历史')} (${detail.executionHistory.length})`,
    },
  ]

  return (
    <>
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200 dark:border-white/[0.06]">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">{detail.name}</h2>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              detail.status === 'running'
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                : detail.status === 'error'
                  ? 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-300'
                  : detail.enabled
                    ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300'
                    : 'bg-gray-100 dark:bg-surface-elevated text-gray-500 dark:text-gray-400'
            }`}
          >
            {getAgentStatusLabel(detail.status, detail.enabled)}
          </span>
          {!detail.enabled && (
            <span className="text-xs text-yellow-600 dark:text-yellow-500 bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 rounded">
              {t('common.disabled', '已禁用')}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {detail.description || detail.role}
        </p>
        <div className="flex gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
          <span>
            {t('page.agents.detail.model', '模型')}: {getModelTierLabel(detail.modelTier)}
          </span>
          <span>
            {t('page.agents.detail.capabilities', '能力')}:{' '}
            {detail.capabilities.join(', ') || t('common.none', '无')}
          </span>
          {detail.schedule.length > 0 && (
            <span>
              {t('page.agents.detail.schedule', '定时')}: {detail.schedule.join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* Tab 栏 */}
      <div className="flex border-b border-gray-200 dark:border-white/[0.06]">
        {tabs.map((t) => (
          <button
            type="button"
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm transition-colors
              ${
                tab === t.key
                  ? 'text-blue-500 dark:text-blue-400 border-b-2 border-blue-500 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-hidden">
        {tab === 'config' && <ConfigTab detail={detail} onUpdate={onUpdate} />}
        {tab === 'run' && (
          <RunTab agentId={detail.id} enabled={detail.enabled} onRun={onRun} onAbort={onAbort} />
        )}
        {tab === 'soul' && (
          <EditorTab
            content={detail.soulContent}
            placeholder={`${t('page.agents.editor.soulPrefix', '你是')} ${detail.name}...\n\n${t('page.agents.editor.soulHint', '在此编辑 Agent 的人格设定。')}`}
            onSave={(c) => onSaveSoul(detail.id, c)}
          />
        )}
        {tab === 'rules' && (
          <EditorTab
            content={detail.rulesContent}
            placeholder={t('page.agents.editor.rulesPlaceholder', '在此编辑 Agent 的行为规则...')}
            onSave={(c) => onSaveRules(detail.id, c)}
          />
        )}
        {tab === 'history' && <HistoryTab executions={detail.executionHistory} />}
      </div>
    </>
  )
})
