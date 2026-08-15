// =============================================================
// 新建考试表单卡 — 名称/类型/日期/学期/范围 + 科目选择 + 确认/取消
// 受控组件: 表单状态与动作由 ../hooks/useExamManagement.ts 维护
// =============================================================

import type { ExamType, SubjectDef } from '@shared/types'
import { Check } from 'lucide-react'
import { Button } from '../../../../components/Button'
import { Card } from '../../../../components/Card'
import { btnStyle, cn, INPUT_BASE } from '../../../../lib/ui-utils'

interface CreateExamFormCardProps {
  subjects: SubjectDef[]
  examTypes: Array<{ value: ExamType; label: string }>
  formName: string
  onFormNameChange: (value: string) => void
  formType: ExamType
  onFormTypeChange: (value: ExamType) => void
  formDate: string
  onFormDateChange: (value: string) => void
  formSemester: string
  onFormSemesterChange: (value: string) => void
  formScope: string
  onFormScopeChange: (value: string) => void
  formSubjects: Set<string>
  onToggleSubject: (subjectId: string) => void
  onSelectAllSubjects: () => void
  onClearSubjects: () => void
  creating: boolean
  onCreate: () => void
  onCancel: () => void
}

export function CreateExamFormCard({
  subjects,
  examTypes,
  formName,
  onFormNameChange,
  formType,
  onFormTypeChange,
  formDate,
  onFormDateChange,
  formSemester,
  onFormSemesterChange,
  formScope,
  onFormScopeChange,
  formSubjects,
  onToggleSubject,
  onSelectAllSubjects,
  onClearSubjects,
  creating,
  onCreate,
  onCancel,
}: CreateExamFormCardProps) {
  return (
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
            onChange={(e) => onFormNameChange(e.target.value)}
            placeholder="如: 2025年期中考试"
            className={cn(INPUT_BASE, 'w-full')}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">考试类型</label>
          <select
            value={formType}
            onChange={(e) => onFormTypeChange(e.target.value as ExamType)}
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
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">考试日期</label>
          <input
            type="date"
            value={formDate}
            onChange={(e) => onFormDateChange(e.target.value)}
            className={cn(INPUT_BASE, 'w-full')}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">学期</label>
          <input
            type="text"
            value={formSemester}
            onChange={(e) => onFormSemesterChange(e.target.value)}
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
            onChange={(e) => onFormScopeChange(e.target.value)}
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
              onClick={onSelectAllSubjects}
              className="text-xs text-blue-500 hover:text-blue-600"
            >
              全选
            </button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button
              type="button"
              onClick={onClearSubjects}
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
              onClick={() => onToggleSubject(sub.id)}
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
        <Button
          variant="success"
          size="lg"
          loading={creating}
          icon={!creating ? <Check className="h-4 w-4" /> : undefined}
          onClick={onCreate}
        >
          {creating ? '创建中...' : '确认创建'}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-sm px-3"
        >
          取消
        </button>
      </div>
    </Card>
  )
}
