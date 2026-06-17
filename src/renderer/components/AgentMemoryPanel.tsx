// =============================================================
// AgentMemoryPanel — 管理单个 Agent 的跨会话记忆
//
// 功能:
//   - 列出最近 N 条记忆
//   - 删除单条记忆
//   - 手动添加 fact / preference / summary 记忆
// =============================================================

import type { AgentMemoryRecord } from '@shared/types'
import { useEffect, useState } from 'react'
import { getAPI } from '../lib/ipc-client'
import { toast } from '../stores/toastStore'

/** 尝试美化 JSON 字符串；若不是合法 JSON 则原样显示 */
function prettifyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

interface Props {
  agentId: string
}

export function AgentMemoryPanel({ agentId }: Props) {
  const [memories, setMemories] = useState<AgentMemoryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<'fact' | 'preference' | 'summary'>('fact')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const rows = await getAPI().agent.listMemory(agentId, 20)
        if (!cancelled) setMemories(rows)
      } catch (err) {
        if (!cancelled) {
          console.error('[AgentMemoryPanel] load failed:', err)
          toast.error('加载记忆失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [agentId])

  const handleDelete = async (id: string) => {
    try {
      await getAPI().agent.deleteMemory(id)
      setMemories((prev) => prev.filter((m) => m.id !== id))
    } catch (err) {
      console.error('[AgentMemoryPanel] delete failed:', err)
      toast.error('删除记忆失败')
    }
  }

  const handleCreate = async () => {
    if (!content.trim()) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(content.trim()) as Record<string, unknown>
    } catch {
      toast.error('内容必须是合法 JSON')
      return
    }
    setSaving(true)
    try {
      await getAPI().agent.createMemory(agentId, kind, parsed)
      setContent('')
      // 重新加载
      const rows = await getAPI().agent.listMemory(agentId, 20)
      setMemories(rows)
    } catch (err) {
      console.error('[AgentMemoryPanel] create failed:', err)
      toast.error('创建记忆失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* 新建记忆 */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm"
          >
            <option value="fact">fact</option>
            <option value="preference">preference</option>
            <option value="summary">summary</option>
          </select>
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleCreate()
              }
            }}
            placeholder='{"key":"value"}'
            className="flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded px-3 py-1 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving || !content.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-3 py-1 rounded text-sm transition-colors"
          >
            {saving ? '保存中...' : '添加'}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          内容需为 JSON。Agent 下次运行时会自动读取最近 5 条记忆。
        </p>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm">加载中...</div>
        ) : memories.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm">暂无记忆</div>
        ) : (
          <div className="space-y-2">
            {memories.map((m) => (
              <div
                key={m.id}
                className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3 text-sm"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-blue-600 dark:text-blue-400">
                    {m.kind}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(m.id)}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline"
                  >
                    删除
                  </button>
                </div>
                <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-mono">
                  {prettifyJson(m.content)}
                </pre>
                {m.sourceRunId && (
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                    run: {m.sourceRunId}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
