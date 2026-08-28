// =============================================================
// 记忆管理 Section — 查看/删除各 agent 的长期记忆(R2+ 记忆透明化)
// 此前 save_memory 发生时用户无感知、也无任何查看/删除入口;
// 本段让"AI 记住了什么"可审查、可清除
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { useT } from '../../../i18n'
import type { MemoryAgentEntries } from '../../../lib/ipc/memory'
import { getAPI } from '../../../lib/ipc-client'
import { formatDateTime } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import { Section, SettingRow } from '../components'

interface AgentBasic {
  id: string
  name: string
}

export function MemorySection() {
  const { t } = useT()
  const [data, setData] = useState<MemoryAgentEntries[] | null>(null)
  const [agentNames, setAgentNames] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pendingClear, setPendingClear] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [entries, agents] = await Promise.all([
        getAPI().memory.list(),
        getAPI()
          .agent.list()
          .catch(() => [] as AgentBasic[]),
      ])
      setData(entries)
      const names: Record<string, string> = {}
      for (const a of agents as AgentBasic[]) names[a.id] = a.name
      setAgentNames(names)
    } catch (err) {
      console.error('[Settings] memory.list failed:', err)
      setData([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleDeleteEntry = async (agentId: string, entryId: string) => {
    const result = await getAPI().memory.deleteEntry(agentId, entryId)
    if (result.success) {
      toast.success(t('settings.memory.deleteSuccess', '记忆已删除'))
      void load()
    } else {
      toast.error(`${t('settings.memory.deleteFailed', '删除失败')}: ${result.error ?? ''}`)
    }
  }

  const handleClear = async (agentId: string) => {
    const result = await getAPI().memory.clear(agentId)
    if (result.success) {
      toast.success(t('settings.memory.clearSuccess', '已清空该 Agent 的记忆'))
      void load()
    } else {
      toast.error(`${t('settings.memory.clearFailed', '清空失败')}: ${result.error ?? ''}`)
    }
  }

  const total = data?.reduce((acc, a) => acc + a.entries.length, 0) ?? 0

  return (
    <Section title={t('settings.memory.title', '记忆管理')}>
      <SettingRow
        label={t('settings.memory.titleLabel', 'AI 长期记忆')}
        path="memory"
        description={t('settings.memory.desc')}
      >
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {total} {t('settings.memory.entriesUnit', '条')}
        </span>
      </SettingRow>

      {data === null ? (
        <div className="px-5 py-4 text-xs text-gray-400 dark:text-gray-500">
          {t('common.loading', '加载中…')}
        </div>
      ) : data.length === 0 ? (
        <div className="px-5 py-4 text-xs text-gray-400 dark:text-gray-500">
          {t('settings.memory.empty')}
        </div>
      ) : (
        <div className="px-5 py-4 space-y-2">
          {data.map((agent) => (
            <div
              key={agent.agentId}
              className="rounded-lg border border-gray-200 dark:border-white/[0.06] overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpanded(expanded === agent.agentId ? null : agent.agentId)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
              >
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                  {agentNames[agent.agentId] ?? agent.agentId}
                  <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500">
                    {agent.entries.length} {t('settings.memory.entriesUnit', '条')}
                  </span>
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingClear(agent.agentId)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      setPendingClear(agent.agentId)
                    }
                  }}
                  className="text-[10px] px-2 py-0.5 rounded text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  {t('settings.memory.clearAll', '清空')}
                </span>
              </button>

              {expanded === agent.agentId && (
                <div className="divide-y divide-gray-100 dark:divide-white/[0.04] border-t border-gray-100 dark:border-white/[0.04]">
                  {agent.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-start justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-gray-700 dark:text-gray-300 break-words">
                          {entry.content}
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {formatDateTime(entry.createdAt)} · {entry.category}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteEntry(agent.agentId, entry.id)}
                        className="text-[10px] px-2 py-0.5 rounded text-red-500 dark:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      >
                        {t('common.delete', '删除')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingClear !== null}
        title={t('settings.memory.clearAll', '清空')}
        message={t('settings.memory.clearConfirm')}
        variant="danger"
        onConfirm={() => {
          const agentId = pendingClear
          setPendingClear(null)
          if (agentId) void handleClear(agentId)
        }}
        onCancel={() => setPendingClear(null)}
      />
    </Section>
  )
}
