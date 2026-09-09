// =============================================================
// LabeledControl — 学业模块表单字段的统一外壳
// 左标签(可带必填*/可选标注) + 下方受控控件。
// 收口 CreateExamFormCard / QuickCreateExamCard 中逐字重复的
// 「label + input/select」块,新增考试表单字段直接复用。
// =============================================================

import type { ReactNode } from 'react'
import { useT } from '../../../i18n'

interface LabeledControlProps {
  label: string
  /** 必填标注(红色 *) */
  required?: boolean
  /** 可选标注(灰色 (可选)) */
  optional?: boolean
  children: ReactNode
}

export function LabeledControl({ label, required, optional, children }: LabeledControlProps) {
  const { t } = useT()
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
        {optional && <span className="text-gray-400">({t('common.optional', '可选')})</span>}
      </label>
      {children}
    </div>
  )
}
