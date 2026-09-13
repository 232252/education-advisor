// =============================================================
// MemoCard — AI 备忘卡片(仪表盘页尾)
// 起因: save_memory 落盘后教师无感知,唯一入口在 设置→记忆管理,
// 教师不知道 AI"记住了什么"。本卡在仪表盘展示最近记忆;
// 用户不喜占首屏,置于页面末尾(数据卡+系统管理区之后)。
// task 类 = 工作备忘(高亮);超 14 天未续存的 task 备忘 AI 不再
// 自动注入(system prompt 时效,见 memory-service TASK_MEMO_TTL_MS),
// 标注时效避免教师误以为 AI 还记得。
// 只读展示;删除/清空等管理动作仍留在设置页,不在本卡重复确认流。
// =============================================================

import type { MemoryAgentEntries } from '@shared/api/memory'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/Button'
import { Card, CardHeader } from '../../../components/Card'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { formatDateTime } from '../../../lib/ui-utils'

/** 与 memory-service TASK_MEMO_TTL_MS 一致(14 天),超期不再注入 */
const TASK_MEMO_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** 卡内最多直列展示条数,其余收进"未展示"计数 */
const VISIBLE_LIMIT = 4

interface MemoRow {
  id: string
  content: string
  category: string
  createdAt: number
  agentId: string
  agentName: string
  expired: boolean
}

interface AgentBasic {
  id: string
  name: string
}

function categoryLabel(category: string, t: (k: string, f?: string) => string): string {
  if (category === 'task') return t('page.dashboard.memo.categoryTask', '备忘')
  if (category === 'fact') return t('page.dashboard.memo.categoryFact', '事实')
  if (category === 'user_preference') return t('page.dashboard.memo.categoryPref', '偏好')
  return category
}

export function MemoCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useT()
  const navigate = useNavigate()
  const [rows, setRows] = useState<MemoRow[] | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey 是外部触发器,变化即重载
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [entries, agents] = await Promise.all([
          getAPI().memory.list(),
          getAPI()
            .agent.list()
            .catch(() => [] as AgentBasic[]),
        ])
        if (cancelled) return
        const names: Record<string, string> = {}
        for (const a of (agents ?? []) as AgentBasic[]) names[a.id] = a.name
        const now = Date.now()
        const flattened: MemoRow[] = (entries as MemoryAgentEntries[]).flatMap((agent) =>
          agent.entries.map((e) => ({
            id: e.id,
            content: e.content,
            category: e.category,
            createdAt: e.createdAt,
            agentId: agent.agentId,
            agentName: names[agent.agentId] ?? agent.agentId,
            expired: e.category === 'task' && now - e.createdAt > TASK_MEMO_TTL_MS,
          })),
        )
        flattened.sort((a, b) => b.createdAt - a.createdAt)
        setRows(flattened)
      } catch (err) {
        console.error('[Dashboard] memo load failed:', err)
        if (!cancelled) setRows([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (rows === null || rows.length === 0) return null

  const visible = rows.slice(0, VISIBLE_LIMIT)
  const rest = rows.length - visible.length

  return (
    <Card padding="md">
      <CardHeader
        title={t('page.dashboard.memo.title', 'AI 备忘')}
        subtitle={t(
          'page.dashboard.memo.subtitle',
          'AI 记下的工作备忘与结论，新内容会自动出现在这里',
        )}
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate('/settings')}>
            {t('page.dashboard.memo.manage', '管理')}
          </Button>
        }
      />
      <div className="space-y-2.5">
        {visible.map((row) => (
          <div key={`${row.agentId}-${row.id}`} className="flex items-start gap-2.5">
            <span
              className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none ${
                row.category === 'task'
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
              }`}
            >
              {categoryLabel(row.category, t)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-gray-700 dark:text-gray-300 break-words">
                {row.content}
              </div>
              <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">
                {formatDateTime(row.createdAt)} · {row.agentName}
                {row.expired &&
                  ` · ${t('page.dashboard.memo.expired', '已过时效，AI 不再自动加载')}`}
              </div>
            </div>
          </div>
        ))}
      </div>
      {rest > 0 && (
        <div className="mt-3 border-t border-gray-100 dark:border-white/[0.06] pt-2 text-[10px] text-gray-400 dark:text-gray-500">
          {rest} {t('page.dashboard.memo.moreSuffix', '条未展示 · 设置中可管理')}
        </div>
      )}
    </Card>
  )
}
