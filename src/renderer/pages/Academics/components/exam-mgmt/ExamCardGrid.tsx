// =============================================================
// 考试卡片网格 — 空状态 + 考试卡片列表 (日期/学期/范围/科目/删除)
// =============================================================

import type { ExamDef, SubjectDef } from '@shared/types'
import { ClipboardList, Printer } from 'lucide-react'
import { Badge } from '../../../../components/Badge'
import { Card } from '../../../../components/Card'
import { EmptyState } from '../../../../components/EmptyState'
import { EXAM_TYPE_BADGE, EXAM_TYPE_LABEL } from '../../academics-shared'

interface ExamCardGridProps {
  /** 按日期降序的考试列表 */
  exams: ExamDef[]
  subjects: SubjectDef[]
  onDelete: (exam: ExamDef) => void
  /** 打印该考试的班级成绩单 */
  onPrintSheet: (exam: ExamDef) => void
  /** 成绩单数据加载中(禁用打印按钮) */
  printLoading?: boolean
}

export function ExamCardGrid({
  exams,
  subjects,
  onDelete,
  onPrintSheet,
  printLoading = false,
}: ExamCardGridProps) {
  if (exams.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList size={28} />}
        title="暂无考试"
        description={'点击右上角「创建考试」按钮添加第一场考试'}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {exams.map((exam) => {
        const examSubjects = exam.subjects
          .map((sid) => subjects.find((s) => s.id === sid)?.name)
          .filter(Boolean)
        return (
          <Card key={exam.id} padding="md">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">
                    {exam.name}
                  </h4>
                  <Badge variant={EXAM_TYPE_BADGE[exam.type]}>{EXAM_TYPE_LABEL[exam.type]}</Badge>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                  <div>📅 {exam.date}</div>
                  <div>📚 学期: {exam.semester}</div>
                  {exam.scope && <div>📖 范围: {exam.scope}</div>}
                  <div>
                    📝 科目 ({examSubjects.length}): {examSubjects.join('、') || '无'}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onDelete(exam)}
                  className="text-red-400 hover:text-red-600 dark:hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="删除考试"
                >
                  🗑 删除
                </button>
                <button
                  type="button"
                  onClick={() => onPrintSheet(exam)}
                  disabled={printLoading}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="打印 / 导出 PDF"
                >
                  <Printer size={12} />
                  成绩单
                </button>
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
