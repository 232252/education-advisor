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
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useTheme } from '../../hooks/useTheme'
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

export function StudentProfile({ student, onClose, onRefresh }: StudentProfileProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [score, setScore] = useState<EAAStudentScore | null>(null)
  const [history, setHistory] = useState<EAAHistoryData | null>(null)
  const [reasonCodes, setReasonCodes] = useState<EAAReasonCode[]>([])
  const [profileData, setProfileData] = useState<StudentProfileData>({})
  const [_profileLoaded, setProfileLoaded] = useState(false)
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [aiRunning, setAiRunning] = useState(false)
  const [aiOutput, setAiOutput] = useState('')
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

  // P2-7 修复: loadProfileData 原本在 useCallback(loadAllData) 之后声明,
  // 但 loadAllData 内部又调用 loadProfileData,产生 TDZ,跑起来 ReferenceError。
  // 提前并用 useCallback 包裹。
  // P2-1: 加 currentNameRef 守卫,旧请求完成时若已切换则不更新
  const currentNameRef = useRef<string>(student.name)
  useEffect(() => {
    currentNameRef.current = student.name
  }, [student.name])
  const loadProfileData = useCallback(async (name: string) => {
    try {
      const result = await getAPI().profile.get(name)
      if (currentNameRef.current !== name) return
      if (result.success && result.data) {
        setProfileData(result.data)
      }
    } catch (err) {
      if (currentNameRef.current !== name) return
      console.warn('[Profile] Load profile data error:', err)
    }
    if (currentNameRef.current === name) setProfileLoaded(true)
  }, [])

  const loadAllData = useCallback(async () => {
    try {
      const [scoreRes, historyRes, codesRes, agentsRes] = await Promise.all([
        getAPI().eaa.score(student.name),
        getAPI().eaa.history(student.name),
        getAPI().eaa.codes(),
        getAPI().agent.list(),
      ])
      if (scoreRes.success) setScore(scoreRes.data)
      if (historyRes.success) setHistory(historyRes.data)
      if (codesRes.success && codesRes.data?.codes) setReasonCodes(codesRes.data.codes)
      if (agentsRes) setAgents(agentsRes)
      loadProfileData(student.name)
    } catch (err) {
      console.error('[Profile] Load error:', err)
    }
  }, [student.name, loadProfileData])

  useEffect(() => {
    loadAllData()
  }, [loadAllData])

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

  const runSelectedAgents = async () => {
    if (selectedAgents.size === 0) {
      setAiMessageAuto('请至少选择一个Agent')
      return
    }
    setAiRunning(true)
    setAiOutput('')
    setAiSaved(false)

    // 订阅状态更新以获取实时输出
    const unsub = getAPI().agent.onStatusUpdate((rawData) => {
      const data = rawData as { output?: string; result?: { durationMs?: number }; error?: string }
      if (data.output) {
        setAiOutput((prev) => prev + data.output)
      }
      if (data.result) {
        setAiOutput((prev) => `${prev}\n\n--- 执行完成 (${data.result?.durationMs}ms) ---\n`)
      }
      if (data.error) {
        setAiOutput((prev) => `${prev}\n[错误] ${data.error}\n`)
      }
    })

    try {
      for (const agentId of selectedAgents) {
        setAiOutput((prev) => `${prev}\n=== 🤖 ${agentId} ===\n`)
        const prompt = `请分析学生"${student.name}"的操行情况。基本信息：- 分数：${student.score}\n- 风险等级：${student.risk}\n- 事件数：${student.events_count}\n\n请从以下维度进行分析：\n1. 操行总结\n2. 风险预警\n3. 行为模式\n4. 教育建议`
        await getAPI().agent.runManual(agentId, prompt)
        // 等待一段时间让流式输出到达
        await new Promise((r) => setTimeout(r, 1500))
      }
      setAiMessageAuto('AI 分析完成')
    } catch (err) {
      setAiMessageAuto(`分析失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      unsub()
      setAiRunning(false)
    }
  }

  const runAllAgents = async () => {
    const allIds = agents.filter((a) => a.enabled).map((a) => a.id)
    if (allIds.length === 0) {
      setAiMessageAuto('没有可用的Agent')
      return
    }
    setSelectedAgents(new Set(allIds))
    setAiRunning(true)
    setAiOutput('')
    setAiSaved(false)

    // 订阅状态更新以获取实时输出
    const unsub = getAPI().agent.onStatusUpdate((rawData) => {
      const data = rawData as { output?: string; result?: { durationMs?: number }; error?: string }
      if (data.output) {
        setAiOutput((prev) => prev + data.output)
      }
      if (data.result) {
        setAiOutput((prev) => `${prev}\n\n--- 执行完成 (${data.result?.durationMs}ms) ---\n`)
      }
      if (data.error) {
        setAiOutput((prev) => `${prev}\n[错误] ${data.error}\n`)
      }
    })

    try {
      for (const agentId of allIds) {
        setAiOutput((prev) => `${prev}\n=== 🤖 ${agentId} ===\n`)
        const prompt = `请分析学生"${student.name}"的操行情况。基本信息：- 分数：${student.score}\n- 风险等级：${student.risk}\n- 事件数：${student.events_count}\n\n请从以下维度进行分析：\n1. 操行总结\n2. 风险预警\n3. 行为模式\n4. 教育建议`
        await getAPI().agent.runManual(agentId, prompt)
        await new Promise((r) => setTimeout(r, 1500))
      }
      setAiMessageAuto('AI 分析完成')
    } catch (err) {
      setAiMessageAuto(`分析失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      unsub()
      setAiRunning(false)
    }
  }

  const saveAiResult = async () => {
    try {
      const result = await getAPI().profile.set(student.name, {
        ...profileData,
        aiAnalysis: aiOutput,
        aiAnalyzedAt: Date.now(),
      })
      if (result.success) {
        setAiSaved(true)
        toast.success('分析结果已保存')
      }
    } catch (_err) {
      toast.error('保存失败')
    }
  }

  const now = Date.now()
  const filteredEvents = useMemo(() => {
    let events = history?.events ?? []
    if (eventFilter === 'bonus') events = events.filter((e) => e.score_delta > 0)
    if (eventFilter === 'deduct') events = events.filter((e) => e.score_delta < 0)
    if (eventTimeRange !== 'all') {
      const ranges: Record<string, number> = {
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        semester: 120 * 24 * 60 * 60 * 1000,
      }
      const cutoff = now - ranges[eventTimeRange]
      events = events.filter((e) => new Date(e.timestamp).getTime() > cutoff)
    }
    return events
  }, [history, eventFilter, eventTimeRange, now])

  const tabs = [
    { id: 'overview' as TabId, label: '概览', icon: '📊' },
    { id: 'profile' as TabId, label: '档案', icon: '📋' },
    { id: 'events' as TabId, label: '事件', icon: '📝' },
    { id: 'academics' as TabId, label: '学业', icon: '📚' },
    { id: 'ai' as TabId, label: 'AI分析', icon: '🤖' },
  ]

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* 头部 */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-800 dark:to-gray-800/80">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
              {student.name[0]}
            </div>
            <div>
              <h2 className="text-xl font-bold">{student.name}</h2>
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                <span className={riskColor(student.risk)}>风险: {student.risk}</span>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span>
                  分数:{' '}
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                    {student.score.toFixed(1)}
                  </span>
                </span>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <span>{student.events_count} 事件</span>
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
            className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm"
          >
            {showAddEvent ? '取消添加' : '+ 添加事件'}
          </button>
          <button
            type="button"
            onClick={() => {
              loadAllData()
              onRefresh()
            }}
            className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-xs transition-colors shadow-sm"
          >
            🔄 刷新
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
          reasonCodes={reasonCodes}
          onDone={() => {
            setShowAddEvent(false)
            loadAllData()
            onRefresh()
            setActionMsgAuto('事件已添加')
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
            output={aiOutput}
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
  const recentEvents = history?.events?.slice(0, 5) ?? []
  const bonusCount = history?.events?.filter((e) => e.score_delta > 0).length ?? 0
  const deductCount = history?.events?.filter((e) => e.score_delta < 0).length ?? 0

  const scoreTimeline = useMemo(() => {
    if (!history?.events || history.events.length === 0)
      return { dates: [] as string[], scores: [] as number[] }
    let cumulative = 0
    const dates: string[] = []
    const scores: number[] = []
    const events = history.events.slice(-20)
    for (const evt of events) {
      cumulative += evt.score_delta
      dates.push(new Date(evt.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }))
      scores.push(cumulative)
    }
    return { dates, scores }
  }, [history])

  const axisColor = isDark ? '#9ca3af' : '#6b7280'
  const gridColor = isDark ? '#1f2937' : '#e5e7eb'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="当前分数" value={student.score.toFixed(1)} color="blue" />
        <MetricCard
          label="分数变动"
          value={(student.delta >= 0 ? '+' : '') + student.delta.toFixed(1)}
          color={student.delta >= 0 ? 'green' : 'red'}
        />
        <MetricCard label="加分事件" value={bonusCount} color="green" />
        <MetricCard label="扣分事件" value={deductCount} color="red" />
      </div>

      {scoreTimeline.dates.length > 1 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            📈 分数变化趋势
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
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">基本信息</h4>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow label="状态" value={score?.status ?? 'Active'} />
          <InfoRow label="风险等级" value={student.risk} highlight={riskColor(student.risk)} />
          <InfoRow label="班级" value={score?.class_id ?? '未设置'} />
          <InfoRow label="分组" value={student.groups.join(', ') || '无'} />
          <InfoRow label="角色" value={student.roles.join(', ') || '无'} />
          <InfoRow label="事件总数" value={student.events_count} />
          {score?.last_event_at && (
            <InfoRow label="最近事件" value={new Date(score.last_event_at).toLocaleDateString()} />
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">📋 最近事件</h4>
        {recentEvents.length === 0 ? (
          <div className="text-gray-400 dark:text-gray-500 text-sm py-4 text-center">暂无事件</div>
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
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<StudentProfileData>(profileData)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const setMsgAuto = useAutoDismiss<string>(setMsg, '')

  useEffect(() => {
    setForm(profileData)
  }, [profileData])

  const handleSave = async () => {
    setSaving(true)
    try {
      const result = await getAPI().profile.set(student.name, form)
      if (!result.success) {
        setMsgAuto(`保存失败: ${result.error ?? '未知错误'}`)
        return
      }
      if (form.classId) {
        await getAPI().eaa.setStudentMeta({ name: student.name, classId: form.classId as string })
      }
      setMsgAuto('档案已保存')
      onUpdate()
    } catch (err) {
      setMsgAuto(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    setSaving(false)
    setEditing(false)
  }

  const updateForm = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">学生档案</h4>
        <button
          type="button"
          onClick={() => (editing ? handleSave() : setEditing(true))}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
        >
          {saving ? '保存中...' : editing ? '💾 保存' : '✏️ 编辑'}
        </button>
      </div>
      {msg && (
        <div className={`text-xs ${msg.includes('失败') ? 'text-red-500' : 'text-green-500'}`}>
          {msg}
        </div>
      )}

      {/* 基础信息 */}
      <ProfileSection title="基础信息" icon="👤">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField label="姓名" value={student.name} editing={false} />
          <ProfileField
            label="性别"
            value={form.gender ?? ''}
            editing={editing}
            type="select"
            options={['男', '女']}
            onChange={(v) => updateForm('gender', v)}
          />
          <ProfileField
            label="出生日期"
            value={form.birthDate ?? ''}
            editing={editing}
            type="date"
            onChange={(v) => updateForm('birthDate', v)}
          />
          <ProfileField
            label="身份证号"
            value={form.idCard ?? ''}
            editing={editing}
            onChange={(v) => updateForm('idCard', v)}
          />
          <ProfileField
            label="班级"
            value={(form.classId as string) ?? student.class_id ?? ''}
            editing={editing}
            onChange={(v) => updateForm('classId', v)}
          />
          <ProfileField
            label="入学日期"
            value={form.enrollmentDate ?? ''}
            editing={editing}
            type="date"
            onChange={(v) => updateForm('enrollmentDate', v)}
          />
        </div>
      </ProfileSection>

      {/* 联系方式 */}
      <ProfileSection title="联系方式" icon="📞">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label="电话"
            value={form.phone ?? ''}
            editing={editing}
            onChange={(v) => updateForm('phone', v)}
          />
          <ProfileField
            label="邮箱"
            value={(form.email as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('email', v)}
          />
          <ProfileField
            label="家庭住址"
            value={form.address ?? ''}
            editing={editing}
            onChange={(v) => updateForm('address', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 家庭信息 */}
      <ProfileSection title="家庭信息" icon="🏠">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label="父亲姓名"
            value={(form.fatherName as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('fatherName', v)}
          />
          <ProfileField
            label="父亲电话"
            value={(form.fatherPhone as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('fatherPhone', v)}
          />
          <ProfileField
            label="母亲姓名"
            value={(form.motherName as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('motherName', v)}
          />
          <ProfileField
            label="母亲电话"
            value={(form.motherPhone as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('motherPhone', v)}
          />
        </div>
      </ProfileSection>

      {/* 健康信息 */}
      <ProfileSection title="健康信息" icon="🏥">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label="血型"
            value={(form.bloodType as string) ?? ''}
            editing={editing}
            type="select"
            options={['A', 'B', 'AB', 'O']}
            onChange={(v) => updateForm('bloodType', v)}
          />
          <ProfileField
            label="过敏史"
            value={(form.allergy as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('allergy', v)}
          />
          <ProfileField
            label="特殊需求"
            value={(form.specialNeeds as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('specialNeeds', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 在校信息 */}
      <ProfileSection title="在校信息" icon="🏫">
        <div className="grid grid-cols-2 gap-3">
          <ProfileField
            label="学号"
            value={(form.studentNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('studentNumber', v)}
          />
          <ProfileField
            label="宿舍号"
            value={(form.dormNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('dormNumber', v)}
          />
          <ProfileField
            label="床号"
            value={(form.bedNumber as string) ?? ''}
            editing={editing}
            onChange={(v) => updateForm('bedNumber', v)}
          />
          <ProfileField
            label="出勤率(%)"
            value={form.attendanceRate?.toString() ?? ''}
            editing={editing}
            type="number"
            onChange={(v) => updateForm('attendanceRate', v)}
          />
        </div>
      </ProfileSection>

      {/* 奖惩记录 */}
      <ProfileSection title="奖惩记录" icon="🏆">
        <div className="grid grid-cols-1 gap-3">
          <ProfileField
            label="荣誉称号"
            value={(form.honors as string) ?? ''}
            editing={editing}
            multiline
            onChange={(v) => updateForm('honors', v)}
            spanFull
          />
          <ProfileField
            label="处分记录"
            value={(form.punishments as string) ?? ''}
            editing={editing}
            multiline
            onChange={(v) => updateForm('punishments', v)}
            spanFull
          />
        </div>
      </ProfileSection>

      {/* 备注 */}
      <ProfileSection title="备注" icon="📝">
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
      <ProfileSection title="EAA 系统数据" icon="⚙️">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <InfoRow label="分组" value={student.groups.join(', ') || '无'} />
          <InfoRow label="角色" value={student.roles.join(', ') || '无'} />
          <InfoRow label="状态" value={student.status} />
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
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  // 搜索/范围结果（替换 history 事件）
  const [searchEvents, setSearchEvents] = useState<EAAHistoryEvent[] | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  // 实际展示的事件列表：有搜索/范围结果时用结果，否则用 props.events
  const displayEvents = searchEvents ?? events

  // 搜索防抖
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 用 ref 持有 performSearch 引用，避免回调依赖变化时频繁重建
  const performSearchRef = useRef<((q: string, s: string, e: string) => Promise<void>) | null>(null)

  const handleSearchChange = useCallback(
    (value: string) => {
      onSearchQueryChange(value)
      // 清空搜索词时恢复 history 事件
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
      // 无日期范围且无搜索词时恢复 history 事件
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
      if (start && end) {
        const result = await getAPI().eaa.range(start, end, 100)
        if (result.success && result.data?.events) {
          setSearchEvents(result.data.events.map(eventRecordToHistory))
        } else {
          setSearchEvents([])
        }
      } else if (query.trim()) {
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
      toast.error('查询事件失败')
      setSearchEvents([])
    }
    setSearchLoading(false)
  }

  // 同步 performSearch 引用到 ref（用于在 useCallback 中调用）
  performSearchRef.current = performSearch

  const handleRevert = async (eventId: string) => {
    if (!confirm('确定要撤销此事件吗？撤销后分数将回退。')) return
    try {
      const result = await getAPI().eaa.revertEvent(eventId, `由 ${studentName} 档案页撤销`)
      if (result.success) {
        toast.success('事件已撤销')
        onRefresh()
      } else {
        toast.error(getErrorMessage(result, '撤销失败'))
      }
    } catch (err) {
      console.warn('[EventsTab] revert error:', err)
      toast.error('撤销事件失败')
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
          {isSearchMode ? `搜索结果 ${displayEvents.length} 条` : `共 ${displayEvents.length} 条`}
        </span>
      </div>

      {displayEvents.length === 0 ? (
        <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-12">
          {searchLoading ? '查询中...' : isSearchMode ? '未找到匹配的事件' : '暂无事件记录'}
        </div>
      ) : (
        <div className="space-y-2">
          {displayEvents.map((evt) => (
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
  // 从 academicRecords 加载，或从旧格式迁移
  const [records, setRecords] = useState<AcademicExamRecord[]>(
    () => profileData.academicRecords ?? migrateLegacyRecords(profileData),
  )
  // 可配置的科目列表（默认常用科目）
  const [allSubjects, setAllSubjects] = useState<string[]>([
    '语文', '数学', '英语',
    '物理', '化学', '生物',
    '政治', '历史', '地理',
    '通用技术', '信息技术',
    '体育', '音乐', '美术',
  ])
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
  const [newExamType, setNewExamType] = useState('月考')
  const [newExamName, setNewExamName] = useState('')
  const [newExamDate, setNewExamDate] = useState('')

  // 从旧格式迁移
  function migrateLegacyRecords(data: StudentProfileData): AcademicExamRecord[] {
    const result: AcademicExamRecord[] = []
    // 检查是否有 deprecated 旧字段
    const midterm = (data as unknown as Record<string, unknown>).midtermGrades as Record<string, number> | undefined
    const final = (data as unknown as Record<string, unknown>).finalGrades as Record<string, number> | undefined
    const monthly1 = (data as unknown as Record<string, unknown>).monthlyExam1Grades as Record<string, number> | undefined
    const monthly2 = (data as unknown as Record<string, unknown>).monthlyExam2Grades as Record<string, number> | undefined

    if (monthly1 && Object.keys(monthly1).length > 0)
      result.push({ examType: '月考', examName: '月考1', subjects: { ...monthly1 } })
    if (monthly2 && Object.keys(monthly2).length > 0)
      result.push({ examType: '月考', examName: '月考2', subjects: { ...monthly2 } })
    if (midterm && Object.keys(midterm).length > 0)
      result.push({ examType: '期中', examName: '期中', subjects: { ...midterm } })
    if (final && Object.keys(final).length > 0)
      result.push({ examType: '期末', examName: '期末', subjects: { ...final } })

    return result
  }

  const calcAvg = (grades: Record<string, number>) => {
    const vals = Object.values(grades).filter((v) => !Number.isNaN(v) && v > 0)
    return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length
  }

  // 偏科分析：使用活跃科目（有数据的）
  const subjectAnalysis = useMemo(() => {
    const allGrades: Record<string, number[]> = {}
    const activeSubjects = new Set<string>()
    for (const rec of records) {
      for (const [sub, score] of Object.entries(rec.subjects)) {
        if (score != null && !Number.isNaN(score) && score > 0) {
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
    const sorted = [...records].sort((a, b) => (a.date || a.examName).localeCompare(b.date || b.examName))
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
  const colors = ['#3b82f6', '#ef4444', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#ec4899', '#14b8a6']

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
    if (!confirm(`将删除"${sub}"科目，同时从 ${count} 条考试记录中移除该科目成绩。确定继续？`)) return
    setAllSubjects(allSubjects.filter((s) => s !== sub))
    setRecords(records.map((r) => {
      const newSubjects = { ...r.subjects }
      delete newSubjects[sub]
      return { ...r, subjects: newSubjects }
    }))
  }

  // 添加考试
  const addExam = () => {
    const existingIndexes = records
      .filter((r) => r.examType === newExamType)
      .map((r) => {
        const match = r.examName.match(new RegExp(`^${newExamType}(\\d+)$`))
        return match ? parseInt(match[1], 10) : 0
      })
    const nextIndex = existingIndexes.length > 0 ? Math.max(...existingIndexes) + 1 : 1
    const name = newExamName.trim() || `${newExamType}${nextIndex}`
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
    if (!confirm(`将删除考试"${rec.examName}"（${rec.examType}），共 ${Object.keys(rec.subjects).length} 个科目成绩。确定继续？`)) return
    setRecords(records.filter((_, i) => i !== idx))
  }

  // 更新某考试某科目分数
  const updateScore = (idx: number, subject: string, value: string) => {
    const newRecords = [...records]
    newRecords[idx] = {
      ...newRecords[idx],
      subjects: { ...newRecords[idx].subjects, [subject]: value === '' ? (undefined as unknown as number) : parseFloat(value) || 0 },
    }
    setRecords(newRecords)
  }

  const handleSave = async () => {
    // 前端校验
    for (let i = 0; i < records.length; i++) {
      const rec = records[i]
      if (!rec.examType || !rec.examName) {
        setValidationMsg(`第 ${i + 1} 条记录缺少考试类型或名称`)
        return
      }
      for (const [sub, score] of Object.entries(rec.subjects)) {
        if (typeof score !== 'number' || Number.isNaN(score) || score < 0 || score > 150) {
          setValidationMsg(`${rec.examName} - ${sub}: 分数无效 (0-150)`)
          return
        }
      }
    }
    setValidationMsg('')
    setSaving(true)
    try {
      // 先校验
      const validateResult = await getAPI().profile.validateAcademic(records)
      if (!validateResult.success) {
        setValidationMsg(`校验失败: ${validateResult.errors?.join('; ')}`)
        setSaving(false)
        return
      }
      // 保存
      await getAPI().profile.set(studentName, {
        ...profileData,
        academicRecords: records,
        classRank,
        gradeRank,
      })
      toast.success('成绩已保存')
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    setSaving(false)
    setEditing(false)
    setEditingRank(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">学业成绩</h4>
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
            <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">📚 科目管理</h5>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {allSubjects.map((sub) => (
                <span key={sub} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded text-xs">
                  {sub}
                  <button type="button" onClick={() => removeSubject(sub)} className="text-blue-400 hover:text-red-500">&times;</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSubject() }}
                placeholder="添加科目"
                className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm"
              />
              <button type="button" onClick={addSubject} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs">+</button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">支持 3+3 / 3+1+2 模式，可任意添加/删除科目</p>
          </div>

          {/* 添加考试 */}
          <div className="flex items-center gap-2">
            {!addingExam ? (
              <button type="button" onClick={() => setAddingExam(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded-lg text-xs">+ 添加考试</button>
            ) : (
              <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 shadow-sm w-full">
                <select value={newExamType} onChange={(e) => setNewExamType(e.target.value)} className="bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1 text-xs">
                  {['月考', '周考', '期中', '期末', '模拟考', '平时测试', '随堂测验'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input type="text" value={newExamName} onChange={(e) => setNewExamName(e.target.value)} placeholder="考试名称（可选）" className="flex-1 bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1 text-xs" />
                <input type="date" value={newExamDate} onChange={(e) => setNewExamDate(e.target.value)} className="bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1 text-xs" />
                <button type="button" onClick={addExam} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs">确定</button>
                <button type="button" onClick={() => setAddingExam(false)} className="text-gray-400 text-xs px-2">取消</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 成绩表格 */}
      {records.length === 0 ? (
        <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-10">
          📝 暂无成绩记录，点击"编辑"后添加
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800/50">
                <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700 sticky left-0 bg-gray-50 dark:bg-gray-800/50">考试</th>
                <th className="text-left px-3 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700">类型</th>
                {allSubjects.map((sub) => (
                  <th key={sub} className="text-center px-2 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700 min-w-[60px]">{sub}</th>
                ))}
                <th className="text-center px-2 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700">平均</th>
                {editing && <th className="text-center px-2 py-2 text-xs text-gray-500 font-medium border-b dark:border-gray-700 w-10"></th>}
              </tr>
            </thead>
            <tbody>
              {records.map((rec, idx) => (
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
                            newRecords[idx] = { ...newRecords[idx], date: e.target.value || undefined }
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
                        <span className={`font-mono ${rec.subjects[sub] != null && rec.subjects[sub] > 0 ? 'text-gray-700 dark:text-gray-200' : 'text-gray-300 dark:text-gray-600'}`}>
                          {rec.subjects[sub] != null && rec.subjects[sub] > 0 ? rec.subjects[sub] : '-'}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="text-center px-2 py-2 border-b dark:border-gray-700 font-mono text-xs text-blue-600 dark:text-blue-400">
                    {calcAvg(rec.subjects).toFixed(1)}
                  </td>
                  {editing && (
                    <td className="text-center border-b dark:border-gray-700">
                      <button type="button" onClick={() => removeExam(idx)} className="text-red-400 hover:text-red-600 text-xs">&times;</button>
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
          <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400">排名信息</h5>
          <button
            type="button"
            onClick={() => (editingRank ? handleSave() : setEditingRank(true))}
            className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
          >
            {editingRank ? '保存排名' : '编辑'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">班级排名</div>
            {editingRank ? (
              <input
                type="number"
                value={classRank ?? ''}
                onChange={(e) => setClassRank(parseInt(e.target.value, 10) || undefined)}
                className="w-20 mx-auto mt-1 bg-white dark:bg-gray-900 border rounded px-2 py-1 text-center font-mono text-lg"
              />
            ) : (
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {classRank != null ? `第 ${classRank} 名` : '未设置'}
              </div>
            )}
          </div>
          <div className="text-center p-3 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/10 dark:to-pink-900/10 rounded-lg">
            <div className="text-xs text-gray-500 dark:text-gray-400">年级排名</div>
            {editingRank ? (
              <input
                type="number"
                value={gradeRank ?? ''}
                onChange={(e) => setGradeRank(parseInt(e.target.value, 10) || undefined)}
                className="w-20 mx-auto mt-1 bg-white dark:bg-gray-900 border rounded px-2 py-1 text-center font-mono text-lg"
              />
            ) : (
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">
                {gradeRank != null ? `第 ${gradeRank} 名` : '未设置'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 成绩趋势图 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
        <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">📈 成绩趋势</h5>
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
                axisLabel: { color: axisColor, fontSize: 11, rotate: trendData.labels.length > 6 ? 30 : 0 },
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
          <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">📊 偏科分析</h5>
          <div className="grid grid-cols-2 gap-4 mb-3">
            {subjectAnalysis.strongest && (
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-lg p-3 border border-green-200/50 dark:border-green-700/30">
                <div className="text-xs text-green-600 dark:text-green-400 font-medium">🏆 最强科目</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-bold text-green-700 dark:text-green-300">{subjectAnalysis.strongest.subject}</span>
                  <span className="text-sm text-green-500">{subjectAnalysis.strongest.avg.toFixed(1)}分</span>
                </div>
              </div>
            )}
            {subjectAnalysis.weakest && (
              <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/10 dark:to-rose-900/10 rounded-lg p-3 border border-red-200/50 dark:border-red-700/30">
                <div className="text-xs text-red-600 dark:text-red-400 font-medium">⚠️ 最弱科目</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-bold text-red-700 dark:text-red-300">{subjectAnalysis.weakest.subject}</span>
                  <span className="text-sm text-red-500">{subjectAnalysis.weakest.avg.toFixed(1)}分</span>
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
              series: [{
                type: 'bar',
                data: subjectAnalysis.all.map((a, i) => ({
                  value: a.avg.toFixed(1),
                  itemStyle: { borderRadius: [4, 4, 0, 0], color: colors[i % colors.length] },
                })),
                barWidth: '40%',
              }],
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
  output,
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
  output: string
  message: string
  aiSaved: boolean
  onSaveResult: () => void
}) {
  const enabledAgents = agents.filter((a) => a.enabled)

  const sections = useMemo(() => {
    if (!output) return []
    const result: { title: string; content: string }[] = []
    const lines = output.split('\n')
    let currentTitle = '分析输出'
    let currentContent = ''
    for (const line of lines) {
      if (
        line.match(/^(===\s*|##\s*|【.+】)/) ||
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
                  onChange={() => {}}
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
                    ? '待机'
                    : agent.status === 'running'
                      ? '运行中'
                      : '错误'}
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
              <div className="p-4">
                <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {section.content}
                </pre>
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
  reasonCodes,
  onDone,
}: {
  studentName: string
  reasonCodes: EAAReasonCode[]
  onDone: () => void
}) {
  const [reasonCode, setReasonCode] = useState('')
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const deltaManuallyEdited = useRef(false)

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
        toast.error(`添加失败: ${getErrorMessage(result)}`)
      }
    } catch (err) {
      toast.error(`提交失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    setSubmitting(false)
  }

  return (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10">
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
          <option value="">选择原因码...</option>
          {reasonCodes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label} ({c.code}){' '}
              {c.score_delta != null ? `[${c.score_delta > 0 ? '+' : ''}${c.score_delta}]` : ''}
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
          placeholder="分数"
          step="0.5"
          className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="备注（可选）"
        className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-2 text-sm mb-2 focus:outline-none focus:border-blue-500"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !reasonCode}
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg text-xs transition-colors disabled:opacity-50 shadow-sm"
        >
          {submitting ? '提交中...' : '确认添加'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 text-xs px-2"
        >
          取消
        </button>
      </div>
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
