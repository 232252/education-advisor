// =============================================================
// 成绩总览 Tab — 编排: 3 个图表卡 + 成绩明细表
// 图表 UI 与 option 构造在 ../components/overview/,
// 纯计算在 ../lib/academics-metrics.ts
// =============================================================

import type { ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { BookOpen } from 'lucide-react'
import { useMemo } from 'react'
import { EmptyState } from '../../../components/EmptyState'
import { TabStateBoundary } from '../../../components/TabStateBoundary'
import { useT } from '../../../i18n'
import {
  buildGradeTableData,
  filterExamsWithGrades,
  mergeExamSubjects,
} from '../../../lib/academics'
import {
  GradeTableCard,
  LatestRadarChartCard,
  SubjectAvgChartCard,
  TrendChartCard,
} from '../components/overview'
import { StudentJumpBar } from '../components/StudentJumpBar'

interface OverviewTabProps {
  studentName: string
  /** 学生所属班级 id(考试带班级且不一致时不列为该生考试) */
  studentClassId?: string | null
  /** 用于跳转学生档案 / AI 分析 */
  entityId?: string
  subjects: SubjectDef[]
  exams: ExamDef[]
  grades: GradeRecord[]
  gradesLoading: boolean
  /** 成绩加载失败信息;非空时显示错误态而非"暂无成绩"空态 */
  gradesError?: string | null
  /** 错误态下的重试回调 */
  onRetry?: () => void
  /** 删除该生某场考试的全部成绩(清幽灵成绩;组件内已两段式确认) */
  onRemoveExamGrades?: (examId: string) => Promise<boolean>
}

export function OverviewTab({
  studentName,
  studentClassId,
  entityId,
  subjects,
  exams,
  grades,
  gradesLoading,
  gradesError,
  onRetry,
  onRemoveExamGrades,
}: OverviewTabProps) {
  const { t } = useT()

  /** 该生实际参加的考试 (按日期升序;纯缺考占位与非本班考试不列) */
  const sortedExamsWithGrades = useMemo(
    () => filterExamsWithGrades(exams, grades, studentClassId),
    [exams, grades, studentClassId],
  )

  /**
   * 目录科目补齐: 该生考试里的目录外科目(如 AI 导入的「通用技术」)
   * 追加为临时科目,否则明细表/图表按目录建列,有成绩也显示不出来。
   */
  const effectiveSubjects = useMemo(
    () => mergeExamSubjects(subjects, sortedExamsWithGrades, grades),
    [subjects, sortedExamsWithGrades, grades],
  )

  /** 成绩表数据 — 按考试日期降序 */
  const gradeTableData = useMemo(
    () => buildGradeTableData(sortedExamsWithGrades, grades, effectiveSubjects),
    [sortedExamsWithGrades, grades, effectiveSubjects],
  )

  return (
    <div className="space-y-4">
      {entityId && <StudentJumpBar entityId={entityId} />}
      <TabStateBoundary
        loading={gradesLoading}
        error={gradesError}
        onRetry={onRetry}
        errorTitle={t('page.academics.overview.loadFailed', '成绩数据加载失败')}
        errorHint={t(
          'page.academics.overview.loadFailedDesc',
          ' — 数据可能存在但未能读取,请重试;若持续失败请检查数据目录或查看日志',
        )}
        skeletonCount={3}
        skeletonClassName="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        {/* 无"实际参加"的考试(含只剩缺考占位/非本班考试的情况)按空态展示 */}
        {sortedExamsWithGrades.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={28} />}
            title={t('page.academics.overview.noGrades', '暂无成绩数据')}
            description={`${studentName}${t(
              'page.academics.overview.noGradesDesc',
              ' 还没有任何成绩记录,请先在"考试管理"中创建考试,然后在"成绩录入"中录入成绩',
            )}`}
          />
        ) : (
          <div className="space-y-4">
            {/* 3 个图表 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 趋势线图 (占两列) */}
              <TrendChartCard
                examsWithGrades={sortedExamsWithGrades}
                subjects={effectiveSubjects}
                grades={grades}
              />
              {/* 科目柱状图 */}
              <SubjectAvgChartCard subjects={effectiveSubjects} grades={grades} />
              {/* 雷达图 */}
              <LatestRadarChartCard
                examsWithGrades={sortedExamsWithGrades}
                subjects={effectiveSubjects}
                grades={grades}
              />
            </div>

            {/* 成绩表 */}
            <GradeTableCard
              tableData={gradeTableData}
              subjects={effectiveSubjects}
              onRemoveExamGrades={
                onRemoveExamGrades ? (examId) => onRemoveExamGrades(examId) : undefined
              }
            />
          </div>
        )}
      </TabStateBoundary>
    </div>
  )
}
