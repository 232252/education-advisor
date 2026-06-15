// =============================================================
// AgentHistoryPage — P6 跨 Agent 执行历史全局页面
// 集中查看所有 Agent 的执行记录,带统计、过滤、详情抽屉
//
// 路由: /agents/history
//
// 特性:
//   - 顶部 4 张统计卡(总运行 / 成功率 / 总费用 / 总 token)
//   - 过滤条: agent 多选 + 状态多选 + 时间范围
//   - 表格: 时间、Agent、状态、指令摘要、耗时、Token、费用
//   - 行点击 → 右侧抽屉显示完整 prompt / output / 错误信息
// =============================================================

import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'

// 状态文案 & 配色
const STATUS_LABELS: Record<'success' | 'error' | 'timeout', string> = {
  success: '成功',
  error: '错误',
  timeout: '超时',
}
const STATUS_STYLES: Record<'success' | 'error' | 'timeout', string> = {
  success: 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400',
  error: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
  timeout: 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400',
}

// 时间范围预设
type TimeRangeKey = 'all' | '1h' | '24h' | '7d' | '30d'
const TIME_RANGE_OPTIONS: Array<{ key: TimeRangeKey; label: string; ms?: number }> = [
  { key: 'all', label: '全部' },
  { key: '1h', label: '1 小时', ms: 60 * 60 * 1000 },
  { key: '24h', label: '24 小时', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: '7 天', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: '30 天', ms: 30 * 24 * 60 * 60 * 1000 },
]

interface ExecutionRow {
  id: string
  agentId: string
  prompt: string
  output: string
  startedAt: number
  durationMs: number
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number }
  cost: number
  status: 'success' | 'error' | 'timeout'
}

interface ExecutionStats {
  totalRuns: number
  successCount: number
  errorCount: number
  timeoutCount: number
  successRate: number
  totalCost: number
  totalTokens: number
  totalDurationMs: number
}

