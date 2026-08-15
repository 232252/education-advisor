// =============================================================
// 成绩对比 Tab — 编排: 选两场考试,对比全班学生的分数/名次/操行分变化
// 状态与数据加载在 ../hooks/useCompareData.ts,
// UI 块在 ../components/compare/,对比核心算法在 ../exam-comparison.ts
// =============================================================

import type { ClassEntity, EAAStudent, ExamDef, SubjectDef } from '@shared/types'
import { Inbox, TrendingUp } from 'lucide-react'
import { EmptyState } from '../../../components/EmptyState'
import { CardSkeleton } from '../../../components/Skeleton'
import {
  CompareSelectorBar,
  ComparisonSummaryCards,
  StudentComparisonTable,
  SubjectDeltaChartCard,
} from '../components/compare'
import { useCompareData } from '../hooks/useCompareData'

export interface CompareTabProps {
  students: EAAStudent[]
  classList: ClassEntity[]
  subjects: SubjectDef[]
  exams: ExamDef[]
}

export function CompareTab({ students, classList, subjects, exams }: CompareTabProps) {
  const {
    classFilter,
    setClassFilter,
    examAId,
    setExamAId,
    examBId,
    setExamBId,
    sortedExams,
    targetStudentNames,
    loading,
    studentComparisons,
    summary,
    canCompare,
  } = useCompareData({ students, subjects, exams })

  return (
    <div className="space-y-4">
      {/* 选择器栏 */}
      <CompareSelectorBar
        classFilter={classFilter}
        onClassFilterChange={setClassFilter}
        examAId={examAId}
        onExamAIdChange={setExamAId}
        examBId={examBId}
        onExamBIdChange={setExamBId}
        classList={classList}
        sortedExams={sortedExams}
        studentCount={targetStudentNames.length}
      />

      {loading ? (
        <CardSkeleton />
      ) : !canCompare ? (
        <EmptyState
          icon={<TrendingUp size={28} />}
          title="选择两场考试进行对比"
          description={
            sortedExams.length < 2
              ? '至少需要 2 场考试才能对比'
              : examAId === examBId && examAId
                ? '请选择两场不同的考试'
                : '从上方选择班级和两场考试'
          }
        />
      ) : studentComparisons.length === 0 ? (
        <EmptyState
          icon={<Inbox size={28} />}
          title="暂无对比数据"
          description="所选班级在两次考试中均无成绩记录"
        />
      ) : (
        <>
          {/* 汇总卡片 */}
          {summary && <ComparisonSummaryCards summary={summary} />}

          {/* 科目平均变化柱状图 */}
          {summary && summary.subjectDeltas.length > 0 && (
            <SubjectDeltaChartCard subjectDeltas={summary.subjectDeltas} />
          )}

          {/* 学生对比表 */}
          <StudentComparisonTable studentComparisons={studentComparisons} />
        </>
      )}
    </div>
  )
}
