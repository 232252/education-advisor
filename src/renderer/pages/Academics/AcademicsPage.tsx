// =============================================================
// 学业管理页面 — 学生选择器 + 成绩总览 + 考试管理 + 成绩录入
// 独立页面, 非学生档案内的 Tab
//
// 4 个 Tab 组件已抽出到 ./tabs/ 目录:
//   - CompareTab / OverviewTab / ExamManagementTab / GradeEntryTab
// 多 Tab 共享的常量与纯函数位于 ./academics-shared.ts
// 初始并行加载封装在 ./hooks/useAcademicsData.ts (基于 useMultiLoader)
// 本文件仅保留: 主页面专属常量(DEFAULT_SUBJECTS/DEFAULT_EXAM_TYPES/TAB_LIST)
//              + 主 AcademicsPage 组件
// =============================================================

import type { ExamType, GradeRecord, SubjectDef } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  BarChart3,
  ClipboardList,
  GraduationCap,
  PencilLine,
  Search,
  TrendingUp,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/Skeleton'
import { useTabs } from '../../hooks/useTabs'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../lib/ui-utils'
import { useAcademicsData } from './hooks/useAcademicsData'
import { CompareTab, ExamManagementTab, GradeEntryTab, OverviewTab } from './tabs'

// =============================================================
// 模块级常量 — 避免每次渲染重建引用破坏 useMemo
// =============================================================

/** 默认科目集 (config 缺失时使用) — 覆盖全部 10 个科目 */
const DEFAULT_SUBJECTS: SubjectDef[] = [
  { id: 'chinese', name: '语文', category: 'core', fullMark: 150, isCore: true },
  { id: 'math', name: '数学', category: 'core', fullMark: 150, isCore: true },
  { id: 'english', name: '英语', category: 'core', fullMark: 150, isCore: true },
  { id: 'physics', name: '物理', category: 'science', fullMark: 100 },
  { id: 'chemistry', name: '化学', category: 'science', fullMark: 100 },
  { id: 'biology', name: '生物', category: 'science', fullMark: 100 },
  { id: 'politics', name: '政治', category: 'arts', fullMark: 100 },
  { id: 'history', name: '历史', category: 'arts', fullMark: 100 },
  { id: 'geography', name: '地理', category: 'arts', fullMark: 100 },
  { id: 'pe', name: '体育', category: 'pe', fullMark: 100 },
]

/** 默认考试类型 — 与 ExamType 一一对应 */
const DEFAULT_EXAM_TYPES: Array<{ value: ExamType; label: string }> = [
  { value: 'monthly', label: '月考' },
  { value: 'midterm', label: '期中' },
  { value: 'final', label: '期末' },
  { value: 'test', label: '平时测试' },
  { value: 'quiz', label: '随堂测验' },
  { value: 'mock', label: '模拟考试' },
  { value: 'other', label: '其他' },
]

// =============================================================
// 主组件
// =============================================================

type AcademicsTab = 'overview' | 'exams' | 'entry' | 'compare'

const TAB_LIST: Array<{ id: AcademicsTab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: '成绩总览', icon: BarChart3 },
  { id: 'exams', label: '考试管理', icon: ClipboardList },
  { id: 'entry', label: '成绩录入', icon: PencilLine },
  { id: 'compare', label: '成绩对比', icon: TrendingUp },
]

