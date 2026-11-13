// =============================================================
// 智能体提问宿主 — dsh 运行时向教师澄清时弹出结构化问答。
// 挂在 App 根上，离开对话页也还在。取消回传 cancelled，绝不等于同意。
// =============================================================

import type { AgentQuestionAnswerItem, AgentQuestionRequest } from '@shared/api/agent-question'
import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { getAPI } from '../lib/ipc-client'

interface Draft {
  selected: string[]
  custom: string
}

export function AgentQuestionHost() {
  const { t } = useT()
  const [queue, setQueue] = useState<AgentQuestionRequest[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  useEffect(() => {
    return getAPI().agentQuestion.onRequest((req) => {
      setQueue((prev) => [...prev, req])
      const init: Record<string, Draft> = {}
      for (const q of req.questions) init[q.id] = { selected: [], custom: '' }
      setDrafts(init)
    })
  }, [])

  const current = queue[0]

  const dismiss = (cancelled: boolean) => {
    if (!current) return
    const requestId = current.requestId
    setQueue((prev) => prev.filter((item) => item.requestId !== current.requestId))
    if (cancelled) {
      void getAPI().agentQuestion.respond(requestId, { cancelled: true })
      return
    }
    const answers: AgentQuestionAnswerItem[] = current.questions.map((q) => {
      const d = drafts[q.id] ?? { selected: [], custom: '' }
      return {
        id: q.id,
        selected: d.selected,
        ...(d.custom.trim() ? { custom: d.custom.trim() } : {}),
      }
    })
    void getAPI().agentQuestion.respond(requestId, { answers })
  }

  if (!current) return null

  const toggle = (qid: string, label: string, multi: boolean) => {
    setDrafts((prev) => {
      const d = prev[qid] ?? { selected: [], custom: '' }
      const selected = multi
        ? d.selected.includes(label)
          ? d.selected.filter((s) => s !== label)
          : [...d.selected, label]
        : [label]
      return { ...prev, [qid]: { ...d, selected } }
    })
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-surface-elevated shadow-xl p-5 space-y-4">
        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          {t('agentQuestion.title', '助手想向你确认')}
        </div>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {current.questions.map((q) => {
            const d = drafts[q.id] ?? { selected: [], custom: '' }
            return (
              <div key={q.id} className="space-y-2">
                <div className="text-sm text-gray-700 dark:text-gray-200">{q.question}</div>
                {q.detail && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">{q.detail}</div>
                )}
                {q.options && q.options.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {q.options.map((opt) => {
                      const active = d.selected.includes(opt.label)
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => toggle(q.id, opt.label, Boolean(q.multiSelect))}
                          className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                            active
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-surface-secondary text-gray-700 dark:text-gray-200 border-gray-300 dark:border-white/[0.08] hover:border-blue-400'
                          }`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={d.custom}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [q.id]: { ...d, custom: e.target.value },
                      }))
                    }
                    className="w-full rounded-lg border border-gray-300 dark:border-white/[0.08] bg-white dark:bg-surface-secondary px-3 py-1.5 text-sm"
                  />
                )}
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => dismiss(true)}
            className="px-4 py-1.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            type="button"
            onClick={() => dismiss(false)}
            className="px-4 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
          >
            {t('agentQuestion.submit', '提交')}
          </button>
        </div>
      </div>
    </div>
  )
}
