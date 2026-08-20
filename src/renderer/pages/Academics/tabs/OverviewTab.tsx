// =============================================================
// 成绩总览 Tab — 编排: 3 个图表卡 + 成绩明细表
// 图表 UI 与 option 构造在 ../components/overview/,
// 纯计算在 ../lib/academics-metrics.ts
// =============================================================

import type { ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { AlertTriangle, BookOpen, RotateCw } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '../../../components/Button'
import { EmptyState } from '../../../components/EmptyState'
import { CardSkeleton } from '../../../components/Skeleton'
import { useT } from '../../../i18n'
import { buildGradeTableData, filterExamsWithGrades } from '../../../lib/academics'
import {
  GradeTableCard,
  LatestRadarChartCard,
  SubjectAvgChartCard,
  TrendChartCard,
} from '../components/overview'

export interface OverviewTabProps {
  studentName: string
  subjects: SubjectDef[]
  exams: ExamDef[]
  grades: GradeRecord[]
  gradesLoading: boolean
  /** 成绩加载失败信息;非空时显示错误态而非"暂无成绩"空态 */
  gradesError?: string | null
  /** 错误态下的重试回调 */
  onRetry?: () => void
}

export function OverviewTab({
  studentName,
  subjects,
  exams,
  grades,
  gradesLoading,
  gradesError,
  onRetry,
}: OverviewTabProps) {
  const { t } = useT()

  /** 与成绩记录关联的有效考试 (按日期升序) */
  const sortedExamsWithGrades = useMemo(() => filterExamsWithGrades(exams, grades), [exams, grades])

  /** 成绩表数据 — 按考试日期降序 */
  const gradeTableData = useMemo(
    () => buildGradeTableData(sortedExamsWithGrades, grades, subjects),
    [sortedExamsWithGrades, grades, subjects],
  )

  if (gradesLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
  }

  if (gradesError) {
    return (
      <EmptyState
        icon={<AlertTriangle size={28} />}
        title={t('page.academics.overview.loadFailed', '成绩数据加载失败')}
        description={`${gradesError}${t(
          'page.academics.overview.loadFailedDesc',
          ' — 数据可能存在但未能读取,请重试;若持续失败请检查数据目录或查看日志',
        )}`}
        action={
          onRetry ? (
            <Button onClick={onRetry} icon={<RotateCw size={14} aria-hidden />}>
              {t('common.retry', '重试')}
            </Button>
          ) : undefined
        }
      />
    )
  }

  if (grades.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title={t('page.academics.overview.noGrades', '暂无成绩数据')}
        description={`${studentName}${t(
          'page.academics.overview.noGradesDesc',
          ' 还没有任何成绩记录,请先在"考试管理"中创建考试,然后在"成绩录入"中录入成绩',
        )}`}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 3 个图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 趋势线图 (占两列) */}
        <TrendChartCard
          examsWithGrades={sortedExamsWithGrades}
          subjects={subjects}
          grades={grades}
        />
        {/* 科目柱状图 */}
        <SubjectAvgChartCard subjects={subjects} grades={grades} />
        {/* 雷达图 */}
        <LatestRadarChartCard
          examsWithGrades={sortedExamsWithGrades}
          subjects={subjects}
          grades={grades}
        />
      </div>

      {/* 成绩表 */}
      <GradeTableCard tableData={gradeTableData} subjects={subjects} />
    </div>
  )
}
