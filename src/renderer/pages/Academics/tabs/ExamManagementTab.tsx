// =============================================================
// 考试管理 Tab — 考试列表展示 + 创建表单(名称/类型/日期/学期/范围/科目) + 删除确认
// =============================================================

import type { ExamDef, ExamType, SubjectDef } from '@shared/types'
import { ClipboardList } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Badge } from '../../../components/Badge'
import { Card } from '../../../components/Card'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import {
  EXAM_TYPE_BADGE,
  EXAM_TYPE_LABEL,
  getCurrentSemester,
  sortByDateDesc,
} from '../academics-shared'

export interface ExamManagementTabProps {
  subjects: SubjectDef[]
  examTypes: Array<{ value: ExamType; label: string }>
  exams: ExamDef[]
  onRefresh: () => void
}

export function ExamManagementTab({
  subjects,
  examTypes,
  exams,
  onRefresh,
}: ExamManagementTabProps) {
  const { t } = useT()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; exam: ExamDef | null }>({
    open: false,
    exam: null,
  })

  // 创建表单状态
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<ExamType>('monthly')
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10))
  const [formSemester, setFormSemester] = useState(getCurrentSemester())
  const [formScope, setFormScope] = useState('')
  const [formSubjects, setFormSubjects] = useState<Set<string>>(new Set())

  const sortedExams = useMemo(() => sortByDateDesc(exams), [exams])

  const handleToggleSubject = useCallback((subjectId: string) => {
    setFormSubjects((prev) => {
      const next = new Set(prev)
      if (next.has(subjectId)) next.delete(subjectId)
      else next.add(subjectId)
      return next
    })
  }, [])

  const handleSelectAllSubjects = useCallback(() => {
    setFormSubjects(new Set(subjects.map((s) => s.id)))
  }, [subjects])

  const handleClearSubjects = useCallback(() => {
    setFormSubjects(new Set())
  }, [])

  const resetForm = useCallback(() => {
    setFormName('')
    setFormType('monthly')
    setFormDate(new Date().toISOString().slice(0, 10))
    setFormSemester(getCurrentSemester())
    setFormScope('')
    setFormSubjects(new Set())
  }, [])

  const handleCreate = useCallback(async () => {
    if (!formName.trim()) {
      toast.error(t('page.academics.toast.examNameRequired'))
      return
    }
    if (formSubjects.size === 0) {
      toast.error(t('page.academics.toast.atLeastOneSubject'))
      return
    }
    setCreating(true)
    try {
      const res = await getAPI().academic.createExam({
        name: formName.trim(),
        type: formType,
        date: formDate,
        semester: formSemester.trim() || getCurrentSemester(),
        scope: formScope.trim() || undefined,
        subjects: Array.from(formSubjects),
      })
      if (res.success) {
        toast.success(t('page.academics.toast.examCreated'))
        resetForm()
        setShowCreateForm(false)
        onRefresh()
      } else {
        toast.error(getErrorMessage(res, t('page.academics.toast.createFailed')))
      }
    } catch (err) {
      toast.error(
        t('page.academics.toast.createFailedWithError').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    } finally {
      setCreating(false)
    }
  }, [formName, formType, formDate, formSemester, formScope, formSubjects, resetForm, onRefresh, t])

  const handleDelete = useCallback((exam: ExamDef) => {
    setDeleteConfirm({ open: true, exam })
  }, [])

  const executeDelete = useCallback(async () => {
    const exam = deleteConfirm.exam
    setDeleteConfirm({ open: false, exam: null })
    if (!exam) return
    try {
      const res = await getAPI().academic.deleteExam(exam.id)
      if (res.success) {
        toast.success(t('page.academics.toast.examDeleted'))
        onRefresh()
      } else {
        toast.error(res.error ?? t('toast.common.deleteFailed'))
      }
    } catch (err) {
      toast.error(
        t('page.academics.toast.deleteFailedWithError').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      )
    }
  }, [deleteConfirm.exam, onRefresh, t])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">考试列表</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            共 {exams.length} 场考试
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className={btnStyle('primary')}
        >
          {showCreateForm ? '取消' : '+ 创建考试'}
        </button>
      </div>

      {/* 创建表单 */}
      {showCreateForm && (
        <Card padding="md">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-4">新建考试</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                考试名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="如: 2025年期中考试"
                className={cn(INPUT_BASE, 'w-full')}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                考试类型
              </label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as ExamType)}
                className={cn(INPUT_BASE, 'w-full')}
              >
                {examTypes.map((et) => (
                  <option key={et.value} value={et.value}>
                    {et.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                考试日期
              </label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className={cn(INPUT_BASE, 'w-full')}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">学期</label>
              <input
                type="text"
                value={formSemester}
                onChange={(e) => setFormSemester(e.target.value)}
                placeholder="如: 2025-2026-1"
                className={cn(INPUT_BASE, 'w-full')}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                考试范围 (可选)
              </label>
              <input
                type="text"
                value={formScope}
                onChange={(e) => setFormScope(e.target.value)}
                placeholder="如: 第一单元 ~ 第三单元"
                className={cn(INPUT_BASE, 'w-full')}
              />
            </div>
          </div>

          {/* 科目选择 */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 dark:text-gray-400">
                考试科目 <span className="text-red-500">*</span>
                <span className="text-gray-400 ml-1">({formSubjects.size} 已选)</span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllSubjects}
                  className="text-xs text-blue-500 hover:text-blue-600"
                >
                  全选
                </button>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <button
                  type="button"
                  onClick={handleClearSubjects}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  清空
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {subjects.map((sub) => (
                <button
                  type="button"
                  key={sub.id}
                  onClick={() => handleToggleSubject(sub.id)}
                  className={cn(
                    btnStyle(formSubjects.has(sub.id) ? 'primary' : 'secondary'),
                    'text-xs',
                  )}
                >
                  {sub.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 shadow-sm"
            >
              {creating ? '创建中...' : '✓ 确认创建'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm()
                setShowCreateForm(false)
              }}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm px-3"
            >
              取消
            </button>
          </div>
        </Card>
      )}

      {/* 考试列表 */}
      {sortedExams.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={28} />}
          title="暂无考试"
          description={'点击右上角「创建考试」按钮添加第一场考试'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sortedExams.map((exam) => {
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
                      <Badge variant={EXAM_TYPE_BADGE[exam.type]}>
                        {EXAM_TYPE_LABEL[exam.type]}
                      </Badge>
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
                    onClick={() => handleDelete(exam)}
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
      )}

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={deleteConfirm.open}
        title="删除考试"
        message={`确定要删除考试"${deleteConfirm.exam?.name}"吗？相关成绩记录也将被删除,此操作不可恢复。`}
        confirmText="删除"
        variant="danger"
        onConfirm={executeDelete}
        onCancel={() => setDeleteConfirm({ open: false, exam: null })}
      />
    </div>
  )
}
