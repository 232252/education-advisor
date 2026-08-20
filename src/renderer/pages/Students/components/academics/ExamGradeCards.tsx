// =============================================================
// 各考试成绩卡片网格 — 从 AcademicsTab 提取
// 每张卡片展示单场考试各科分数/满分/班排 与平均分
// =============================================================

import type { ExamDef, GradeRecord } from '@shared/types'
import { useT } from '../../../../i18n'
import { ACADEMIC_SUBJECT_MAP, computeExamAverage } from '../../../../lib/academics'
import { CARD_BASE } from '../../../../lib/ui-utils'

interface ExamGradeCardsProps {
  /** 按日期升序且该学生有成绩的考试 */
  sortedExams: ExamDef[]
  /** examId → GradeRecord[] 分组 */
  gradesByExam: Record<string, GradeRecord[]>
}

export function ExamGradeCards({ sortedExams, gradesByExam }: ExamGradeCardsProps) {
  const { t } = useT()
  return (
    <div className="grid grid-cols-2 gap-3">
      {sortedExams.map((exam) => {
        const examGrades = gradesByExam[exam.id] ?? []
        const avg = computeExamAverage(examGrades)
        return (
          <div key={exam.id} className={`${CARD_BASE} p-4 shadow-sm`}>
            <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3 flex items-center justify-between">
              <span>{exam.name}</span>
              <span className="text-[10px] text-gray-400">{exam.date}</span>
            </h5>
            <div className="space-y-1.5">
              {examGrades.map((g) => (
                <div
                  key={`${g.examId}-${g.subjectId}`}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-gray-600 dark:text-gray-300">
                    {ACADEMIC_SUBJECT_MAP[g.subjectId] ?? g.subjectId}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-gray-700 dark:text-gray-200">
                      {g.score ?? '-'}
                    </span>
                    {g.fullMark != null && (
                      <span className="text-[10px] text-gray-400">/{g.fullMark}</span>
                    )}
                    {g.classRank != null && (
                      <span className="text-[10px] text-blue-500">#{g.classRank}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {examGrades.some((g) => g.score != null) && (
              <div className="mt-3 pt-2 border-t border-gray-100 dark:border-white/[0.06] text-xs text-gray-500 dark:text-gray-400 flex justify-between">
                <span>{t('page.students.academics.avgScore', '平均分')}</span>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                  {avg.toFixed(1)}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
