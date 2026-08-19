// =============================================================
// 学业管理页面 — 学生选择器 + 成绩总览 + 考试管理 + 成绩录入
// 独立页面, 非学生档案内的 Tab
//
// 4 个 Tab 组件在 ./tabs/ 目录:
//   - CompareTab / OverviewTab / ExamManagementTab / GradeEntryTab
// 本文件为编排层:
//   - 初始并行加载 ./hooks/useAcademicsData.ts (基于 useMultiLoader)
//   - 学生成绩按需加载 ./hooks/useStudentGrades.ts
//   - 左侧学生列表 UI 在 ./components/StudentSidebar.tsx
//   - 过滤/派生纯计算在 ./lib/academics-metrics.ts
//   - 默认科目/考试类型在 ./lib/academics-defaults.ts
//   - 多 Tab 共享的常量与纯函数位于 ./academics-shared.ts
// =============================================================

import type { SubjectDef } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, BarChart3, ClipboardList, PencilLine, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { PageSkeleton } from '../../components/Skeleton'
import { useTabs } from '../../hooks/useTabs'
import { useT } from '../../i18n'
import { buildClassIdToNameMap } from '../../lib/class-utils'
import { btnStyle, cn, INPUT_BASE } from '../../lib/ui-utils'
import { StudentSidebar } from './components/StudentSidebar'
import { useAcademicsData } from './hooks/useAcademicsData'
import { useStudentGrades } from './hooks/useStudentGrades'
import { DEFAULT_EXAM_TYPES, DEFAULT_SUBJECTS } from './lib/academics-defaults'
import { extractSemesters, filterStudents } from './lib/academics-metrics'
import { CompareTab, ExamManagementTab, GradeEntryTab, OverviewTab } from './tabs'

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
  // 原页面不持久化 activeTab (无 localStorage)，因此不传 storageKey
  const { active: activeTab, setActive: setActiveTab } = useTabs<AcademicsTab>('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [classFilter, setClassFilter] = useState<string>('__ALL__')
  const [semesterFilter, setSemesterFilter] = useState<string>('__ALL__')

  // ===== 学生成绩 (依赖 selectedStudent, 按需加载) =====
  const { grades, gradesLoading, gradesError, reloadGrades } = useStudentGrades(selectedStudent)

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
  const filteredStudents = useMemo(
    () => filterStudents(students, classFilter, searchQuery),
    [students, searchQuery, classFilter],
  )

  /** 班级 ID → 班级名称 */
  const classIdToName = useMemo(() => buildClassIdToNameMap(classList), [classList])

  /** 活跃班级列表 (未存档) */
  const activeClassList = useMemo(() => classList.filter((c) => !c.archived), [classList])

  /** 学期列表 (从 exams 中提取去重) */
  const semesterList = useMemo(() => extractSemesters(exams), [exams])

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

  // 默认选中第一个学生 — 原 loadInitialData 在每次成功拉取学生列表后均会重置选择,
  // 此处用 useEffect 监听 students 保持一致行为
  useEffect(() => {
    if (students.length > 0) setSelectedStudent(students[0].name)
  }, [students])

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

  if (loading) {
    return <PageSkeleton />
  }

  return (
    <div className="flex h-full bg-canvas">
      {/* ===== 左侧: 学生列表 ===== */}
      <StudentSidebar
        students={filteredStudents}
        classFilter={classFilter}
        onClassFilterChange={setClassFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        activeClassList={activeClassList}
        classIdToName={classIdToName}
        selectedStudent={selectedStudent}
        onSelectStudent={handleSelectStudent}
      />

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
              gradesError={gradesError}
              onRetry={reloadGrades}
            />
          ) : activeTab === 'exams' ? (
            <ExamManagementTab
              subjects={subjects}
              examTypes={examTypes}
              exams={exams}
              onRefresh={handleRefreshExams}
              students={students}
              classIdToName={classIdToName}
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
              onSaved={reloadGrades}
              onExamCreated={handleRefreshExams}
            />
          )}
        </div>
      </main>
    </div>
  )
}
