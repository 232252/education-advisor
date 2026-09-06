// =============================================================
// 成绩录入表公共骨架 — 卡头(标题+保存按钮)/输入格/行样式
// SingleSubjectTable(学生×成绩) 与 AllSubjectsTable(科目×成绩)
// 的逐字重复块收敛于此,两表仅 tbody 行映射不同。
// =============================================================

import { Save } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../../../components/Button'
import { Card } from '../../../../components/Card'
import { useT } from '../../../../i18n'

/** 表格行样式(两表一致) */
export const GRADE_ROW_CLASS =
  'border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]'

/** 名称/科目列样式(两表一致) */
export const GRADE_NAME_TD_CLASS = 'py-2 px-3 font-medium text-gray-700 dark:text-gray-200'

/** 成绩录入表外壳: 卡头(标题+保存按钮) + 横滚容器,tbody 由调用方给行映射 */
export function GradeEntryTableShell({
  title,
  saving,
  onSave,
  children,
}: {
  title: string
  saving: boolean
  onSave: () => void
  children: ReactNode
}) {
  const { t } = useT()
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h4>
        <Button
          variant="success"
          size="sm"
          loading={saving}
          icon={!saving ? <Save className="h-3.5 w-3.5" /> : undefined}
          onClick={onSave}
        >
          {saving
            ? t('page.academics.entry.saving', '保存中...')
            : t('page.academics.entry.saveGrades', '保存成绩')}
        </Button>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  )
}

const CELL_TD_CLASS = 'py-2 px-3 text-center'
const INPUT_BASE_CLASS =
  'text-center bg-gray-50 dark:bg-surface-primary border border-gray-200 dark:border-white/[0.06] rounded px-2 py-1 text-sm focus:outline-none focus:border-blue-500'

/** 成绩输入格: 0..满分,步进 0.5,空值占位 '-' */
export function ScoreCell({
  value,
  max,
  onChange,
}: {
  value: string
  max?: number
  onChange: (v: string) => void
}) {
  return (
    <td className={CELL_TD_CLASS}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="-"
        min="0"
        max={max}
        step="0.5"
        className={`${INPUT_BASE_CLASS} w-20`}
      />
    </td>
  )
}

/** 班级排名输入格: ≥1 整数,空值占位 '-' */
export function RankCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <td className={CELL_TD_CLASS}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="-"
        min="1"
        className={`${INPUT_BASE_CLASS} w-16`}
      />
    </td>
  )
}
