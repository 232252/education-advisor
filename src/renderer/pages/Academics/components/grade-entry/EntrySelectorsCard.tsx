// =============================================================
// 录入选择器卡片 — 考试选择/新建 + 科目或学生选择 + 已选考试信息
// =============================================================

import type { EAAStudent, ExamDef, GradeEntryMode, SubjectDef } from '@shared/types'
import { Badge } from '../../../../components/Badge'
import { Card } from '../../../../components/Card'
import { cn, INPUT_BASE } from '../../../../lib/ui-utils'
import { EXAM_TYPE_BADGE, EXAM_TYPE_LABEL } from '../../academics-shared'

interface EntrySelectorsCardProps {
  mode: GradeEntryMode
  sortedExams: ExamDef[]
  selectedExamId: string
  onSelectedExamIdChange: (value: string) => void
  examNameInput: string
  onExamNameInputChange: (value: string) => void
  onOpenQuickCreate: () => void
  selectedSubjectId: string
  onSelectedSubjectIdChange: (value: string) => void
  subjects: SubjectDef[]
  entryStudentName: string
  onEntryStudentNameChange: (value: string) => void
  students: EAAStudent[]
  selectedExam: ExamDef | null
}

export function EntrySelectorsCard({
  mode,
  sortedExams,
  selectedExamId,
  onSelectedExamIdChange,
  examNameInput,
  onExamNameInputChange,
  onOpenQuickCreate,
  selectedSubjectId,
  onSelectedSubjectIdChange,
  subjects,
  entryStudentName,
  onEntryStudentNameChange,
  students,
  selectedExam,
}: EntrySelectorsCardProps) {
  return (
    <Card padding="md">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
            考试 <span className="text-gray-400 text-[10px]">(可选,留空自动创建)</span>
          </label>
          <div className="flex gap-1.5">
            {sortedExams.length > 0 ? (
              <>
                <select
                  value={selectedExamId}
                  onChange={(e) => {
                    onSelectedExamIdChange(e.target.value)
                    onExamNameInputChange('')
                  }}
                  className={cn(INPUT_BASE, 'flex-1')}
                >
                  <option value="">— 不选,直接录入 —</option>
                  {sortedExams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.name} ({exam.date})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={examNameInput}
                  onChange={(e) => {
                    onExamNameInputChange(e.target.value)
                    onSelectedExamIdChange('')
                  }}
                  list="exam-name-suggestions"
                  placeholder="或输入新名称"
                  className={cn(INPUT_BASE, 'flex-1')}
                />
                <datalist id="exam-name-suggestions">
                  {sortedExams.map((exam) => (
                    <option key={exam.id} value={exam.name} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={onOpenQuickCreate}
                  className="flex-shrink-0 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 px-2.5 rounded-lg text-sm transition-colors border border-blue-200 dark:border-blue-800"
                  title="快速创建考试(设置类型/日期)"
                >
                  +
                </button>
              </>
            ) : (
              <input
                type="text"
                value={examNameInput}
                onChange={(e) => onExamNameInputChange(e.target.value)}
                placeholder="输入考试名称(可选),留空保存时自动创建"
                className="flex-1 bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            )}
          </div>
        </div>

        {mode === 'single-subject' ? (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              科目 <span className="text-red-500">*</span>
            </label>
            <select
              value={selectedSubjectId}
              onChange={(e) => onSelectedSubjectIdChange(e.target.value)}
              className={cn(INPUT_BASE, 'w-full')}
            >
              <option value="">请选择科目...</option>
              {subjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name} (满分 {sub.fullMark})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
              学生 <span className="text-red-500">*</span>
            </label>
            <select
              value={entryStudentName}
              onChange={(e) => onEntryStudentNameChange(e.target.value)}
              className={cn(INPUT_BASE, 'w-full')}
            >
              <option value="">请选择学生...</option>
              {students
                .filter((s) => s.status !== 'Deleted')
                .map((s) => (
                  <option key={s.entity_id} value={s.name}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
        )}

        <div className="flex items-end">
          {selectedExam && (
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
              <div>
                类型:{' '}
                <Badge variant={EXAM_TYPE_BADGE[selectedExam.type]}>
                  {EXAM_TYPE_LABEL[selectedExam.type]}
                </Badge>
              </div>
              <div>学期: {selectedExam.semester}</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