export function AgentHistoryPage() {
  const { t } = useT()
  const [executions, setExecutions] = useState<ExecutionRow[]>([])
  const [stats, setStats] = useState<ExecutionStats | null>(null)
  const [agentNameMap, setAgentNameMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  // 过滤
  const [filterAgentIds, setFilterAgentIds] = useState<Set<string>>(new Set())
  const [filterStatuses, setFilterStatuses] = useState<Set<'success' | 'error' | 'timeout'>>(
    new Set(),
  )
  const [filterRange, setFilterRange] = useState<TimeRangeKey>('all')
  const [searchText, setSearchText] = useState('')

  // 详情抽屉
  const [selected, setSelected] = useState<ExecutionRow | null>(null)

  // 加载数据
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sinceMs =
        filterRange === 'all'
          ? 0
          : Date.now() - (TIME_RANGE_OPTIONS.find((o) => o.key === filterRange)?.ms ?? 0)
      const status = filterStatuses.size === 1 ? Array.from(filterStatuses)[0] : undefined
      // 单 agent 过滤时用 agentId;多选时为空,先取全部再在 UI 层过滤
      const agentId = filterAgentIds.size === 1 ? Array.from(filterAgentIds)[0] : undefined
      const data = await getAPI().agent.getAllExecutions({
        sinceMs,
        status,
        agentId,
        limit: 500,
      })
      // 多选过滤在 UI 层完成
      let rows = data.executions
      if (filterAgentIds.size > 1) {
        rows = rows.filter((r) => filterAgentIds.has(r.agentId))
      }
      if (filterStatuses.size > 1) {
        rows = rows.filter((r) => filterStatuses.has(r.status))
      }
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase()
        rows = rows.filter(
          (r) =>
            r.prompt.toLowerCase().includes(q) ||
            r.output.toLowerCase().includes(q) ||
            (agentNameMap[r.agentId] ?? r.agentId).toLowerCase().includes(q),
        )
      }
      setExecutions(rows)
      setStats(data.stats)
      setAgentNameMap(data.agentNameMap)
    } catch (err) {
      console.error('[AgentHistoryPage] load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [filterAgentIds, filterStatuses, filterRange, searchText, agentNameMap])

  useEffect(() => {
    load()
  }, [load])

  // 已知 agent 列表(用于过滤器多选)
  const knownAgents = useMemo(() => {
    return Object.entries(agentNameMap).map(([id, name]) => ({ id, name }))
  }, [agentNameMap])

  // 行渲染
  const rows = useMemo(() => {
    return executions
  }, [executions])

  // 切换过滤时清掉详情(否则详情可能与表格行不匹配)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 过滤变化强制重置详情
  useEffect(() => {
    setSelected(null)
  }, [filterAgentIds, filterStatuses, filterRange, searchText])

  // 切换某 agent 过滤
  const toggleAgent = (id: string) => {
    setFilterAgentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleStatus = (s: 'success' | 'error' | 'timeout') => {
    setFilterStatuses((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const clearFilters = () => {
    setFilterAgentIds(new Set())
    setFilterStatuses(new Set())
    setFilterRange('all')
    setSearchText('')
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            {t('agentHistory.title', 'Agent 执行历史')}
          </h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            跨所有 Agent 的运行记录、统计与详情
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200
              dark:hover:bg-gray-600 px-3 py-1.5 rounded transition-colors
              disabled:opacity-50"
          >
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 p-6 border-b border-gray-200 dark:border-gray-700">
        <StatCard
          label="总运行次数"
          value={stats ? String(stats.totalRuns) : '—'}
          accent="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          label="成功率"
          value={stats ? `${(stats.successRate * 100).toFixed(1)}%` : '—'}
          subtext={
            stats
              ? `成功 ${stats.successCount} · 错误 ${stats.errorCount} · 超时 ${stats.timeoutCount}`
              : ''
          }
          accent="text-green-600 dark:text-green-400"
        />
        <StatCard
          label="总费用 (USD)"
          value={stats ? `$${stats.totalCost.toFixed(4)}` : '—'}
          accent="text-amber-600 dark:text-amber-400"
        />
        <StatCard
          label="总 Token"
          value={stats ? stats.totalTokens.toLocaleString() : '—'}
          subtext={stats ? `累计耗时 ${(stats.totalDurationMs / 1000).toFixed(1)}s` : ''}
          accent="text-purple-600 dark:text-purple-400"
        />
      </div>

      {/* Filter Bar */}
      <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 flex-wrap text-xs">
        <span className="text-gray-400 dark:text-gray-500">过滤:</span>

        {/* Agent 多选 */}
        <div className="flex items-center gap-1">
          <span className="text-gray-500 dark:text-gray-400">Agent</span>
          {knownAgents.length === 0 ? (
            <span className="text-gray-300 dark:text-gray-600">(无)</span>
          ) : (
            knownAgents.map((a) => {
              const active = filterAgentIds.has(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAgent(a.id)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {a.name}
                </button>
              )
            })
          )}
        </div>

        <span className="text-gray-300 dark:text-gray-600">|</span>

        {/* 状态多选 */}
        <div className="flex items-center gap-1">
          <span className="text-gray-500 dark:text-gray-400">状态</span>
          {(['success', 'error', 'timeout'] as const).map((s) => {
            const active = filterStatuses.has(s)
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  active
                    ? STATUS_STYLES[s]
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            )
          })}
        </div>

        <span className="text-gray-300 dark:text-gray-600">|</span>

        {/* 时间范围 */}
        <div className="flex items-center gap-1">
          <span className="text-gray-500 dark:text-gray-400">时间</span>
          {TIME_RANGE_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setFilterRange(o.key)}
              className={`px-2 py-0.5 rounded transition-colors ${
                filterRange === o.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <span className="text-gray-300 dark:text-gray-600">|</span>

        {/* 搜索 */}
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="搜索 prompt / output / agent"
          className="flex-1 min-w-[160px] max-w-[280px] px-2 py-1
            bg-white dark:bg-gray-800 border border-gray-200
            dark:border-gray-600 rounded text-xs"
        />

        <button
          type="button"
          onClick={clearFilters}
          className="ml-auto text-gray-500 dark:text-gray-400 hover:text-blue-600
            dark:hover:text-blue-400 underline"
        >
          清空
        </button>
      </div>

      {/* Table + Drawer */}
      <div className="flex-1 flex overflow-hidden">
        <div className={`scroll-container overflow-y-auto ${selected ? 'w-2/3' : 'w-full'}`}>
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
              加载中...
            </div>
          ) : rows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
              暂无符合条件的执行记录
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800/80 backdrop-blur">
                <tr className="text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left p-3 font-normal">时间</th>
                  <th className="text-left p-3 font-normal">Agent</th>
                  <th className="text-left p-3 font-normal">状态</th>
                  <th className="text-left p-3 font-normal">指令</th>
                  <th className="text-right p-3 font-normal">耗时</th>
                  <th className="text-right p-3 font-normal">Token</th>
                  <th className="text-right p-3 font-normal">费用</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <HistoryRow
                    key={r.id}
                    exec={r}
                    agentName={agentNameMap[r.agentId] ?? r.agentId}
                    onClick={() => setSelected(r)}
                    active={selected?.id === r.id}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && <HistoryDetailPanel exec={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  subtext,
  accent,
}: {
  label: string
  value: string
  subtext?: string
  accent: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
      <div className="text-xs text-gray-400 dark:text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent}`}>{value}</div>
      {subtext && (
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">{subtext}</div>
      )}
    </div>
  )
}

// React.memo: 父组件状态变化 (如选中某行) 时, 只有 props 变化的行才重渲。
// 未 memo 前, 选中任意一行会让全部行重渲 (100+ 行 × 7 列 = 大量虚拟 DOM diff)。
const HistoryRow = memo(function HistoryRow({
  exec,
  agentName,
  onClick,
  active,
}: {
  exec: ExecutionRow
  agentName: string
  onClick: () => void
  active: boolean
}) {
  const d = new Date(exec.startedAt)
  const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`

  return (
    <tr
      onClick={onClick}
      className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors ${
        active ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <td className="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap font-mono text-xs">
        {timeStr}
      </td>
      <td className="p-3 text-gray-700 dark:text-gray-200 whitespace-nowrap">{agentName}</td>
      <td className="p-3">
        <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_STYLES[exec.status]}`}>
          {STATUS_LABELS[exec.status]}
        </span>
      </td>
      <td className="p-3 text-gray-600 dark:text-gray-300 truncate max-w-[320px]">{exec.prompt}</td>
      <td className="p-3 text-right text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">
        {(exec.durationMs / 1000).toFixed(2)}s
      </td>
      <td className="p-3 text-right text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">
        {exec.tokenUsage.inputTokens + exec.tokenUsage.outputTokens}
      </td>
      <td className="p-3 text-right text-gray-500 dark:text-gray-400 font-mono text-xs whitespace-nowrap">
        ${exec.cost.toFixed(4)}
      </td>
    </tr>
  )
})

function HistoryDetailPanel({ exec, onClose }: { exec: ExecutionRow; onClose: () => void }) {
  const d = new Date(exec.startedAt)
  const fullTime = d.toLocaleString('zh-CN', { hour12: false })

  return (
    <div className="w-1/3 border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-800/30">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_STYLES[exec.status]}`}>
            {STATUS_LABELS[exec.status]}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            {exec.id.slice(0, 8)}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <div className="text-[10px] uppercase text-gray-400 dark:text-gray-500 mb-1">时间</div>
          <div className="text-sm text-gray-700 dark:text-gray-200 font-mono">{fullTime}</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <Metric label="耗时" value={`${(exec.durationMs / 1000).toFixed(2)}s`} />
          <Metric
            label="Token"
            value={String(exec.tokenUsage.inputTokens + exec.tokenUsage.outputTokens)}
          />
          <Metric label="费用" value={`$${exec.cost.toFixed(4)}`} />
          <Metric label="In" value={String(exec.tokenUsage.inputTokens)} />
          <Metric label="Out" value={String(exec.tokenUsage.outputTokens)} />
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-400 dark:text-gray-500 mb-1">
            指令 (Prompt)
          </div>
          <pre
            className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap font-mono
            bg-white dark:bg-gray-900 p-3 rounded border border-gray-200
            dark:border-gray-700 max-h-60 overflow-y-auto"
          >
            {exec.prompt}
          </pre>
        </div>
        <div>
          <div className="text-[10px] uppercase text-gray-400 dark:text-gray-500 mb-1">
            输出 (Output)
          </div>
          <pre
            className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap font-mono
            bg-white dark:bg-gray-900 p-3 rounded border border-gray-200
            dark:border-gray-700 max-h-[400px] overflow-y-auto"
          >
            {exec.output || '(空)'}
          </pre>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-gray-400 dark:text-gray-500">{label}</div>
      <div className="text-sm text-gray-700 dark:text-gray-200 font-mono mt-0.5">{value}</div>
    </div>
  )
}
