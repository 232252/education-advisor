// =============================================================
// 学生档案组件 — 多选项卡详细视图
// 选项卡: 概览 | 档案 | 事件 | 学业 | AI分析
// =============================================================

import type {
  AcademicExamRecord,
  AgentListItem,
  EAAEventRecord,
  EAAHistoryData,
  EAAHistoryEvent,
  EAAReasonCode,
  EAAStudent,
  EAAStudentScore,
  StudentProfileData,
} from '@shared/types'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAnonymizedEAAEvents } from '../../hooks/useAnonymizedEAAEvents'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { usePrivacyFilter } from '../../hooks/usePrivacyFilter'
import { useTheme } from '../../hooks/useTheme'
import { useT } from '../../i18n'
import { getAPI, getErrorMessage } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

/** 将 EAAEventRecord（search/range 返回）映射为 EAAHistoryEvent 兼容结构 */
function eventRecordToHistory(rec: EAAEventRecord): EAAHistoryEvent {
  return {
    event_id: rec.event_id,
    timestamp: rec.timestamp,
    event_type: rec.event_type,
    reason_code: rec.reason_code,
    score_delta: rec.score_delta,
    cumulative: 0, // search/range 结果无累计值
    note: rec.note,
    tags: rec.tags,
    reverted: !rec.is_valid, // is_valid=false 视为已撤销
  }
}

import { riskColor } from '../../lib/risk'

interface StudentProfileProps {
  student: EAAStudent
  onClose: () => void
  onRefresh: () => void
}

type TabId = 'overview' | 'profile' | 'events' | 'academics' | 'ai'

/**
 * AI 分析输出结构 — 每个 agent 独立
 * B-05 修复: 避免多 agent 串行时输出混在一起
 * B-40 修复: 支持按 agent 单独中止
 */
type AgentRunStatus = 'idle' | 'running' | 'success' | 'error' | 'aborted'
interface AgentOutput {
  agentId: string
  status: AgentRunStatus
  output: string
  error?: string
  durationMs?: number
  startedAt?: number
}

export function StudentProfile({ student, onClose, onRefresh }: StudentProfileProps) {
  const { t } = useT()
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [score, setScore] = useState<EAAStudentScore | null>(null)
  const [history, setHistory] = useState<EAAHistoryData | null>(null)
  const [reasonCodes, setReasonCodes] = useState<EAAReasonCode[]>([])
  const [profileData, setProfileData] = useState<StudentProfileData>({})
  const [_profileLoaded, setProfileLoaded] = useState(false)
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [aiRunning, setAiRunning] = useState(false)
  // B-05/B-40 修复: 每个 agent 独立 output 桶,避免串行执行时多 agent 输出相互污染;
  //                支持按 agent 单独中止
  const [agentOutputs, setAgentOutputs] = useState<Record<string, AgentOutput>>({})
  const [agentRunOrder, setAgentRunOrder] = useState<string[]>([])
  const [activeAiTab, setActiveAiTab] = useState<string>('__overview')
  const [aiMessage, setAiMessage] = useState('')
  const setAiMessageAuto = useAutoDismiss<string>(setAiMessage, '')
  const [eventFilter, setEventFilter] = useState<'all' | 'bonus' | 'deduct'>('all')
  const [eventTimeRange, setEventTimeRange] = useState<'all' | 'week' | 'month' | 'semester'>('all')
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const setActionMsgAuto = useAutoDismiss<string>(setActionMsg, '')
  const [aiSaved, setAiSaved] = useState(false)
  // 事件搜索/日期范围状态
  const [searchQuery, setSearchQuery] = useState('')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const theme = useTheme()
  const isDark = theme === 'dark'

  // P1-4: 隐私脱敏 — 当前学生的显示名
  const { enabled: privacyEnabled, anonymize } = usePrivacyFilter()
  const [displayName, setDisplayName] = useState<string>(student.name)

  // 切换学生/隐私状态变化时刷新显示名
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!privacyEnabled) {
        if (!cancelled) setDisplayName(student.name)
        return
      }
      const mapped = await anonymize(student.name)
      if (!cancelled) setDisplayName(mapped)
    })()
    return () => {
      cancelled = true
    }
  }, [student.name, privacyEnabled, anonymize])

  // P2-7 修复: loadProfileData 原本在 useCallback(loadAllData) 之后声明,
  // 但 loadAllData 内部又调用 loadProfileData,产生 TDZ,跑起来 ReferenceError。
  // 提前并用 useCallback 包裹。
  // P2-1 修复: 加 currentNameRef 守卫, 旧请求完成时若已切换则不更新
  // B-04/B-08 修复: loadAllData 内所有 setScore/setHistory/setReasonCodes/setAgents 都要按 name guard
  //                否则慢请求会覆盖快请求,导致切换学生后旧数据污染新学生视图
  // B-38 修复: loadAllData 接受一个"最新学生"参数, 内部使用该参数而不是闭包中的 student
  const currentNameRef = useRef<string>(student.name)
  useEffect(() => {
    currentNameRef.current = student.name
  }, [student.name])
  const loadProfileData = useCallback(
    async (name: string) => {
      try {
        const result = await getAPI().profile.get(name)
        if (currentNameRef.current !== name) return
        if (result.success && result.data) {
          // B-32 修复: EAA class_id → profileData.classId 同步
          if (!result.data.classId && student.class_id) {
            result.data.classId = student.class_id
          }
          setProfileData(result.data)
        }
      } catch (err) {
        if (currentNameRef.current !== name) return
        console.warn('[Profile] Load profile data error:', err)
      }
      if (currentNameRef.current === name) setProfileLoaded(true)
    },
    [student.class_id],
  )

  const loadAllData = useCallback(
    async (nameOverride?: string) => {
      const name = nameOverride ?? student.name
      try {
        const [scoreRes, historyRes, codesRes, agentsRes] = await Promise.all([
          getAPI().eaa.score(name),
          getAPI().eaa.history(name),
          getAPI().eaa.codes(),
          getAPI().agent.list(),
        ])
        // 每个 set 都要 guard,避免旧请求污染
        if (currentNameRef.current === name && scoreRes.success) setScore(scoreRes.data)
        if (currentNameRef.current === name && historyRes.success) setHistory(historyRes.data)
        if (currentNameRef.current === name && codesRes.success && codesRes.data?.codes)
          setReasonCodes(codesRes.data.codes)
        // agents 是全局的,不需要 guard
        if (agentsRes) setAgents(agentsRes)
        loadProfileData(name)
      } catch (err) {
        if (currentNameRef.current === name) {
          console.error('[Profile] Load error:', err)
        }
      }
    },
    [student.name, loadProfileData],
  )

  useEffect(() => {
    loadAllData()
  }, [loadAllData])

  // P2-9: 订阅 EAA 事件总线, 当本学生被写入新事件 / 撤销事件时, 事件时间线和分数自动更新
  // 只刷新属于当前学生的事件, 避免无关事件造成全量重算
  // P5: 用 useAnonymizedEAAEvents 替代 useEAAEvents, 让 studentName 与隐私引擎脱敏后的化名对齐
  // (匹配比较用 student.name 真名, 但 record.studentName 在隐私模式下是化名, 因此比较时
  //  也用真名 vs 脱敏后的 student.name, 但实际上 student.name 是 props 传进来的真名)
  // 简化方案: 比较时把 student.name 也走一次脱敏, 保持双侧都脱敏或都不脱敏
  const { lastEventAdded, lastEventReverted, lastStudentDeleted } = useAnonymizedEAAEvents()
  useEffect(() => {
    if (!lastEventAdded) return
    if (lastEventAdded.studentName === student.name) {
      loadAllData()
    }
  }, [lastEventAdded, student.name, loadAllData])
  useEffect(() => {
    if (!lastEventReverted) return
    // 撤销事件不携带学生名, 保险起见全量重算 (历史接口已带 name 过滤, 廉价)
    loadAllData()
  }, [lastEventReverted, loadAllData])
  // 当前查看的学生被删除时, 主动关闭详情
  useEffect(() => {
    if (!lastStudentDeleted) return
    if (lastStudentDeleted.studentName === student.name) {
      onClose()
    }
  }, [lastStudentDeleted, student.name, onClose])

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  /**
   * 统一的 agent 运行入口 — 串行执行,但每个 agent 独立 output 桶
   * B-05 修复: onStatusUpdate 内按 agentId 分桶写, 避免多 agent 串行时输出相互污染
   * B-40 修复: 提供 abortAgent, 用户可随时中止任意 agent
   * B-17 修复: runSelectedAgents 和 runAllAgents 共用 prompt 模板
   */
  const runAgents = async (agentIds: string[]) => {
    if (agentIds.length === 0) {
      setAiMessageAuto(t('page.student.ai.noAgent'))
      return
    }
    setAiRunning(true)
    setAiSaved(false)
    // 初始化每个 agent 的 output 桶
    const initial: Record<string, AgentOutput> = {}
    for (const id of agentIds) {
      initial[id] = { agentId: id, status: 'idle', output: '' }
    }
    setAgentOutputs(initial)
    setAgentRunOrder(agentIds)
    setActiveAiTab(agentIds[0] ?? '__overview')

    // 按 agentId 分桶的订阅
    const unsub = getAPI().agent.onStatusUpdate((rawData) => {
      const data = rawData as {
        agentId?: string
        output?: string
        result?: { durationMs?: number }
        error?: string
        status?: AgentRunStatus
      }
      const aid = data.agentId
      if (!aid) return // 没有 agentId 的事件忽略
      setAgentOutputs((prev) => {
        const cur = prev[aid] ?? { agentId: aid, status: 'idle', output: '' }
        const next: AgentOutput = { ...cur }
        if (data.status) next.status = data.status
        if (data.output) next.output += data.output
        if (data.error) {
          next.error = data.error
          next.status = 'error'
        }
        if (data.result) {
          next.durationMs = data.result.durationMs
          if (next.status === 'running') next.status = 'success'
        }
        return { ...prev, [aid]: next }
      })
    })

    try {
      const prompt = t(
        'page.student.ai.prompt',
        student.name,
        String(student.score),
        student.risk,
        String(student.events_count),
      )
      for (const agentId of agentIds) {
        // 标记 running
        setAgentOutputs((prev) => ({
          ...prev,
          [agentId]: { ...prev[agentId], status: 'running', startedAt: Date.now() },
        }))
        try {
          await getAPI().agent.runManual(agentId, prompt)
        } catch (err) {
          // 单个 agent 失败不阻断后续
          setAgentOutputs((prev) => ({
            ...prev,
            [agentId]: {
              ...prev[agentId],
              status: 'error',
              error: err instanceof Error ? err.message : String(err),
            },
          }))
        }
        // 给流式输出一个短暂刷新窗口
        await new Promise((r) => setTimeout(r, 300))
      }
      setAiMessageAuto(t('page.student.ai.analysisSuccess'))
    } finally {
      unsub()
      setAiRunning(false)
    }
  }

  const runSelectedAgents = () => {
    if (selectedAgents.size === 0) {
      setAiMessageAuto(t('page.student.ai.selectHint'))
      return
    }
    return runAgents(Array.from(selectedAgents))
  }

  const runAllAgents = () => {
    const allIds = agents.filter((a) => a.enabled).map((a) => a.id)
    if (allIds.length === 0) {
      setAiMessageAuto(t('page.student.ai.noAgent'))
      return
    }
    setSelectedAgents(new Set(allIds))
    return runAgents(allIds)
  }

  /**
   * 中止指定的 agent — B-40 修复
   * 通过 IPC 调到主进程 agent.abort
   */
  const abortAgent = async (agentId: string) => {
    try {
      const res = await getAPI().agent.abort(agentId)
      setAgentOutputs((prev) => {
        const cur = prev[agentId]
        if (!cur) return prev
        return { ...prev, [agentId]: { ...cur, status: 'aborted' } }
      })
      if (!res.success) {
        toast.error(t('page.student.ai.abort'))
      }
    } catch (err) {
      toast.error(
        `${t('page.student.ai.abort')}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** 拼装 AI 输出 — 按 agent 拼接成 markdown 格式,用于保存到 profile */
  const buildAiSaveText = (): string => {
    const lines: string[] = []
    for (const id of agentRunOrder) {
      const out = agentOutputs[id]
      if (!out) continue
      lines.push(`### ${id}`)
      if (out.error) lines.push(`[ERROR] ${out.error}`)
      if (out.output) lines.push(out.output)
      if (out.durationMs != null) lines.push(`(${out.durationMs}ms)`)
    }
    return lines.join('\n\n')
  }

  const saveAiResult = async () => {
    const text = buildAiSaveText()
    if (!text) {
      toast.error(t('page.student.ai.saveFailedToast'))
      return
    }
    try {
      const result = await getAPI().profile.set(student.name, {
        ...profileData,
        aiAnalysis: text,
        aiAnalyzedAt: Date.now(),
      })
      if (result.success) {
        setAiSaved(true)
        toast.success(t('page.student.ai.savedToast'))
      } else {
        toast.error(result.error ?? t('page.student.ai.saveFailedToast'))
      }
    } catch (_err) {
      toast.error(t('page.student.ai.saveFailedToast'))
    }
  }

  const now = Date.now()
  const filteredEvents = useMemo(() => {
    let events = history?.events ?? []
    if (eventFilter === 'bonus') events = events.filter((e) => e.score_delta > 0)
    if (eventFilter === 'deduct') events = events.filter((e) => e.score_delta < 0)
    if (eventTimeRange !== 'all') {
      // B-03: 用真实日历窗口 (本周一/本月1日/本学期初)
      const now2 = new Date()
      const ranges: Record<string, number> = {
        week:
          now2.getTime() -
          new Date(
            now2.getFullYear(),
            now2.getMonth(),
            now2.getDate() - now2.getDay() + 1,
          ).getTime(),
        month: now2.getTime() - new Date(now2.getFullYear(), now2.getMonth(), 1).getTime(),
        // 学期初：当前日期 8/1 之后用 8/1，否则用 1/1
        semester:
          now2.getTime() -
          (now2.getMonth() >= 7
            ? new Date(now2.getFullYear(), 7, 1).getTime()
            : new Date(now2.getFullYear(), 0, 1).getTime()),
      }
      const cutoff = now - ranges[eventTimeRange]
      events = events.filter((e) => new Date(e.timestamp).getTime() > cutoff)
    }
    return events
  }, [history, eventFilter, eventTimeRange, now])

  const tabs = [
    { id: 'overview' as TabId, label: t('page.student.tab.overview'), icon: '📊' },
    { id: 'profile' as TabId, label: t('page.student.tab.profile'), icon: '📋' },
    { id: 'events' as TabId, label: t('page.student.tab.events'), icon: '📝' },
    { id: 'academics' as TabId, label: t('page.student.tab.academics'), icon: '📚' },
    { id: 'ai' as TabId, label: t('page.student.tab.ai'), icon: '🤖' },
  ]

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-800 dark:to-gray-800/80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl font-bold">
                {/* P1-4: 化名/真名 */}
                {displayName}
              </h2>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                <span className={riskColor(student.risk)}>
                  {t('page.student.riskLabel')}: {student.risk}
                </span>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span>
                  {t('page.student.scoreLabel')}:{' '}
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                    {student.score.toFixed(1)}
                  </span>
                </span>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span>{t('page.student.eventsCount', String(student.events_count))}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl transition-colors"
          >
            &times;
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowAddEvent(!showAddEvent)}
            disabled={student.status !== 'Active'}
            title={student.status !== 'Active' ? `学生状态为"${student.status}"，不可添加事件` : ''}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {showAddEvent ? t('page.student.cancelAdd') : t('page.student.addEventButton')}
          </button>
          <button
            type="button"
            onClick={() => {
              loadAllData()
              onRefresh()
            }}
            className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm"
          >
            {t('page.student.refresh')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ai')}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm"
          >
            🤖 AI 分析
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="px-4 py-2 bg-blue-500/20 text-blue-600 dark:text-blue-300 text-xs">
          {actionMsg}
        </div>
      )}

      {showAddEvent && (
        <AddEventInline
          studentName={student.name}
          studentStatus={score?.status}
          reasonCodes={reasonCodes}
          onDone={() => {
            setShowAddEvent(false)
            loadAllData()
            onRefresh()
            setActionMsgAuto(t('page.student.eventAdded'))
          }}
        />
      )}

      {/* 选项卡导航 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 px-4 bg-gray-50/50 dark:bg-gray-800/50">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={
              'px-4 py-2.5 text-sm border-b-2 transition-colors ' +
              (activeTab === tab.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')
            }
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 选项卡内容 */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' && (
          <OverviewTab student={student} score={score} history={history} isDark={isDark} />
        )}
        {activeTab === 'profile' && (
          <ProfileTab student={student} profileData={profileData} onUpdate={() => loadAllData()} />
        )}
        {activeTab === 'events' && (
          <EventsTab
            events={filteredEvents}
            eventFilter={eventFilter}
            onFilterChange={setEventFilter}
            timeRange={eventTimeRange}
            onTimeRangeChange={setEventTimeRange}
            reasonCodes={reasonCodes}
            studentName={student.name}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            dateStart={dateStart}
            onDateStartChange={setDateStart}
            dateEnd={dateEnd}
            onDateEndChange={setDateEnd}
            onRefresh={() => {
              loadAllData()
              onRefresh()
            }}
          />
        )}
        {activeTab === 'academics' && (
          <AcademicsTab studentName={student.name} profileData={profileData} isDark={isDark} />
        )}
        {activeTab === 'ai' && (
          <AIAnalysisTab
            agents={agents}
            selectedAgents={selectedAgents}
            onToggleAgent={toggleAgent}
            onRunSelected={runSelectedAgents}
            onRunAll={runAllAgents}
            running={aiRunning}
            agentOutputs={agentOutputs}
            agentRunOrder={agentRunOrder}
            activeAiTab={activeAiTab}
            onSelectAgent={setActiveAiTab}
            onAbortAgent={abortAgent}
            message={aiMessage}
            aiSaved={aiSaved}
            onSaveResult={saveAiResult}
          />
        )}
      </div>
    </div>
  )
}

