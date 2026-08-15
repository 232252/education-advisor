// =============================================================
// 学生档案组件 — 多选项卡详细视图
// 选项卡: 概览 | 档案 | 事件 | 学业 | AI分析
// AI 运行逻辑提取至 hooks/useAgentAnalysis,
// 事件过滤提取至 lib/event-filters
// =============================================================

import type { EAAStudent } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, BookOpen, Bot, ClipboardList, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { useAutoDismiss } from '../../hooks/useAutoDismiss'
import { useTheme } from '../../hooks/useTheme'
import { btnStyle, cn, riskColor } from '../../lib/ui-utils'
import { AddEventInline } from './components'
import { useAgentAnalysis } from './hooks/useAgentAnalysis'
import { useStudentProfileData } from './hooks/useStudentProfileData'
import { type EventScoreFilter, type EventTimeRange, filterEvents } from './lib/event-filters'
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
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  // 数据加载接入 Phase 1 useMultiLoader（替代原 loadAllData + currentNameRef stale guard）
  const {
    score,
    history,
    reasonCodes,
    agents,
    profileData,
    reload: reloadProfileData,
  } = useStudentProfileData(student.name)
  // AI 分析域（agent 选择/运行/保存,合并原 runSelectedAgents/runAllAgents 重复逻辑）
  const {
    aiRunning,
    aiOutput,
    aiMessage,
    aiSaved,
    toggleAgent,
    selectedAgents,
    runSelected,
    runAll,
    saveAiResult,
  } = useAgentAnalysis(student, agents, profileData)
  const [eventFilter, setEventFilter] = useState<EventScoreFilter>('all')
  const [eventTimeRange, setEventTimeRange] = useState<EventTimeRange>('all')
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [actionMsg, setActionMsg] = useState('')
  const setActionMsgAuto = useAutoDismiss<string>(setActionMsg, '')
  // 事件搜索/日期范围状态
  const [searchQuery, setSearchQuery] = useState('')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const theme = useTheme()
  const isDark = theme === 'dark'

  // 过滤: 分数方向 + 时间范围（纯函数提取至 lib/event-filters）
  const filteredEvents = useMemo(
    () => filterEvents(history?.events ?? [], eventFilter, eventTimeRange),
    [history, eventFilter, eventTimeRange],
  )

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
            onRunSelected={runSelected}
            onRunAll={runAll}
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