export function AcademicsPage() {
  const { t } = useT()

  // ===== 初始并行加载 (students / classList / config / exams) =====
  const { data: initialData, loading, reload } = useAcademicsData()
  const { students, classList, config, exams } = initialData

  // ===== 本地状态 =====
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null)
  const [grades, setGrades] = useState<GradeRecord[]>([])
  const [gradesLoading, setGradesLoading] = useState(false)
  // 原页面不持久化 activeTab (无 localStorage)，因此不传 storageKey
  const { active: activeTab, setActive: setActiveTab } = useTabs<AcademicsTab>('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [classFilter, setClassFilter] = useState<string>('__ALL__')
  const [semesterFilter, setSemesterFilter] = useState<string>('__ALL__')

  // ===== 派生数据 =====

  /** 当前使用的科目列表 (config 优先, 否则用默认) */
  const subjects = useMemo<SubjectDef[]>(
    () => (config?.subjects?.length ? config.subjects : DEFAULT_SUBJECTS),
    [config],
  )

  /** 当前使用的考试类型列表 */
  const examTypes = useMemo(
    () => (config?.defaultExamTypes?.length ? config.defaultExamTypes : DEFAULT_EXAM_TYPES),
    [config],
  )

  /** 科目 ID → SubjectDef 映射 */
  const subjectMap = useMemo(() => {
    const m: Record<string, SubjectDef> = {}
    for (const s of subjects) m[s.id] = s
    return m
  }, [subjects])

  /** 过滤后的学生列表 (按班级 + 搜索词) */
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let list = students.filter((s) => s.status !== 'Deleted')
    // 班级筛选
    if (classFilter === '__NONE__') {
      list = list.filter((s) => !s.class_id)
    } else if (classFilter !== '__ALL__') {
      list = list.filter((s) => s.class_id === classFilter)
    }
    if (q) {
      list = list.filter((s) => s.name.toLowerCase().includes(q))
    }
    // 按姓名排序, 便于查找
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }, [students, searchQuery, classFilter])

  /** 班级 ID → 班级名称 */
  const classIdToName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of classList) m[c.class_id] = c.name
    return m
  }, [classList])

  /** 活跃班级列表 (未存档) */
  const activeClassList = useMemo(() => classList.filter((c) => !c.archived), [classList])

  /** 学期列表 (从 exams 中提取去重) */
  const semesterList = useMemo(() => {
    const set = new Set<string>()
    for (const e of exams) if (e.semester) set.add(e.semester)
    return Array.from(set).sort().reverse()
  }, [exams])

  /** 按学期过滤后的考试列表 */
  const filteredExams = useMemo(() => {
    if (semesterFilter === '__ALL__') return exams
    return exams.filter((e) => e.semester === semesterFilter)
  }, [exams, semesterFilter])

  /** 当前选中学生对象 */
  const selectedStudentObj = useMemo(
    () => students.find((s) => s.name === selectedStudent) ?? null,
    [students, selectedStudent],
  )

  // ===== 数据加载 =====

  // loadGrades 单独维护：依赖 selectedStudent，按需触发，不并入初始并行加载
  const loadGrades = useCallback(async (studentName: string) => {
    if (!studentName) {
      setGrades([])
      return
    }
    setGradesLoading(true)
    try {
      const res = await getAPI().academic.getGrades(studentName)
      if (res.success && res.data) {
        setGrades(res.data)
      } else {
        setGrades([])
      }
    } catch (err) {
      console.warn('[Academics] Failed to load grades:', err)
      setGrades([])
    } finally {
      setGradesLoading(false)
    }
  }, [])

  // 默认选中第一个学生 — 原 loadInitialData 在每次成功拉取学生列表后均会重置选择,
  // 此处用 useEffect 监听 students 保持一致行为
  useEffect(() => {
    if (students.length > 0) setSelectedStudent(students[0].name)
  }, [students])

  // 学生切换时重新加载成绩
  useEffect(() => {
    if (selectedStudent) loadGrades(selectedStudent)
    else setGrades([])
  }, [selectedStudent, loadGrades])

  // ===== 事件处理 =====

  const handleSelectStudent = useCallback(
    (name: string) => {
      setSelectedStudent(name)
      setActiveTab('overview')
    },
    [setActiveTab],
  )

  const handleRefreshExams = useCallback(async () => {
    // 局部刷新 exams：用于"考试管理/成绩录入"中创建考试后的回调。
    // exams 来自 useAcademicsData 的派生数据（不可直接 setState），
    // 触发整体 reload 由 useMultiLoader 重新拉取并刷新派生数据；
    // unwrapExams 内部已调用 listExams，无需重复请求。
    try {
      reload()
    } catch (err) {
      console.warn('[Academics] Refresh exams failed:', err)
    }
  }, [reload])

  const handleRefreshGrades = useCallback(() => {
    if (selectedStudent) loadGrades(selectedStudent)
  }, [selectedStudent, loadGrades])

  if (loading) {
    return <PageSkeleton />
  }

  return (
    <div className="flex h-full bg-canvas">
      {/* ===== 左侧: 学生列表 ===== */}
      <aside className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary flex flex-col">
        <div className="p-3 border-b border-gray-200 dark:border-white/[0.06]">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2 flex items-center gap-1.5">
            <Users size={16} className="text-gray-400 dark:text-gray-500" />
            <span>学生列表</span>
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 font-normal">
              {filteredStudents.length}
            </span>
          </h2>
          <div className="space-y-2">
            {/* 班级筛选 */}
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className={cn('w-full', INPUT_BASE)}
              title="按班级筛选"
            >
              <option value="__ALL__">全部班级</option>
              <option value="__NONE__">未分班</option>
              {activeClassList.map((c) => (
                <option key={c.class_id} value={c.class_id}>
                  {c.name}
                </option>
              ))}
            </select>
            {/* 搜索 */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索学生..."
                className={cn('w-full', INPUT_BASE, 'pl-8')}
              />
              <Search
                size={16}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredStudents.length === 0 ? (
            <EmptyState
              icon={<GraduationCap size={28} />}
              title={searchQuery || classFilter !== '__ALL__' ? '未找到匹配的学生' : '暂无学生'}
              className="py-12"
            />
          ) : (
            filteredStudents.map((s) => {
              const clsName = s.class_id ? (classIdToName[s.class_id] ?? null) : null
              return (
                <button
                  type="button"
                  key={s.entity_id}
                  onClick={() => handleSelectStudent(s.name)}
                  className={cn(
                    'w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors border-l-2',
                    selectedStudent === s.name
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 text-blue-700 dark:text-blue-300 font-medium'
                      : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/[0.04] text-gray-700 dark:text-gray-300',
                  )}
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                    {s.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{s.name}</div>
                    {clsName && (
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {clsName}
                      </div>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* ===== 右侧: 学业详情 ===== */}
      <main className="flex-1 overflow-y-auto">
        {/* 头部 */}
        <PageHeader
          title={t('page.academics.title', '学业管理')}
          subtitle={
            selectedStudentObj ? `当前学生: ${selectedStudentObj.name}` : '请从左侧选择学生'
          }
          size="md"
          sticky
          actions={
            <>
              {/* 学期筛选 */}
              <select
                value={semesterFilter}
                onChange={(e) => setSemesterFilter(e.target.value)}
                className={INPUT_BASE}
                title="按学期筛选考试"
                aria-label="按学期筛选考试"
              >
                <option value="__ALL__">全部学期</option>
                {semesterList.map((sem) => (
                  <option key={sem} value={sem}>
                    {sem}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={reload}
                className={btnStyle('secondary')}
                aria-label="刷新考试列表"
              >
                🔄 刷新
              </button>
            </>
          }
        />

        {/* Tab 导航 */}
        <div className="flex gap-1 px-6 py-2 border-b border-gray-200 dark:border-white/[0.06]">
          {TAB_LIST.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-4 py-2 text-sm border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300',
              )}
            >
              <tab.icon className="mr-1.5 inline-block h-4 w-4 align-[-2px]" aria-hidden />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 内容 */}
        <div className="p-6">
          {/* compare tab 是全班对比功能,不依赖 selectedStudent;exams tab 也独立 */}
          {!selectedStudent && activeTab !== 'exams' && activeTab !== 'compare' ? (
            <EmptyState
              icon={<ArrowLeft size={28} />}
              title="请先选择学生"
              description="从左侧学生列表中选择一个学生以查看学业详情"
            />
          ) : activeTab === 'overview' ? (
            <OverviewTab
              studentName={selectedStudent ?? ''}
              subjects={subjects}
              exams={filteredExams}
              grades={grades}
              gradesLoading={gradesLoading}
            />
          ) : activeTab === 'exams' ? (
            <ExamManagementTab
              subjects={subjects}
              examTypes={examTypes}
              exams={exams}
              onRefresh={handleRefreshExams}
            />
          ) : activeTab === 'compare' ? (
            <CompareTab
              students={students}
              classList={classList}
              subjects={subjects}
              exams={exams}
            />
          ) : (
            <GradeEntryTab
              studentName={selectedStudent ?? ''}
              students={students}
              subjects={subjects}
              subjectMap={subjectMap}
              exams={filteredExams}
              examTypes={examTypes}
              currentGrades={grades}
              onSaved={handleRefreshGrades}
              onExamCreated={handleRefreshExams}
            />
          )}
        </div>
      </main>
    </div>
  )
}