// =============================================================
// 概览选项卡 — 迷你趋势图 + 事件时间线
// =============================================================

function OverviewTab({
  student,
  score,
  history,
  isDark,
}: {
  student: EAAStudent
  score: EAAStudentScore | null
  history: EAAHistoryData | null
  isDark: boolean
}) {
  const { t } = useT()
  const recentEvents = history?.events?.slice(0, 5) ?? []
  const bonusCount = history?.events?.filter((e) => e.score_delta > 0).length ?? 0
  const deductCount = history?.events?.filter((e) => e.score_delta < 0).length ?? 0

  const scoreTimeline = useMemo(() => {
    if (!history?.events || history.events.length === 0)
      return { dates: [] as string[], scores: [] as number[] }
    let cumulative = student.score - (student.delta || 0) // 反推初始基准分
    const dates: string[] = []
    const scores: number[] = []
    const events = history.events.slice(-20)
    for (const evt of events) {
      cumulative += evt.score_delta
      dates.push(new Date(evt.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }))
      scores.push(cumulative)
    }
    return { dates, scores }
  }, [history, student.score, student.delta])

  const axisColor = isDark ? '#9ca3af' : '#6b7280'
  const gridColor = isDark ? '#1f2937' : '#e5e7eb'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label={t('page.student.overview.currentScore')}
          value={student.score.toFixed(1)}
          color="blue"
        />
        <MetricCard
          label={t('page.student.overview.scoreChange')}
          value={(student.delta >= 0 ? '+' : '') + student.delta.toFixed(1)}
          color={student.delta >= 0 ? 'green' : 'red'}
        />
        <MetricCard
          label={t('page.student.overview.bonusEvents')}
          value={bonusCount}
          color="green"
        />
        <MetricCard
          label={t('page.student.overview.deductEvents')}
          value={deductCount}
          color="red"
        />
      </div>

      {scoreTimeline.dates.length > 1 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            {t('page.student.overview.scoreTrend')}
          </h4>
          <ReactEChartsCore
            echarts={echarts}
            style={{ height: 200 }}
            option={{
              animation: true,
              animationDuration: 800,
              grid: { left: 8, right: 16, top: 8, bottom: 0, containLabel: true },
              tooltip: { trigger: 'axis' },
              xAxis: {
                type: 'category',
                data: scoreTimeline.dates,
                axisLabel: { color: axisColor, fontSize: 10 },
                axisLine: { lineStyle: { color: gridColor } },
              },
              yAxis: {
                type: 'value',
                axisLabel: { color: axisColor },
                splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
              },
              series: [
                {
                  type: 'line',
                  data: scoreTimeline.scores,
                  smooth: true,
                  lineStyle: { color: '#3b82f6', width: 2 },
                  itemStyle: { color: '#3b82f6' },
                  areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                      { offset: 0, color: 'rgba(59,130,246,0.3)' },
                      { offset: 1, color: 'rgba(59,130,246,0.02)' },
                    ]),
                  },
                  symbol: 'circle',
                  symbolSize: 4,
                },
              ],
            }}
          />
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t('page.student.info.basicInfo')}
        </h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow label={t('page.student.info.status')} value={score?.status ?? 'Active'} />
          <InfoRow
            label={t('page.student.riskLabel')}
            value={student.risk}
            highlight={riskColor(student.risk)}
          />
          <InfoRow
            label={t('page.student.info.className')}
            value={score?.class_id ?? t('page.student.academics.unset')}
          />
          <InfoRow
            label={t('page.student.info.groups')}
            value={student.groups.join(', ') || t('common.none')}
          />
          <InfoRow
            label={t('page.student.info.roles')}
            value={student.roles.join(', ') || t('common.none')}
          />
          <InfoRow label={t('page.student.info.eventsCount')} value={student.events_count} />
          {score?.last_event_at && (
            <InfoRow
              label={t('page.student.info.recentEvents')}
              value={new Date(score.last_event_at).toLocaleDateString()}
            />
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t('page.student.info.recentEvents')}
        </h4>
        {recentEvents.length === 0 ? (
          <div className="text-gray-400 dark:text-gray-500 text-sm py-4 text-center">
            {t('common.noEvents')}
          </div>
        ) : (
          <div className="space-y-0">
            {recentEvents.map((evt, idx) => (
              <div key={evt.event_id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={
                      'w-2.5 h-2.5 rounded-full mt-1.5 ' +
                      (evt.score_delta > 0
                        ? 'bg-green-400'
                        : evt.score_delta < 0
                          ? 'bg-red-400'
                          : 'bg-gray-300')
                    }
                  />
                  {idx < recentEvents.length - 1 && (
                    <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700 my-0.5" />
                  )}
                </div>
                <div className="flex-1 pb-3">
                  <EventMiniCard event={evt} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================
// 档案选项卡
// =============================================================

function ProfileTab({
  student,
  profileData,
  onUpdate,
}: {
  student: EAAStudent
  profileData: StudentProfileData
  onUpdate: () => void
}) {
  const { t } = useT()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<StudentProfileData>(profileData)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const setMsgAuto = useAutoDismiss<string>(setMsg, '')

  // P1-4: 隐私脱敏 — 在 ProfileTab 内独立获取显示名
  const { enabled: privacyEnabled, anonymize, anonymizeBatch } = usePrivacyFilter()
  const [displayName, setDisplayName] = useState<string>(student.name)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!privacyEnabled) {
        if (!cancelled) setDisplayName(student.name)
        return
      }
      const mapped = await anonymize(student.name)
      if (!cancelled) setDisplayName(mapped)
    })()
    return () => {
      cancelled = true
    }
  }, [student.name, privacyEnabled, anonymize])

  // P0-2: 8 个 PII 字段批量脱敏（idCard/phone/email/address/fatherName/fatherPhone/motherName/motherPhone）
  // 仅在非编辑模式下脱敏（编辑时用户应看到真名以修改）
  // 用 useMemo 稳定引用，避免 eslint exhaustive-deps 警告
  const PII_FIELDS = useMemo(
    () =>
      [
        'idCard',
        'phone',
        'email',
        'address',
        'fatherName',
        'fatherPhone',
        'motherName',
        'motherPhone',
      ] as const,
    [],
  )
  const [displayPII, setDisplayPII] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    if (editing || !privacyEnabled) {
      // 编辑模式 / 未启用 → 不脱敏（直接显示真名）
      const next: Record<string, string> = {}
      for (const k of PII_FIELDS) {
        const v = form[k]
        next[k] = typeof v === 'string' ? v : ''
      }
      if (!cancelled) setDisplayPII(next)
      return
    }
    ;(async () => {
      const values = PII_FIELDS.map((k) => {
        const v = form[k]
        return typeof v === 'string' && v.length > 0 ? v : ' '
      })
      const map = await anonymizeBatch(values)
      if (cancelled) return
      const next: Record<string, string> = {}
      for (const k of PII_FIELDS) {
        const v = form[k]
        const key = typeof v === 'string' && v.length > 0 ? v : ' '
        next[k] = map[key] ?? (typeof v === 'string' ? v : '')
      }
      if (!cancelled) setDisplayPII(next)
    })()
    return () => {
      cancelled = true
    }
  }, [form, privacyEnabled, editing, anonymizeBatch, PII_FIELDS])

  // B-32: 加载时若 profileData 没有 classId, 从 EAA score 拉回
  useEffect(() => {
    const next = { ...profileData }
    if (!next.classId && student.class_id) {
      next.classId = student.class_id
    }
    setForm(next)
  }, [profileData, student.class_id])

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await getAPI().profile.set(student.name, form)
      if (!result.success) {
        setMsgAuto(`${t('status.failed')}: ${result.error ?? t('error.unknown')}`)
        return
      }
      if (form.classId) {
        await getAPI().eaa.setStudentMeta({ name: student.name, classId: form.classId as string })
      }
      setMsgAuto(t('page.student.profile.saved'))
      setSaving(false)
      setEditing(false)
      onUpdate()
    } catch (err) {
      setMsgAuto(`${t('status.failed')}: ${err instanceof Error ? err.message : String(err)}`)
      setSaving(false)
    }
  }

  const updateForm = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('page.student.tab.profile')}
        </h4>
        <button
          type="button"
          onClick={() => (editing ? handleSave() : setEditing(true))}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
        >
          {saving
            ? t('page.student.saving')
            : editing
              ? t('page.student.save')
              : t('page.student.edit')}
        </button>
      </div>
      {msg && (
        <div
          className={`text-xs ${msg.includes('失败') || msg.includes('failed') ? 'text-red-500' : 'text-green-500'}`}
        >
          {msg}
        </div>
      )}

      {/* 基础信息 */}
      <ProfileSection title={t('page.student.profile.basic')} icon="👤">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField label={t('page.students.col.name')} value={displayName} editing={false} />
          <ProfileField
            label={t('page.student.profile.gender')}
            value={form.gender ?? ''}
            editing={editing}
            type="select"
            options={['男', '女']}
            onChange={(v) => updateForm('gender', v)}
          />
          <ProfileField
            label={t('page.student.profile.birthDate')}
            value={form.birthDate ?? ''}
            editing={editing}
            type="date"
            onChange={(v) => updateForm('birthDate', v)}
          />
          <ProfileField
            label={t('page.student.profile.idCard')}
            value={displayPII.idCard ?? form.idCard ?? ''}
            editing={editing}
            onChange={(v) => updateForm('idCard', v)}
          />
          <ProfileField
            label={t('page.student.profile.classId')}
            value={(form.classId as string) ?? student.class_id ?? ''}
            editing={editing}
            onChange={(v) => updateForm('classId', v)}
          />
          <ProfileField
            label={t('page.student.profile.enrollmentDate')}
            value={form.enrollmentDate ?? ''}
            editing={editing}
            type="date"
            onChange={(v) => updateForm('enrollmentDate', v)}
          />
        </div>
      </ProfileSection>

      {/* 联系方式 */}
      <ProfileSection title={t('page.student.profile.contact')} icon="📞">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label={t('page.student.profile.phone')}
            value={displayPII.phone ?? form.phone ?? ''}
            editing={editing}
            onChange={(v) => updateForm('phone', v)}
          />
          <ProfileField
            label={t('page.student.profile.email')}
            value={displayPII.email ?? (form.email as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('email', v)}
          />
          <ProfileField
            label={t('page.student.profile.address')}
            value={displayPII.address ?? form.address ?? ''}
            editing={editing}
            onChange={(v) => updateForm('address', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 家庭信息 */}
      <ProfileSection title={t('page.student.profile.family')} icon="🏠">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label={t('page.student.profile.fatherName')}
            value={displayPII.fatherName ?? (form.fatherName as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('fatherName', v)}
          />
          <ProfileField
            label={t('page.student.profile.fatherPhone')}
            value={displayPII.fatherPhone ?? (form.fatherPhone as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('fatherPhone', v)}
          />
          <ProfileField
            label={t('page.student.profile.motherName')}
            value={displayPII.motherName ?? (form.motherName as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('motherName', v)}
          />
          <ProfileField
            label={t('page.student.profile.motherPhone')}
            value={displayPII.motherPhone ?? (form.motherPhone as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('motherPhone', v)}
          />
        </div>
      </ProfileSection>

      {/* 健康信息 */}
      <ProfileSection title={t('page.student.profile.health')} icon="🏥">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label={t('page.student.profile.bloodType')}
            value={(form.bloodType as string) ?? ''}
            editing={editing}
            type="select"
            options={['A', 'B', 'AB', 'O']}
            onChange={(v) => updateForm('bloodType', v)}
          />
          <ProfileField
            label={t('page.student.profile.allergy')}
            value={(form.allergy as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('allergy', v)}
          />
          <ProfileField
            label={t('page.student.profile.specialNeeds')}
            value={(form.specialNeeds as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('specialNeeds', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 在校信息 */}
      <ProfileSection title={t('page.student.profile.school')} icon="🏫">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label={t('page.student.profile.studentNumber')}
            value={(form.studentNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('studentNumber', v)}
          />
          <ProfileField
            label={t('page.student.profile.dormNumber')}
            value={(form.dormNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('dormNumber', v)}
          />
          <ProfileField
            label={t('page.student.profile.bedNumber')}
            value={(form.bedNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('bedNumber', v)}
          />
          <ProfileField
            label={t('page.student.profile.attendanceRate')}
            value={form.attendanceRate?.toString() ?? ''}
            editing={editing}
            type="number"
            onChange={(v) => updateForm('attendanceRate', v)}
          />
        </div>
      </ProfileSection>

      {/* 奖惩记录 */}
      <ProfileSection title={t('page.student.profile.awards')} icon="🏆">
        <div className="grid grid-cols-1 gap-3">
          <ProfileField
            label={t('page.student.profile.honors')}
            value={(form.honors as string) ?? ''}
            editing={editing}
            multiline
            onChange={(v) => updateForm('honors', v)}
            spanFull
          />
          <ProfileField
            label={t('page.student.profile.punishments')}
            value={(form.punishments as string) ?? ''}
            editing={editing}
            multiline
            onChange={(v) => updateForm('punishments', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 备注 */}
      <ProfileSection title={t('page.student.profile.comments')} icon="📝">
        <ProfileField
          label=""
          value={form.comments ?? ''}
          editing={editing}
          multiline
          onChange={(v) => updateForm('comments', v)}
          spanFull
        />
      </ProfileSection>

      {/* EAA 元数据 */}
      <ProfileSection title={t('page.student.profile.eaaMeta')} icon="⚙️">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow
            label={t('page.student.info.groups')}
            value={student.groups.join(', ') || t('common.none')}
          />
          <InfoRow
            label={t('page.student.info.roles')}
            value={student.roles.join(', ') || t('common.none')}
          />
          <InfoRow label={t('page.student.info.status')} value={student.status} />
        </div>
      </ProfileSection>
    </div>
  )
}

// =============================================================
// 事件选项卡 — 搜索 / 日期范围 / 撤销
// =============================================================

function EventsTab({
  events,
  eventFilter,
  onFilterChange,
  timeRange,
  onTimeRangeChange,
  reasonCodes,
  studentName,
  searchQuery,
  onSearchQueryChange,
  dateStart,
  onDateStartChange,
  dateEnd,
  onDateEndChange,
  onRefresh,
}: {
  events: EAAHistoryEvent[]
  eventFilter: 'all' | 'bonus' | 'deduct'
  onFilterChange: (f: 'all' | 'bonus' | 'deduct') => void
  timeRange: 'all' | 'week' | 'month' | 'semester'
  onTimeRangeChange: (t: 'all' | 'week' | 'month' | 'semester') => void
  reasonCodes: EAAReasonCode[]
  studentName: string
  searchQuery: string
  onSearchQueryChange: (q: string) => void
  dateStart: string
  onDateStartChange: (d: string) => void
  dateEnd: string
  onDateEndChange: (d: string) => void
  onRefresh: () => void
}) {
  const { t } = useT()
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  // 搜索/范围结果（替换 history 事件）
  const [searchEvents, setSearchEvents] = useState<EAAHistoryEvent[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  // 实际展示的事件列表：有搜索/范围结果时用结果，否则用 props.events
  const displayEvents = searchEvents ?? events

  // B-13: 搜索/日期结果保留, 但叠加 eventFilter/eventTimeRange 在显示层
  const filteredDisplayEvents = useMemo(() => {
    let result = displayEvents
    if (eventFilter === 'bonus') result = result.filter((e) => e.score_delta > 0)
    if (eventFilter === 'deduct') result = result.filter((e) => e.score_delta < 0)
    if (timeRange !== 'all') {
      const ranges: Record<string, number> = {
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        semester: 120 * 24 * 60 * 60 * 1000,
      }
      const cutoff = Date.now() - ranges[timeRange]
      result = result.filter((e) => new Date(e.timestamp).getTime() > cutoff)
    }
    return result
  }, [displayEvents, eventFilter, timeRange])

  // 搜索防抖
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // B-29: 组件卸载时清理 timer
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  // 用 ref 持有 performSearch 引用，避免回调依赖变化时频繁重建
  const performSearchRef = useRef<((q: string, s: string, e: string) => Promise<void>) | null>(null)

  const handleSearchChange = useCallback(
    (value: string) => {
      onSearchQueryChange(value)
      // B-42: 清空搜索词时, 仅清搜索结果; 日期范围仍生效
      if (!value.trim() && !dateStart && !dateEnd) {
        setSearchEvents(null)
        return
      }
      // 防抖 300ms
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      searchTimerRef.current = setTimeout(() => {
        performSearchRef.current?.(value, dateStart, dateEnd)
      }, 300)
    },
    [dateStart, dateEnd, onSearchQueryChange],
  )

  const handleDateChange = useCallback(
    (start: string, end: string) => {
      onDateStartChange(start)
      onDateEndChange(end)
      // B-42: 短路线修复 — 清空日期时, 只要 search 词/日期 任一非空就保持现状
      if (!start && !end && !searchQuery.trim()) {
        setSearchEvents(null)
        return
      }
      // 防抖 300ms
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
      searchTimerRef.current = setTimeout(() => {
        performSearchRef.current?.(searchQuery, start, end)
      }, 300)
    },
    [searchQuery, onDateStartChange, onDateEndChange],
  )

  const performSearch = async (query: string, start: string, end: string) => {
    setSearchLoading(true)
    try {
      // 优先级：日期范围 > 关键词搜索
      const effectiveStart = start || ''
      const effectiveEnd = end || (start ? new Date().toISOString().split('T')[0] : '')
      if (effectiveStart && effectiveEnd) {
        const result = await getAPI().eaa.range(start, end, 100)
        if (result.success && result.data?.events) {
          // 按当前学生过滤范围查询结果
          const filtered = result.data.events.filter(
            (e) => e.name === studentName || e.entity_id === studentName,
          )
          setSearchEvents(filtered.map(eventRecordToHistory))
        } else {
          setSearchEvents([])
        }
      } else if (query.trim()) {
        // B-14 修复: 不再强拼学生名到搜索词, 由 range filter 或 search 自身处理
        const result = await getAPI().eaa.search(query, 100)
        if (result.success && result.data?.events) {
          setSearchEvents(result.data.events.map(eventRecordToHistory))
        } else {
          setSearchEvents([])
        }
      } else {
        setSearchEvents(null)
      }
    } catch (err) {
      console.warn('[EventsTab] search/range error:', err)
      toast.error(t('page.student.events.searchFailed'))
      setSearchEvents([])
    }
    setSearchLoading(false)
  }

  // 同步 performSearch 引用到 ref（用于在 useCallback 中调用）
  performSearchRef.current = performSearch

  const handleRevert = async (eventId: string) => {
    if (!confirm(t('page.student.events.confirmRevert'))) return
    try {
      // B-16: i18n 撤销理由
      const result = await getAPI().eaa.revertEvent(
        eventId,
        t('page.student.events.revertReason', studentName),
      )
      if (result.success) {
        toast.success(t('page.student.events.reverted'))
        onRefresh()
      } else {
        toast.error(getErrorMessage(result, '撤销失败'))
      }
    } catch (err) {
      console.warn('[EventsTab] revert error:', err)
      toast.error(t('page.student.events.revertFailed'))
    }
  }

  const filterBtn = (val: string, label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      key={val}
      onClick={onClick}
      className={
        'px-3 py-1 rounded-lg text-xs transition-colors ' +
        (active
          ? 'bg-blue-600 text-white shadow-sm'
          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600')
      }
    >
      {label}
    </button>
  )

  // 搜索/范围模式指示
  const isSearchMode = searchEvents !== null

  return (
    <div className="space-y-3">
      {/* 搜索框 + 日期范围选择器 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="搜索事件..."
          className="flex-1 min-w-[140px] bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
        <input
          type="date"
          value={dateStart}
          onChange={(e) => handleDateChange(e.target.value, dateEnd)}
          className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 text-gray-700 dark:text-gray-300"
        />
        <span className="text-xs text-gray-400 dark:text-gray-500">至</span>
        <input
          type="date"
          value={dateEnd}
          onChange={(e) => handleDateChange(dateStart, e.target.value)}
          className="bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 text-gray-700 dark:text-gray-300"
        />
        {isSearchMode && (
          <button
            type="button"
            onClick={() => {
              onSearchQueryChange('')
              onDateStartChange('')
              onDateEndChange('')
              setSearchEvents(null)
            }}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            title="清除搜索/筛选"
          >
            ✕ 重置
          </button>
        )}
        {searchLoading && <span className="text-xs text-blue-500 animate-pulse">查询中...</span>}
      </div>

      {/* 类型 + 时间筛选栏 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">类型:</span>
        {filterBtn('all', '全部', eventFilter === 'all', () => onFilterChange('all'))}
        {filterBtn('bonus', '加分', eventFilter === 'bonus', () => onFilterChange('bonus'))}
        {filterBtn('deduct', '扣分', eventFilter === 'deduct', () => onFilterChange('deduct'))}
        <span className="text-xs text-gray-300 dark:text-gray-600 mx-1">|</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">时间:</span>
        {filterBtn('all', '全部', timeRange === 'all', () => onTimeRangeChange('all'))}
        {filterBtn('week', '本周', timeRange === 'week', () => onTimeRangeChange('week'))}
        {filterBtn('month', '本月', timeRange === 'month', () => onTimeRangeChange('month'))}
        {filterBtn('semester', '本学期', timeRange === 'semester', () =>
          onTimeRangeChange('semester'),
        )}
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
          {isSearchMode
            ? `搜索结果 ${filteredDisplayEvents.length} 条`
            : `共 ${filteredDisplayEvents.length} 条`}
        </span>
      </div>

      {filteredDisplayEvents.length === 0 ? (
        <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-12">
          {searchLoading ? '查询中...' : isSearchMode ? '未找到匹配的事件' : '暂无事件记录'}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredDisplayEvents.map((evt) => (
            <EventCard
              key={evt.event_id}
              event={evt}
              expanded={expandedEvent === evt.event_id}
              onToggle={() =>
                setExpandedEvent(expandedEvent === evt.event_id ? null : evt.event_id)
              }
              reasonLabel={reasonCodes.find((c) => c.code === evt.reason_code)?.label}
              onRevert={!evt.reverted ? () => handleRevert(evt.event_id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// =============================================================
// 学业选项卡 — 多次考试成绩、趋势图、排名、偏科分析
// =============================================================

function AcademicsTab({
  studentName,
  profileData,
  isDark,
}: {
  studentName: string
  profileData: StudentProfileData
  isDark: boolean
}) {
  const { t } = useT()
  // 从 academicRecords 加载，或从旧格式迁移
  const [records, setRecords] = useState<AcademicExamRecord[]>(
    () => profileData.academicRecords ?? migrateLegacyRecords(profileData),
  )
  // B-33 修复: 科目列表持久化到 profileData.customSubjects, 关闭再打开不丢失
  // 优先从 profileData 读取, 否则使用默认
  const [allSubjects, setAllSubjects] = useState<string[]>(
    () =>
      (profileData as unknown as { customSubjects?: string[] }).customSubjects ?? [
        '语文',
        '数学',
        '英语',
        '物理',
        '化学',
        '生物',
        '政治',
        '历史',
        '地理',
        '通用技术',
        '信息技术',
        '体育',
        '音乐',
        '美术',
      ],
  )
  const [newSubject, setNewSubject] = useState('')

  const [classRank, setClassRank] = useState<number | undefined>(
    profileData.classRank as number | undefined,
  )
  const [gradeRank, setGradeRank] = useState<number | undefined>(
    profileData.gradeRank as number | undefined,
  )

  const [editing, setEditing] = useState(false)
  const [editingRank, setEditingRank] = useState(false)
  const [saving, setSaving] = useState(false)
  const [validationMsg, setValidationMsg] = useState('')
  const [addingExam, setAddingExam] = useState(false)
  const [showBulkImport, setShowBulkImport] = useState(false)
  const [_entryMode, _setEntryMode] = useState<'vertical' | 'horizontal'>('vertical')
  const [newExamType, setNewExamType] = useState('月考')
  const [newExamName, setNewExamName] = useState('')
  const [newExamDate, setNewExamDate] = useState('')

  // 从旧格式迁移
  function migrateLegacyRecords(data: StudentProfileData): AcademicExamRecord[] {
    const result: AcademicExamRecord[] = []
    // 检查是否有 deprecated 旧字段
    const midterm = (data as unknown as Record<string, unknown>).midtermGrades as
      | Record<string, number | null>
      | undefined
    const final = (data as unknown as Record<string, unknown>).finalGrades as
      | Record<string, number | null>
      | undefined
    const monthly1 = (data as unknown as Record<string, unknown>).monthlyExam1Grades as
      | Record<string, number | null>
      | undefined
    const monthly2 = (data as unknown as Record<string, unknown>).monthlyExam2Grades as
      | Record<string, number | null>
      | undefined

    if (midterm && Object.keys(midterm).length > 0)
      result.push({ examType: '期中', examName: '期中', subjects: { ...midterm } })
    if (final && Object.keys(final).length > 0)
      result.push({ examType: '期末', examName: '期末', subjects: { ...final } })
    if (monthly1 && Object.keys(monthly1).length > 0)
      result.push({ examType: '月考', examName: '月考1', subjects: { ...monthly1 } })
    if (monthly2 && Object.keys(monthly2).length > 0)
      result.push({ examType: '月考', examName: '月考2', subjects: { ...monthly2 } })

    return result
  }

  const calcAvg = (grades: Record<string, number | null>) => {
    const vals = Object.values(grades).filter((v): v is number => v != null && !Number.isNaN(v))
    return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length
  }

  // 偏科分析：使用活跃科目（有数据的）
  const subjectAnalysis = useMemo(() => {
    const allGrades: Record<string, number[]> = {}
    const activeSubjects = new Set<string>()
    for (const rec of records) {
      for (const [sub, score] of Object.entries(rec.subjects)) {
        if (score != null && !Number.isNaN(score)) {
          activeSubjects.add(sub)
          if (!allGrades[sub]) allGrades[sub] = []
          allGrades[sub].push(score)
        }
      }
    }
    const avgs = Array.from(activeSubjects).map((sub) => ({
      subject: sub,
      avg: allGrades[sub].reduce((a, b) => a + b, 0) / allGrades[sub].length,
    }))
    avgs.sort((a, b) => b.avg - a.avg)
    return {
      strongest: avgs[0] ?? null,
      weakest: avgs[avgs.length - 1] ?? null,
      all: avgs,
    }
  }, [records])

  // 趋势数据
  const trendData = useMemo(() => {
    if (records.length === 0) return null
    const sorted = [...records].sort((a, b) => {
      if (a.date && b.date) return a.date.localeCompare(b.date)
      if (a.date) return -1
      if (b.date) return 1
      return a.examName.localeCompare(b.examName, undefined, { numeric: true })
    })
    const labels = sorted.map((r) => r.examName)
    const activeSubjects = new Set<string>()
    for (const rec of records) {
      for (const sub of Object.keys(rec.subjects)) activeSubjects.add(sub)
    }
    return {
      labels,
      series: Array.from(activeSubjects)
        .map((sub) => ({
          name: sub,
          data: sorted.map((r) => r.subjects[sub] ?? null),
        }))
        .filter((s) => s.data.some((v) => v != null)),
    }
  }, [records])

  const gridColor = isDark ? '#1f2937' : '#e5e7eb'
  const axisColor = isDark ? '#9ca3af' : '#6b7280'
  const colors = [
    '#3b82f6',
    '#ef4444',
    '#22c55e',
    '#a855f7',
    '#f97316',
    '#06b6d4',
    '#ec4899',
    '#14b8a6',
  ]

  // 添加科目
  const addSubject = () => {
    const trimmed = newSubject.trim()
    if (trimmed && !allSubjects.includes(trimmed)) {
      setAllSubjects([...allSubjects, trimmed])
      setNewSubject('')
    }
  }
  const removeSubject = (sub: string) => {
    const count = records.filter((r) => r.subjects[sub] != null && r.subjects[sub] > 0).length
    if (!confirm(`将删除"${sub}"科目，同时从 ${count} 条考试记录中移除该科目成绩。确定继续？`))
      return
    setAllSubjects(allSubjects.filter((s) => s !== sub))
    setRecords(
      records.map((r) => {
        const newSubjects = { ...r.subjects }
        delete newSubjects[sub]
        return { ...r, subjects: newSubjects }
      }),
    )
  }

  // 添加考试
  // B-35 鲁棒化: 同时识别 "<type><N>" 和 "<type> <N>" 等命名, 且检查重名
  const addExam = () => {
    const sameType = records.filter((r) => r.examType === newExamType)
    const escapedType = newExamType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const indexPattern = new RegExp(`^${escapedType}\\s*[（(]?\\s*(\\d+)\\s*[)）]?$`)
    const existingIndexes = sameType.map((r) => {
      const match = r.examName.match(indexPattern)
      return match ? parseInt(match[1], 10) : 0
    })
    const nextIndex = existingIndexes.length > 0 ? Math.max(...existingIndexes) + 1 : 1
    const generatedName = `${newExamType}${nextIndex}`
    const name = newExamName.trim() || generatedName
    // 检查重名 (含 user 提供的)
    if (records.some((r) => r.examName === name && r.examType === newExamType)) {
      toast.error(t('page.student.academics.examExists', name))
      return
    }
    const newRec: AcademicExamRecord = {
      examType: newExamType,
      examName: name,
      subjects: {},
      date: newExamDate || undefined,
    }
    setRecords([...records, newRec])
    setNewExamName('')
    setNewExamDate('')
    setAddingExam(false)
  }

  // 删除考试
  const removeExam = (idx: number) => {
    const rec = records[idx]
    if (
      !confirm(
        `将删除考试"${rec.examName}"（${rec.examType}），共 ${Object.keys(rec.subjects).length} 个科目成绩。确定继续？`,
      )
    )
      return
    setRecords(records.filter((_, i) => i !== idx))
  }

  // 更新某考试某科目分数
  // B-34 修复: 清空时不再 delete 整个键, 而是设为 null 占位, 保持表格列对齐
  // 后端 validateAcademicRecords 已支持 null (空成绩)
  const updateScore = (idx: number, subject: string, value: string) => {
    const newRecords = [...records]
    const newSubjects = { ...newRecords[idx].subjects }
    if (value === '') {
      newSubjects[subject] = null
    } else {
      const parsed = parseFloat(value)
      newSubjects[subject] = Number.isNaN(parsed) ? null : parsed
    }
    newRecords[idx] = { ...newRecords[idx], subjects: newSubjects }
    setRecords(newRecords)
  }

  const handleSave = async () => {
    // 前端校验
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]
      if (!rec.examType || !rec.examName) {
        setValidationMsg(t('page.student.academics.validation.missingExamInfo', String(i + 1)))
        return
      }
      for (const [sub, score] of Object.entries(rec.subjects)) {
        if (typeof score !== 'number' || Number.isNaN(score) || score < 0 || score > 300) {
          setValidationMsg(t('page.student.academics.validation.invalidScore', rec.examName, sub))
          return
        }
      }
    }
    setValidationMsg('')
    setSaving(true)
    try {
      // 保存时 profile.set 内部会自动校验，无需前端重复校验
      // B-33 修复: 同时保存 customSubjects, 让用户自定义科目持久化
      await getAPI().profile.set(studentName, {
        ...profileData,
        academicRecords: records,
        classRank,
        gradeRank,
        customSubjects: allSubjects,
      })
      toast.success(t('page.student.academics.saved'))
      setSaving(false)
      setEditing(false)
      setEditingRank(false)
    } catch (err) {
      toast.error(
        `${t('page.student.academics.saveFailed')}: ${err instanceof Error ? err.message : String(err)}`,
      )
      setSaving(false)
    }
  }

  const handleSaveRank = async () => {
    setSaving(true)
    try {
      // 仅保存排名，不涉及学业记录校验
      await getAPI().profile.set(studentName, {
        ...profileData,
        classRank,
        gradeRank,
      })
      toast.success(t('page.student.academics.rankSaved'))
      setSaving(false)
      setEditingRank(false)
    } catch (err) {
      toast.error(
        `${t('page.student.academics.rankSaveFailed')}: ${err instanceof Error ? err.message : String(err)}`,
      )
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('page.student.academics.title')}
        </h4>
        <div className="flex gap-2">
          {validationMsg && (
            <span className="text-xs text-red-500 self-center">{validationMsg}</span>
          )}
          {editing ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
              >
                {saving ? '保存中...' : '💾 保存'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1 rounded-lg text-xs transition-colors"
              >
                ✕ 取消
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs transition-colors shadow-sm"
            >
              ✏️ 编辑
            </button>
          )}
        </div>
      </div>

      {editing && (
        <>
          {/* 科目管理 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              📚 科目管理
            </h5>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {allSubjects.map((sub) => (
                <span
                  key={sub}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded text-xs"
                >
                  {sub}
                  <button
                    type="button"
                    onClick={() => removeSubject(sub)}
                    className="text-blue-400 hover:text-red-500"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addSubject()
                }}
                placeholder={t('page.student.academics.addSubject')}
                className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={addSubject}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs"
              >
                +
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              支持 3+3 / 3+1+2 模式，可任意添加/删除科目
            </p>
          </div>

          {/* 添加考试 + 模板 + 批量录入 */}
          <div className="flex items-center gap-2 flex-wrap">
            {!addingExam ? (
              <>
                <button
                  type="button"
                  onClick={() => setAddingExam(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-lg text-xs"
                >
                  {t('page.student.academics.addExam')}
                </button>
                <ExamTemplateMenu
                  onApply={(type, name) => {
                    const newRec: AcademicExamRecord = {
                      examType: type,
                      examName: name,
                      subjects: {},
                      date: undefined,
                    }
                    setRecords([...records, newRec])
                    toast.success(t('page.student.academics.template.apply'))
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowBulkImport(true)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded-lg text-xs"
                  title={t('page.student.academics.bulkImport.hint')}
                >
                  {t('page.student.academics.bulkImport')}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm w-full">
                <select
                  value={newExamType}
                  onChange={(e) => setNewExamType(e.target.value)}
                  className="bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1 text-xs"
                >
                  {['月考', '周考', '期中', '期末', '模拟考', '平时测试', '随堂测验'].map(
                    (type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ),
                  )}
                </select>
                <input
                  type="text"
                  value={newExamName}
                  onChange={(e) => setNewExamName(e.target.value)}
                  placeholder={t('page.student.academics.examNamePlaceholder')}
                  className="flex-1 bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1 text-xs"
                />
                <input
                  type="date"
                  value={newExamDate}
                  onChange={(e) => setNewExamDate(e.target.value)}
                  className="bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={addExam}
                  className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs"
                >
                  {t('page.student.academics.confirmAdd')}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingExam(false)}
                  className="text-gray-400 text-xs px-2"
                >
                  {t('page.student.academics.cancelAdd')}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 批量录入弹窗 */}
      {showBulkImport && (
        <BulkImportModal
          knownSubjects={allSubjects}
          onApply={(newRecords) => {
            // 合并: 按 (examName + examType + date) 去重, 重复则覆盖
            const merged = [...records]
            for (const nr of newRecords) {
              const idx = merged.findIndex(
                (r) =>
                  r.examName === nr.examName && r.examType === nr.examType && r.date === nr.date,
              )
              if (idx >= 0) merged[idx] = nr
              else merged.push(nr)
            }
            setRecords(merged)
            toast.success(t('page.student.academics.bulkImport.apply'))
          }}
          onClose={() => setShowBulkImport(false)}
        />
      )}

      {/* 成绩表格 */}
      {records.length === 0 ? (
        <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-10">
          {t('page.student.academics.scoreEmpty')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700 sticky left-0 bg-gray-50 dark:bg-gray-800/50">
                  {t('page.student.academics.exam')}
                </th>
                <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700">
                  {t('page.student.academics.examType')}
                </th>
                {allSubjects.map((sub) => (
                  <th
                    key={sub}
                    className="text-center px-2 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700 min-w-[60px]"
                  >
                    {sub}
                  </th>
                ))}
                <th className="text-center px-2 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700">
                  平均
                </th>
                {editing && (
                  <th className="text-center px-2 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700 w-10"></th>
                )}
              </tr>
            </thead>
            <tbody>
              {records.map((rec, idx) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: records have no stable unique ID, examName may not be unique
                <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30">
                  <td className="px-3 py-2 font-medium border-b dark:border-gray-700 sticky left-0 bg-white dark:bg-gray-900">
                    {editing ? (
                      <div className="flex flex-col gap-1">
                        <input
                          type="text"
                          value={rec.examName}
                          onChange={(e) => {
                            const newRecords = [...records]
                            newRecords[idx] = { ...newRecords[idx], examName: e.target.value }
                            setRecords(newRecords)
                          }}
                          className="w-24 bg-gray-50 dark:bg-gray-900 border rounded px-1 py-0.5 text-xs"
                        />
                        <input
                          type="date"
                          value={rec.date || ''}
                          onChange={(e) => {
                            const newRecords = [...records]
                            newRecords[idx] = {
                              ...newRecords[idx],
                              date: e.target.value || undefined,
                            }
                            setRecords(newRecords)
                          }}
                          className="w-24 bg-gray-50 dark:bg-gray-900 border rounded px-1 py-0.5 text-[10px]"
                        />
                        <input
                          type="text"
                          value={rec.examType}
                          onChange={(e) => {
                            const newRecords = [...records]
                            newRecords[idx] = { ...newRecords[idx], examType: e.target.value }
                            setRecords(newRecords)
                          }}
                          className="w-24 bg-gray-50 dark:bg-gray-900 border rounded px-1 py-0.5 text-[10px]"
                        />
                      </div>
                    ) : (
                      <div>
                        <div className="text-sm">{rec.examName}</div>
                        <div className="text-[10px] text-gray-400">{rec.date || rec.examType}</div>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 border-b dark:border-gray-700">
                    {rec.examType}
                  </td>
                  {allSubjects.map((sub) => (
                    <td key={sub} className="text-center px-2 py-2 border-b dark:border-gray-700">
                      {editing ? (
                        <input
                          type="number"
                          value={rec.subjects[sub] ?? ''}
                          onChange={(e) => updateScore(idx, sub, e.target.value)}
                          className="w-16 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 text-center text-xs"
                          min="0"
                          max="300"
                        />
                      ) : (
                        <span
                          className={`font-mono ${rec.subjects[sub] != null && rec.subjects[sub] > 0 ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'}`}
                        >
                          {rec.subjects[sub] != null && rec.subjects[sub] > 0
                            ? rec.subjects[sub]
                            : '-'}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="text-center px-2 py-2 border-b dark:border-gray-700 font-mono text-xs text-blue-600 dark:text-blue-400">
                    {calcAvg(rec.subjects).toFixed(1)}
                  </td>
                  {editing && (
                    <td className="text-center border-b dark:border-gray-700">
                      <button
                        type="button"
                        onClick={() => removeExam(idx)}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        &times;
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 排名信息 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('page.student.academics.rank')}
          </h5>
          <button
            type="button"
            onClick={() => (editingRank ? handleSaveRank() : setEditingRank(true))}
            className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
          >
            {editingRank ? t('page.student.academics.rankSave') : t('page.student.edit')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('page.student.academics.classRank')}
            </div>
            {editingRank ? (
              <input
                type="number"
                value={classRank ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  if (raw === '') {
                    setClassRank(undefined)
                    return
                  }
                  const v = parseInt(raw, 10)
                  // B-15: 0 也合法, 仅 NaN/空才清空
                  setClassRank(Number.isNaN(v) ? undefined : v)
                }}
                className="w-20 mx-auto mt-1 bg-white dark:bg-gray-900 border rounded px-2 py-1 text-center font-mono text-lg"
              />
            ) : (
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {classRank != null
                  ? t('page.student.academics.rankFormat', String(classRank))
                  : t('page.student.academics.unset')}
              </div>
            )}
          </div>
          <div className="text-center p-3 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/10 dark:to-pink-900/10 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('page.student.academics.gradeRank')}
            </div>
            {editingRank ? (
              <input
                type="number"
                value={gradeRank ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  if (raw === '') {
                    setGradeRank(undefined)
                    return
                  }
                  const v = parseInt(raw, 10)
                  setGradeRank(Number.isNaN(v) ? undefined : v)
                }}
                className="w-20 mx-auto mt-1 bg-white dark:bg-gray-900 border rounded px-2 py-1 text-center font-mono text-lg"
              />
            ) : (
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                {gradeRank != null
                  ? t('page.student.academics.rankFormat', String(gradeRank))
                  : t('page.student.academics.unset')}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 成绩趋势图 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
          {t('page.student.academics.trendTitle')}
        </h5>
        {trendData && trendData.series.length > 0 ? (
          <ReactEChartsCore
            echarts={echarts}
            style={{ height: 280 }}
            option={{
              animation: true,
              animationDuration: 1000,
              tooltip: { trigger: 'axis' },
              legend: {
                data: trendData.series.map((s) => s.name),
                bottom: 0,
                textStyle: { color: axisColor, fontSize: 11 },
              },
              grid: { left: 8, right: 8, top: 8, bottom: 36, containLabel: true },
              xAxis: {
                type: 'category',
                data: trendData.labels,
                axisLabel: {
                  color: axisColor,
                  fontSize: 11,
                  rotate: trendData.labels.length > 6 ? 30 : 0,
                },
                axisLine: { lineStyle: { color: gridColor } },
              },
              yAxis: {
                type: 'value',
                min: 0,
                axisLabel: { color: axisColor },
                splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
              },
              series: trendData.series.map((s, i) => ({
                name: s.name,
                type: 'line',
                data: s.data,
                smooth: true,
                lineStyle: { color: colors[i % colors.length], width: 2 },
                itemStyle: { color: colors[i % colors.length] },
                symbol: 'circle',
                symbolSize: 5,
              })),
            }}
          />
        ) : (
          <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-10">
            📈 请先录入各次考试成绩以查看趋势图
          </div>
        )}
      </div>

      {/* 偏科分析 */}
      {subjectAnalysis.all.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
            {t('page.student.academics.biasTitle')}
          </h5>
          <div className="grid grid-cols-2 gap-4 mb-3">
            {subjectAnalysis.strongest && (
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-lg p-3 border border-green-200/50 dark:border-green-700/30">
                <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                  {t('page.student.academics.strongest')}
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-bold text-green-700 dark:text-green-300">
                    {subjectAnalysis.strongest.subject}
                  </span>
                  <span className="text-sm text-green-500">
                    {subjectAnalysis.strongest.avg.toFixed(1)}{' '}
                    {t('page.student.academics.scoreUnit')}
                  </span>
                </div>
              </div>
            )}
            {subjectAnalysis.weakest && (
              <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/10 dark:to-rose-900/10 rounded-lg p-3 border border-red-200/50 dark:border-red-700/30">
                <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                  {t('page.student.academics.weakest')}
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-bold text-red-700 dark:text-red-300">
                    {subjectAnalysis.weakest.subject}
                  </span>
                  <span className="text-sm text-red-500">
                    {subjectAnalysis.weakest.avg.toFixed(1)} {t('page.student.academics.scoreUnit')}
                  </span>
                </div>
              </div>
            )}
          </div>
          <ReactEChartsCore
            echarts={echarts}
            style={{ height: 180 }}
            option={{
              animation: true,
              animationDuration: 800,
              grid: { left: 38, right: 8, top: 8, bottom: 0, containLabel: true },
              tooltip: { trigger: 'axis' },
              xAxis: {
                type: 'category',
                data: subjectAnalysis.all.map((a) => a.subject),
                axisLabel: { color: axisColor, fontSize: 11 },
                axisLine: { lineStyle: { color: gridColor } },
              },
              yAxis: {
                type: 'value',
                min: 0,
                axisLabel: { color: axisColor },
                splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
              },
              series: [
                {
                  type: 'bar',
                  data: subjectAnalysis.all.map((a, i) => ({
                    value: a.avg.toFixed(1),
                    itemStyle: { borderRadius: [4, 4, 0, 0], color: colors[i % colors.length] },
                  })),
                  barWidth: '40%',
                },
              ],
            }}
          />
        </div>
      )}
    </div>
  )
}

// =============================================================
// AI 分析选项卡
// =============================================================

function AIAnalysisTab({
  agents,
  selectedAgents,
  onToggleAgent,
  onRunSelected,
  onRunAll,
  running,
  agentOutputs,
  agentRunOrder: _agentRunOrder,
  activeAiTab: _activeAiTab,
  onSelectAgent: _onSelectAgent,
  onAbortAgent: _onAbortAgent,
  message,
  aiSaved,
  onSaveResult,
}: {
  agents: AgentListItem[]
  selectedAgents: Set<string>
  onToggleAgent: (id: string) => void
  onRunSelected: () => void
  onRunAll: () => void
  running: boolean
  agentOutputs: Record<
    string,
    { agentId: string; status: string; output: string; error?: string; durationMs?: number }
  >
  agentRunOrder: string[]
  activeAiTab: string
  onSelectAgent: (id: string) => void
  onAbortAgent: (id: string) => void
  message: string
  aiSaved: boolean
  onSaveResult: () => void
}) {
  const { t } = useT()
  const enabledAgents = agents.filter((a) => a.enabled)
  // B-05: 按 activeAiTab 选当前 agent 的分桶输出
  const activeOutput = _activeAiTab === '__overview' ? null : agentOutputs[_activeAiTab]
  const output = activeOutput?.output ?? ''
  const _isAnyRunning = running || Object.values(agentOutputs).some((o) => o.status === 'running')
  const _hasOutput = Object.keys(agentOutputs).length > 0

  const sections = useMemo(() => {
    if (!output) return []
    const result: { title: string; content: string }[] = []
    const lines = output.split('\n')
    let currentTitle = '分析输出'
    let currentContent = ''
    for (const line of lines) {
      if (
        (line.match(/^(===\s*|##\s*|【.+】)/) && !line.includes('🤖')) ||
        line.includes('操行总结') ||
        line.includes('风险预警') ||
        line.includes('行为模式') ||
        line.includes('教育建议')
      ) {
        if (currentContent.trim()) {
          result.push({ title: currentTitle, content: currentContent.trim() })
        }
        currentTitle = line
          .replace(/^[=\-#\s【】]+/g, '')
          .replace(/[\s=]+$/g, '')
          .trim()
        currentContent = ''
      } else {
        currentContent += `${line}\n`
      }
    }
    if (currentContent.trim()) {
      result.push({ title: currentTitle, content: currentContent.trim() })
    }
    return result.length > 0 ? result : [{ title: '分析输出', content: output }]
  }, [output])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">AI 分析</h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRunSelected}
            disabled={running || selectedAgents.size === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
          >
            {running ? '运行中...' : `🚀 运行选中 (${selectedAgents.size})`}
          </button>
          <button
            type="button"
            onClick={onRunAll}
            disabled={running || enabledAgents.length === 0}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
          >
            🤖 运行全部
          </button>
          {output && !running && (
            <button
              type="button"
              onClick={onSaveResult}
              className={
                'px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm ' +
                (aiSaved
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                  : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300')
              }
            >
              {aiSaved ? '✅ 已保存' : '💾 保存结果'}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`text-xs ${message.includes('失败') ? 'text-red-500' : 'text-green-500'}`}>
          {message}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          选择分析 Agent
        </h5>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {enabledAgents.length === 0 ? (
            <div className="text-gray-400 dark:text-gray-500 text-xs py-4 text-center">
              暂无可用 Agent
            </div>
          ) : (
            enabledAgents.map((agent) => (
              // biome-ignore lint/a11y/useSemanticElements: 包含 input 复选框，div+role 组合是必要结构
              <div
                key={agent.id}
                role="button"
                tabIndex={0}
                onClick={() => onToggleAgent(agent.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggleAgent(agent.id)
                  }
                }}
                className={
                  'flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ' +
                  (selectedAgents.has(agent.id)
                    ? 'bg-blue-500/10 border border-blue-500/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent')
                }
              >
                <input
                  type="checkbox"
                  checked={selectedAgents.has(agent.id)}
                  onChange={() => onToggleAgent(agent.id)}
                  className="rounded accent-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{agent.name}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                    {agent.description}
                  </div>
                </div>
                <span
                  className={
                    'text-[10px] px-2 py-0.5 rounded-full ' +
                    (agent.status === 'idle'
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                      : agent.status === 'running'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400')
                  }
                >
                  {agent.status === 'idle'
                    ? t('page.agents.status.idle')
                    : agent.status === 'running'
                      ? t('page.agents.status.running')
                      : t('page.agents.status.error')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {output && (
        <div className="space-y-3">
          {sections.map((section) => (
            <div
              key={section.title}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b border-gray-100 dark:border-gray-700">
                <h5 className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                  {section.title}
                </h5>
              </div>
              <div className="p-4 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: (p) => <h1 className="text-base font-bold mt-2 mb-1" {...p} />,
                    h2: (p) => <h2 className="text-sm font-semibold mt-2 mb-1" {...p} />,
                    h3: (p) => <h3 className="text-xs font-semibold mt-1.5 mb-0.5" {...p} />,
                    p: (p) => <p className="my-1" {...p} />,
                    ul: (p) => <ul className="list-disc pl-5 my-1" {...p} />,
                    ol: (p) => <ol className="list-decimal pl-5 my-1" {...p} />,
                    li: (p) => <li className="my-0.5" {...p} />,
                    code: (p) => (
                      <code
                        className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-[11px]"
                        {...p}
                      />
                    ),
                    pre: (p) => (
                      <pre
                        className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded p-2 overflow-x-auto my-2"
                        {...p}
                      />
                    ),
                    table: (p) => <table className="border-collapse my-2 w-full" {...p} />,
                    th: (p) => (
                      <th
                        className="border border-gray-200 dark:border-gray-700 px-2 py-1 bg-gray-50 dark:bg-gray-800/50"
                        {...p}
                      />
                    ),
                    td: (p) => (
                      <td
                        className="border border-gray-200 dark:border-gray-700 px-2 py-1"
                        {...p}
                      />
                    ),
                    strong: (p) => <strong className="font-semibold" {...p} />,
                    em: (p) => <em className="italic" {...p} />,
                  }}
                >
                  {section.content}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-800/50 dark:to-blue-900/10 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          📋 分析维度建议
        </h5>
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>操行分数趋势分析
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400"></span>风险等级评估与预警
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>行为模式识别
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>学业与操行关联性分析
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span>个性化教育建议
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================
// 内联添加事件组件
// =============================================================

function AddEventInline({
  studentName,
  studentStatus,
  reasonCodes,
  onDone,
}: {
  studentName: string
  // B-19: 接收学生状态, 转学/休学禁用事件录入
  studentStatus?: string
  reasonCodes: EAAReasonCode[]
  onDone: () => void
}) {
  const isInactive =
    studentStatus === 'Transferred' ||
    studentStatus === 'Suspended' ||
    studentStatus === 'Graduated'
  const [reasonCode, setReasonCode] = useState('')
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const deltaManuallyEdited = useRef(false)
  const { t } = useT()

  const handleSubmit = async () => {
    if (!reasonCode) return
    setSubmitting(true)
    try {
      const result = await getAPI().eaa.addEvent({
        studentName,
        reasonCode,
        delta: delta ? Number.parseFloat(delta) : undefined,
        note: note || undefined,
      })
      if (result.success) {
        onDone()
      } else {
        toast.error(t('page.student.addEvent.addFailed', getErrorMessage(result)))
      }
    } catch (err) {
      toast.error(
        t('page.student.addEvent.submitFailed', err instanceof Error ? err.message : String(err)),
      )
    }
    setSubmitting(false)
  }

  return (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10">
      {isInactive && (
        <div className="mb-2 text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-2">
          {t('page.student.addEvent.statusBlocked', studentStatus ?? '')}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <select
          value={reasonCode}
          onChange={(e) => {
            setReasonCode(e.target.value)
            if (!deltaManuallyEdited.current) {
              const code = reasonCodes.find((c) => c.code === e.target.value)
              if (code?.score_delta != null) setDelta(String(code.score_delta))
            }
          }}
          className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm col-span-2 focus:outline-none focus:border-blue-500"
        >
          <option value="">{t('page.student.addEvent.placeholder.reasonCode')}</option>
          {reasonCodes.map((c) => (
            <option key={c.code} value={c.code}>
              {t('page.student.addEvent.reasonCodePrefix')}
              {c.code}
              {c.score_delta != null ? ` [${c.score_delta > 0 ? '+' : ''}${c.score_delta}]` : ''}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={delta}
          onChange={(e) => {
            deltaManuallyEdited.current = true
            setDelta(e.target.value)
          }}
          placeholder={t('page.student.addEvent.placeholder.delta')}
          step="0.5"
          className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('page.student.addEvent.placeholder.note')}
        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm mb-2 focus:outline-none focus:border-blue-500"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !reasonCode || isInactive}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
        >
          {submitting ? t('page.student.addEvent.submitting') : t('page.student.addEvent.submit')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 text-xs px-2"
        >
          {t('page.student.cancel')}
        </button>
      </div>
    </div>
  )
}

// =============================================================
// O-01 学业录入 UX 重设计 — 三个独立组件
// - BulkImportModal: 粘贴 Excel 文本批量录入
// - ExamTemplateMenu: 快速选择考试模板
// - SmartFillButton: 一键用上次成绩预填当前行
// =============================================================

/**
 * 解析粘贴文本为 AcademicExamRecord[]
 * 支持: Tab 分隔 / 多个空格 / 逗号 / 多个连续空格
 * 每行一条: 考试名 + 科目分数
 * 智能推断:
 *   - 考试名包含"月考/期中/期末/周考/模拟考/随堂/平时" → 对应 examType
 *   - 第一列若为数字开头(>=10) → 视为"姓名+考试名"格式,自动取第二列
 *   - 识别"语文/数学/英语"等科目名 → 推断列名
 *   - 缺考留空 → null
 */
function parseBulkScoreText(
  text: string,
  knownSubjects: string[],
  t: (key: string, ...args: unknown[]) => string,
): { records: AcademicExamRecord[]; warnings: string[] } {
  const records: AcademicExamRecord[] = []
  const warnings: string[] = []
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) {
    return { records, warnings: [t('page.student.academics.bulkImport.error', 'empty input')] }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 用 tab 或 多个空格 分隔; 兼容中文逗号
    const cells = line
      .split(/\t+|\s{2,}|，/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
    if (cells.length < 2) {
      warnings.push(
        `line ${i + 1}: ${t('page.student.academics.bulkImport.error', 'too few cells')}`,
      )
      continue
    }
    const [first, ...rest] = cells
    // 推断 examType & examName
    const examName = first
    let examType = '其他'
    const types: Array<[string, string]> = [
      ['月考', '月考'],
      ['周考', '周考'],
      ['期中', '期中'],
      ['期末', '期末'],
      ['模拟考', '模拟考'],
      ['模拟', '模拟考'],
      ['随堂', '随堂测验'],
      ['平时', '平时测试'],
    ]
    for (const [kw, type] of types) {
      if (first.includes(kw)) {
        examType = type
        break
      }
    }
    // 第一列若全为数字开头且没匹配到考试关键字, 视为 "姓名+考试名" 格式
    if (examType === '其他' && /^\d/.test(first)) {
      // 不处理(无法确定考试名)
      warnings.push(`line ${i + 1}: 无法确定考试名`)
      continue
    }
    // 推断日期 (找 YYYY-MM-DD 模式)
    let date: string | undefined
    for (const cell of cells) {
      const m = cell.match(/(\d{4}-\d{2}-\d{2})/)
      if (m) {
        date = m[1]
        break
      }
    }
    // 构造 subjects
    const subjects: Record<string, number | null> = {}
    // 情况 A: 第一列是考试名, 后面是 [科目名, 分数, 科目名, 分数, ...]
    // 情况 B: 第一列是考试名, 后面直接是 [分数, 分数, ...] 对应 knownSubjects
    let hasNamedSubjects = false
    for (let j = 0; j < rest.length - 1; j += 2) {
      const name = rest[j]
      const val = rest[j + 1]
      if (knownSubjects.includes(name) || (name.length <= 6 && !/^\d/.test(val ?? ''))) {
        hasNamedSubjects = true
        break
      }
    }
    if (hasNamedSubjects) {
      for (let j = 0; j < rest.length - 1; j += 2) {
        const name = rest[j]
        const val = rest[j + 1]
        if (!val) continue
        const num = parseFloat(val)
        subjects[name] = Number.isNaN(num) ? null : num
      }
    } else {
      // 用 knownSubjects 顺序对齐
      for (let j = 0; j < rest.length; j++) {
        const sub = knownSubjects[j]
        if (!sub) break
        const val = rest[j]
        if (val === '' || val == null) {
          subjects[sub] = null
        } else {
          const num = parseFloat(val)
          subjects[sub] = Number.isNaN(num) ? null : num
        }
      }
    }
    if (Object.keys(subjects).length === 0) {
      warnings.push(`line ${i + 1}: 没有可解析的科目分数`)
      continue
    }
    records.push({ examType, examName, subjects, date })
  }
  return { records, warnings }
}

function BulkImportModal({
  knownSubjects,
  onApply,
  onClose,
}: {
  knownSubjects: string[]
  onApply: (records: AcademicExamRecord[]) => void
  onClose: () => void
}) {
  const { t } = useT()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<AcademicExamRecord[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')

  const handleParse = () => {
    setError('')
    setWarnings([])
    const result = parseBulkScoreText(text, knownSubjects, t)
    if (result.records.length === 0) {
      setError(t('page.student.academics.bulkImport.error', 'no valid records'))
      setPreview(null)
    } else {
      setPreview(result.records)
      setWarnings(result.warnings)
    }
  }

  const handleApply = () => {
    if (preview && preview.length > 0) {
      onApply(preview)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {t('page.student.academics.bulkImport.title')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-3 flex-1 overflow-y-auto">
          <pre className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 p-3 rounded mb-2 whitespace-pre-wrap">
            {t('page.student.academics.bulkImport.hint')}
          </pre>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('page.student.academics.bulkImport.placeholder')}
            rows={10}
            className="w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg p-2 text-xs font-mono focus:outline-none focus:border-blue-500"
          />

          {error && (
            <div className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded p-2">
              {error}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mt-2 text-xs text-yellow-600 bg-yellow-50 dark:bg-yellow-900/10 border border-yellow-200 dark:border-yellow-800 rounded p-2">
              {warnings.map((w, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list, no stable ID
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}

          {preview && preview.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('page.student.academics.bulkImport.preview', String(preview.length))}
              </div>
              <div className="max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">{t('page.student.academics.exam')}</th>
                      <th className="text-left px-2 py-1">
                        {t('page.student.academics.examType', 'Type')}
                      </th>
                      <th className="text-left px-2 py-1">{t('page.student.academics.column')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: preview data, no stable ID
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="px-2 py-1 font-medium">{r.examName}</td>
                        <td className="px-2 py-1 text-gray-500">{r.examType}</td>
                        <td className="px-2 py-1 text-gray-600">
                          {Object.entries(r.subjects)
                            .map(([k, v]) => `${k}=${v ?? '-'}`)
                            .join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            {t('page.student.cancel')}
          </button>
          <button
            type="button"
            onClick={handleParse}
            disabled={!text.trim()}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
          >
            {t('page.student.academics.bulkImport.parse')}
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!preview || preview.length === 0}
            className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded disabled:opacity-50"
          >
            {t('page.student.academics.bulkImport.apply')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 考试模板菜单 — 提供常用模板快速创建考试 */
const EXAM_TEMPLATES = [
  { key: 'monthly', subjects: 9 },
  { key: 'midterm', subjects: 9 },
  { key: 'final', subjects: 9 },
] as const

function ExamTemplateMenu({ onApply }: { onApply: (examType: string, examName: string) => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-1.5 rounded-lg text-xs"
        title={t('page.student.academics.template.hint')}
      >
        {t('page.student.academics.template')}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[180px]">
          {EXAM_TEMPLATES.map((tpl) => {
            const typeMap: Record<string, string> = {
              monthly: '月考',
              midterm: '期中',
              final: '期末',
            }
            const type = typeMap[tpl.key]
            const nextIdx = Date.now() % 100 // 简单随机; 实际应计算已有同名 index
            return (
              <button
                type="button"
                key={tpl.key}
                onClick={() => {
                  onApply(type, `${type}${nextIdx}`)
                  setOpen(false)
                }}
                className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                {t(`page.student.academics.template.${tpl.key}`)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// =============================================================
// 小型组件
// =============================================================

function MetricCard({
  label,
  value,
  color,
}: {
  label: string
  value: string | number
  color: string
}) {
  const g: Record<string, string> = {
    blue: 'from-blue-500/10 to-blue-600/5 border-blue-500/20 text-blue-600 dark:text-blue-400',
    green:
      'from-green-500/10 to-green-600/5 border-green-500/20 text-green-600 dark:text-green-400',
    red: 'from-red-500/10 to-red-600/5 border-red-500/20 text-red-600 dark:text-red-400',
    yellow:
      'from-yellow-500/10 to-yellow-600/5 border-yellow-500/20 text-yellow-600 dark:text-yellow-400',
  }
  return (
    <div className={`rounded-xl border p-3 bg-gradient-to-br ${g[color] ?? ''} shadow-sm`}>
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  )
}

function InfoRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: unknown
  highlight?: string
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
      <span className="text-gray-500 dark:text-gray-400 text-xs">{label}</span>
      <span className={`font-medium text-sm ${highlight ?? ''}`}>{String(value)}</span>
    </div>
  )
}

function ProfileSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        <span>{icon}</span>
        <h5 className="text-xs font-semibold text-gray-600 dark:text-gray-300">{title}</h5>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function ProfileField({
  label,
  value,
  editing,
  type,
  options,
  onChange,
  multiline,
  spanFull,
}: {
  label: string
  value: string
  editing: boolean
  type?: string
  options?: string[]
  onChange?: (v: string) => void
  multiline?: boolean
  spanFull?: boolean
}) {
  const baseClass =
    'w-full bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-colors'
  return (
    <div className={spanFull ? 'col-span-2' : ''}>
      {label && (
        <div className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">{label}</div>
      )}
      {editing ? (
        multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className={baseClass + (label ? ' mt-1' : '')}
            rows={3}
          />
        ) : type === 'select' && options ? (
          <select
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className={baseClass + (label ? ' mt-1' : '')}
          >
            <option value="">未选择</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={type ?? 'text'}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            className={baseClass + (label ? ' mt-1' : '')}
          />
        )
      ) : (
        <div
          className={`${label ? 'mt-1 ' : ''}text-sm font-medium text-gray-700 dark:text-gray-200`}
        >
          {value || '-'}
        </div>
      )}
    </div>
  )
}

function EventMiniCard({ event }: { event: EAAHistoryEvent }) {
  const isBonus = event.score_delta > 0
  return (
    <div className="flex items-center justify-between text-sm p-2.5 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-100 dark:border-gray-700/50">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`font-mono font-bold ${isBonus ? 'text-green-500' : 'text-red-500'}`}>
          {isBonus ? '+' : ''}
          {event.score_delta.toFixed(1)}
        </span>
        <span className="text-[10px] bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded font-mono">
          {event.reason_code}
        </span>
        {event.note && (
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{event.note}</span>
        )}
      </div>
      <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">
        {new Date(event.timestamp).toLocaleDateString()}
      </span>
    </div>
  )
}

function EventCard({
  event,
  expanded,
  onToggle,
  reasonLabel,
  onRevert,
}: {
  event: EAAHistoryEvent
  expanded: boolean
  onToggle: () => void
  reasonLabel?: string
  onRevert?: () => void
}) {
  const isBonus = event.score_delta > 0
  const isDeduct = event.score_delta < 0
  return (
    <div
      className={
        'rounded-xl border p-3.5 transition-all ' +
        (event.reverted
          ? 'bg-gray-50 dark:bg-gray-800/50 opacity-60 border-gray-100 dark:border-gray-700'
          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md')
      }
    >
      {/* biome-ignore lint/a11y/useSemanticElements: 包含可点击的子内容，div+role 是更灵活的容器 */}
      <div
        className="flex items-center justify-between cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`font-mono font-bold text-sm ${isBonus ? 'text-green-500' : isDeduct ? 'text-red-500' : 'text-gray-500'}`}
          >
            {isBonus ? '+' : ''}
            {event.score_delta.toFixed(1)}
          </span>
          <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full font-medium">
            {reasonLabel ?? event.reason_code}
          </span>
          {event.reverted && (
            <span className="text-[10px] bg-red-100 dark:bg-red-900/30 text-red-500 px-1.5 py-0.5 rounded">
              已撤销
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
          <span>{new Date(event.timestamp).toLocaleDateString()}</span>
          <span className="text-gray-300 dark:text-gray-600">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs space-y-1.5">
          {event.note && <div className="text-gray-600 dark:text-gray-300">📝 {event.note}</div>}
          <div className="flex gap-4 text-gray-500 dark:text-gray-400">
            {event.cumulative !== 0 && (
              <span>
                累计: <span className="font-mono">{event.cumulative.toFixed(1)}</span>
              </span>
            )}
            <span>标签: {event.tags.join(', ') || '无'}</span>
          </div>
          {/* 撤销按钮：仅未撤销事件显示 */}
          {onRevert && !event.reverted && (
            <div className="pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRevert()
                }}
                className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium transition-colors"
              >
                ↩ 撤销此事件
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
