// =============================================================
// 学生档案组件 — 多选项卡详细视图
// 选项卡: 概览 | 档案 | 事件 | 学业 | AI分析
// =============================================================

import type { EAAStudent } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, BookOpen, Bot, ClipboardList, History } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useTheme } from '../../hooks/useTheme'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle, cn, riskColor } from '../../lib/ui-utils'
import { useAgentStore } from '../../stores/agentStore'
import { toast } from '../../stores/toastStore'
import { AddEventInline } from './components'
import { useStudentProfileData } from './hooks/useStudentProfileData'
import { AcademicsTab, AIAnalysisTab, EventsTab, OverviewTab, ProfileTab } from './tabs'

interface StudentProfileProps {
  student: EAAStudent
  onClose: () => void
  onRefresh: () => void
}

type TabId = 'overview' | 'profile' | 'events' | 'academics' | 'ai'

// 模块级常量 — StudentProfile 的 tabs 固定不变
const STUDENT_PROFILE_TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: '概览', icon: BarChart3 },
  { id: 'profile', label: '档案', icon: ClipboardList },
  { id: 'events', label: '事件', icon: History },
  { id: 'academics', label: '学业', icon: BookOpen },
  { id: 'ai', label: 'AI分析', icon: Bot },
]

export function StudentProfile({ student, onClose, onRefresh }: StudentProfileProps) {
  const { t } = useT()
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  // R95 修复: mountedRef 防止异步 agent 分析循环在组件卸载后继续调用 setState
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  // 数据加载接入 Phase 1 useMultiLoader（替代原 loadAllData + currentNameRef stale guard）
  const {
    score,
    history,
    reasonCodes,
    agents,
    profileData,
    reload: reloadProfileData,
  } = useStudentProfileData(student.name)
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

    // High 修复: 改用 agentStore.subscribeStatus 派生订阅,并通过 agentId 过滤避免事件串扰
    // 之前直接 getAPI().agent.onStatusUpdate 会绕过 agentStore 的去重逻辑,
    // 多个组件同时订阅时收到重复事件;且不过滤 agentId 时,其他 agent 的事件会串扰到此处
    const selectedAgentIds = new Set(selectedAgents)
    const unsub = useAgentStore.getState().subscribeStatus((data) => {
      // 仅处理当前选中的 agent 发出的状态事件
      if (!selectedAgentIds.has(data.agentId)) return
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
        // R95 修复: 组件卸载后立即中止循环,不再调用 setState
        if (!mountedRef.current) break
        setAiOutput((prev) => `${prev}\n=== 🤖 ${agentId} ===\n`)
        const prompt = `请分析学生"${student.name}"的操行情况。基本信息：- 分数：${student.score}\n- 风险等级：${student.risk}\n- 事件数：${student.events_count}\n\n请从以下维度进行分析：\n1. 操行总结\n2. 风险预警\n3. 行为模式\n4. 教育建议`
        await getAPI().agent.runManual(agentId, prompt)
        // 等待一段时间让流式输出到达
        await new Promise((r) => setTimeout(r, 1500))
      }
      if (mountedRef.current) setAiMessageAuto('AI 分析完成')
    } catch (err) {
      if (mountedRef.current)
        setAiMessageAuto(`分析失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      unsub()
      if (mountedRef.current) setAiRunning(false)
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

    // High 修复: 改用 agentStore.subscribeStatus 派生订阅,并通过 agentId 过滤避免事件串扰
    const allAgentIds = new Set(allIds)
    const unsub = useAgentStore.getState().subscribeStatus((data) => {
      if (!allAgentIds.has(data.agentId)) return
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
        // R95 修复: 组件卸载后立即中止循环,不再调用 setState
        if (!mountedRef.current) break
        setAiOutput((prev) => `${prev}\n=== 🤖 ${agentId} ===\n`)
        const prompt = `请分析学生"${student.name}"的操行情况。基本信息：- 分数：${student.score}\n- 风险等级：${student.risk}\n- 事件数：${student.events_count}\n\n请从以下维度进行分析：\n1. 操行总结\n2. 风险预警\n3. 行为模式\n4. 教育建议`
        await getAPI().agent.runManual(agentId, prompt)
        await new Promise((r) => setTimeout(r, 1500))
      }
      if (mountedRef.current) setAiMessageAuto('AI 分析完成')
    } catch (err) {
      if (mountedRef.current)
        setAiMessageAuto(`分析失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      unsub()
      if (mountedRef.current) setAiRunning(false)
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
        toast.success(t('toast.profile.analysisSaved'))
      }
    } catch (_err) {
      toast.error(t('toast.common.saveFailed'))
    }
  }

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
      // now 在 useMemo 内部计算，避免每次渲染都使 memo 失效
      const cutoff = Date.now() - ranges[eventTimeRange]
      events = events.filter((e) => new Date(e.timestamp).getTime() > cutoff)
    }
    return events
  }, [history, eventFilter, eventTimeRange])

  // tabs 已提升为模块级常量 STUDENT_PROFILE_TABS

  return (
    <div className="h-full flex flex-col bg-white dark:bg-surface-primary">
      {/* 头部 */}
      <PageHeader
        size="sm"
        title={student.name}
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowAddEvent(!showAddEvent)}
              className={btnStyle('primary')}
              aria-label={showAddEvent ? '取消添加事件' : '添加事件'}
            >
              {showAddEvent ? '取消添加' : '+ 添加事件'}
            </button>
            <button
              type="button"
              onClick={() => {
                reloadProfileData()
                onRefresh()
              }}
              className={btnStyle('secondary')}
              aria-label="刷新"
            >
              🔄 刷新
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ai')}
              className={btnStyle('secondary')}
              aria-label="AI 分析"
            >
              🤖 AI 分析
            </button>
            <button
              type="button"
              onClick={onClose}
              className={cn(btnStyle('ghost'), 'text-2xl')}
              aria-label="关闭"
            >
              &times;
            </button>
          </>
        }
      />
      {/* 学生概要信息条 */}
      <div className="flex items-center gap-2 px-6 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-surface-tertiary/50">
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
            reloadProfileData()
            onRefresh()
            setActionMsgAuto('事件已添加')
          }}
        />
      )}

      {/* 选项卡导航 */}
      <div className="flex border-b border-gray-200 dark:border-white/[0.06] px-4 bg-gray-50/50 dark:bg-surface-tertiary/50">
        {STUDENT_PROFILE_TABS.map((tab) => (
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
            <tab.icon className="mr-1.5 inline-block h-4 w-4 align-[-2px]" aria-hidden />
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
          <ProfileTab
            student={student}
            profileData={profileData}
            onUpdate={() => reloadProfileData()}
          />
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
              reloadProfileData()
              onRefresh()
            }}
          />
        )}
        {activeTab === 'academics' && <AcademicsTab studentName={student.name} isDark={isDark} />}
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
