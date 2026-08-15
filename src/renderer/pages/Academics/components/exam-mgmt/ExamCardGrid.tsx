// =============================================================
// 考试卡片网格 — 空状态 + 考试卡片列表 (日期/学期/范围/科目/删除)
// =============================================================

import type { ExamDef, SubjectDef } from '@shared/types'
import { ClipboardList } from 'lucide-react'
import { Badge } from '../../../../components/Badge'
import { Card } from '../../../../components/Card'
import { EmptyState } from '../../../../components/EmptyState'
import { EXAM_TYPE_BADGE, EXAM_TYPE_LABEL } from '../../academics-shared'

interface ExamCardGridProps {
  /** 按日期降序的考试列表 */
  exams: ExamDef[]
  subjects: SubjectDef[]
  onDelete: (exam: ExamDef) => void
}

export function ExamCardGrid({ exams, subjects, onDelete }: ExamCardGridProps) {
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
              <button
                type="button"
                onClick={() => onDelete(exam)}
                className="text-red-400 hover:text-red-600 dark:hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                title="删除考试"
              >
                🗑 删除
              </button>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
