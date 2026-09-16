// =============================================================
// 学业选项卡 — 从学业模块(academic:* IPC)加载成绩,与 AcademicsPage 联动
// 展示各考试成绩卡片 / 成绩趋势 / 偏科分析 / 考试对比
// 纯计算逻辑提取至 lib/academics-metrics.ts,
// UI 块提取至 components/academics/ 下独立组件
// =============================================================

import type { ExamDef, GradeRecord } from '@shared/types'
import { BookOpen } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/Button'
import { EmptyState } from '../../../components/EmptyState'
import { TabStateBoundary } from '../../../components/TabStateBoundary'
import { useConductEvents, useExamPairSelection } from '../../../hooks/useExamPair'
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { t } from '../../../i18n'
import {
  analyzeSubjects,
  buildComparison,
  buildTrendData,
  filterExamsWithGrades,
  groupGradesByExam,
} from '../../../lib/academics'
import { getAPI } from '../../../lib/ipc-client'
import { ExamCompareCard } from '../components/academics/ExamCompareCard'
import { ExamGradeCards } from '../components/academics/ExamGradeCards'
import { SubjectAnalysisCard } from '../components/academics/SubjectAnalysisCard'
import { TrendChart } from '../components/academics/TrendChart'

export function AcademicsTab({
  studentName,
  entityId,
  studentClassId,
}: {
  studentName: string
  entityId?: string
  /** 学生所属班级 id(考试带班级且不一致时不列为该生考试) */
  studentClassId?: string | null
  // isDark 保留为可选 prop 以维持调用方契约；主题色现由 useChartTheme 内部从 useTheme() 派生
  isDark?: boolean
}) {
  const navigate = useNavigate()
  // 从学业模块加载考试列表和该学生成绩(并行 + stale 防护由 useMultiLoader 提供;
  // fetcher 内解包 IPC 信封,失败抛本地化错误)
  const {
    data,
    loading,
    errors,
    reload: loadData,
  } = useMultiLoader(
    {
      exams: async (): Promise<ExamDef[]> => {
        const r = await getAPI().academic.listExams()
        if (!r.success || !r.data) {
          throw new Error(
            `${t('page.students.academics.examListLoadFailed', '考试列表加载失败')}: ${r.error ?? t('error.unknown', '未知错误')}`,
          )
        }
        return r.data
      },
      grades: async (): Promise<GradeRecord[]> => {
        const r = await getAPI().academic.getGrades(studentName)
        if (!r.success || !r.data) {
          throw new Error(
            `${t('page.students.academics.gradesLoadFailed', '成绩加载失败')}: ${r.error ?? t('error.unknown', '未知错误')}`,
          )
        }
        return r.data
      },
    },
    { deps: [studentName] },
  )
  const exams = data.exams ?? []
  const grades = data.grades ?? []
  /** 考试/成绩加载失败信息;非空时显示错误态,与"暂无成绩"空态区分 */
  const failedMsgs = Object.values(errors).map((e) => e.message)
  const loadError = failedMsgs.length > 0 ? failedMsgs.join(';') : null
  useEffect(() => {
    const msgs = Object.values(errors).map((e) => e.message)
    if (msgs.length > 0) {
      console.warn('[StudentProfile.Academics] Load failed:', msgs)
    }
  }, [errors])

  // 按日期升序排列的考试 (该生实际参加的:纯缺考占位/非本班考试不列)
  const sortedExams = useMemo(
    () => filterExamsWithGrades(exams, grades, studentClassId),
    [exams, grades, studentClassId],
  )

  // 成绩按考试分组: examId → GradeRecord[]
  const gradesByExam = useMemo(() => groupGradesByExam(grades), [grades])

  // 考试对比状态(默认最近两场 + 操行分 range 拉取,实现见 hooks/useExamPair)
  const {
    examAId: compareExamAId,
    setExamAId: setCompareExamAId,
    examBId: compareExamBId,
    setExamBId: setCompareExamBId,
  } = useExamPairSelection(sortedExams)
  const conductEvents = useConductEvents(exams, compareExamAId, compareExamBId, 1000)

  // 计算对比结果(纯函数)
  const comparison = useMemo(
    () => buildComparison(gradesByExam, compareExamAId, compareExamBId, conductEvents, studentName),
    [gradesByExam, compareExamAId, compareExamBId, conductEvents, studentName],
  )

  // 偏科分析: 计算各科目平均分
  const subjectAnalysis = useMemo(() => analyzeSubjects(grades), [grades])

  // 趋势图数据: x轴=考试名, series=各科目分数
  const trendData = useMemo(
    () => buildTrendData(sortedExams, gradesByExam),
    [sortedExams, gradesByExam],
  )

  return (
    <TabStateBoundary
      loading={loading}
      error={loadError}
      onRetry={loadData}
      errorTitle={t('page.students.academics.loadFailed', '学业数据加载失败')}
      errorHint={` — ${t('page.students.academics.loadFailedHint', '数据可能存在但未能读取,请重试;若持续失败请检查数据目录或查看日志')}`}
    >
      {grades.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-6 w-6" />}
          title={t('page.students.academics.empty', '暂无学业成绩')}
          description={t(
            'page.students.academics.emptyHint',
            '请到「学业」页面录入考试成绩,数据将自动同步至此',
          )}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('page.students.academics.title', '学业成绩')}
            </h4>
            <div className="flex items-center gap-2">
              {entityId && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    navigate(`/academics?entity_id=${encodeURIComponent(entityId)}&tab=overview`)
                  }
                >
                  {t('page.students.academics.openManager')}
                </Button>
              )}
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {grades.length} {t('page.students.academics.gradeCount', '条成绩')} ·{' '}
                {sortedExams.length} {t('page.students.academics.examCount', '场考试')}
              </span>
            </div>
          </div>

          {/* 各考试成绩卡片 */}
          <ExamGradeCards sortedExams={sortedExams} gradesByExam={gradesByExam} />

          {/* 成绩趋势图 */}
          {trendData && trendData.series.length > 0 && <TrendChart trendData={trendData} />}

          {/* 偏科分析 */}
          {subjectAnalysis.all.length > 0 && (
            <SubjectAnalysisCard subjectAnalysis={subjectAnalysis} />
          )}

          {/* 考试对比 */}
          {sortedExams.length >= 2 && (
            <ExamCompareCard
              sortedExams={sortedExams}
              compareExamAId={compareExamAId}
              compareExamBId={compareExamBId}
              onCompareExamAChange={setCompareExamAId}
              onCompareExamBChange={setCompareExamBId}
              comparison={comparison}
            />
          )}
        </div>
      )}
    </TabStateBoundary>
  )
}
