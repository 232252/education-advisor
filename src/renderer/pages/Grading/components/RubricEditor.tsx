// =============================================================
// RubricEditor — 量规(题目/满分/参考答案)编辑器
// 草稿/就绪态可编辑;批改开始后由父组件切换只读展示。
// 受控组件: 值为 RubricQuestion[],onChange 上抛完整数组。
// =============================================================

import type { RubricQuestion } from '@shared/types'
import { useT } from '../../../i18n'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'

interface RubricEditorProps {
  value: RubricQuestion[]
  onChange: (next: RubricQuestion[]) => void
}

function nextQuestionId(value: RubricQuestion[]): string {
  let max = 0
  for (const q of value) {
    const m = q.id.match(/^q-(\d+)$/)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `q-${max + 1}`
}

export function RubricEditor({ value, onChange }: RubricEditorProps) {
  const { t } = useT()

  const patchQuestion = (id: string, patch: Partial<RubricQuestion>) => {
    onChange(value.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const addQuestion = () => {
    onChange([
      ...value,
      {
        id: nextQuestionId(value),
        title: '',
        fullMark: 10,
        referenceAnswer: '',
        order: value.length + 1,
      },
    ])
  }

  const removeQuestion = (id: string) => {
    onChange(value.filter((q) => q.id !== id).map((q, i) => ({ ...q, order: i + 1 })))
  }

  const total = value.reduce((sum, q) => sum + (Number.isFinite(q.fullMark) ? q.fullMark : 0), 0)

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500">{t('page.grading.rubric.empty')}</p>
      )}
      {value.map((q, index) => (
        <div
          key={q.id}
          className="flex items-start gap-2 rounded-lg border border-gray-200 p-2 dark:border-white/10"
        >
          <span className="w-6 pt-1.5 text-center text-xs text-gray-400">{index + 1}</span>
          <div className="flex-1 space-y-1.5">
            <div className="flex gap-2">
              <input
                type="text"
                value={q.title}
                onChange={(e) => patchQuestion(q.id, { title: e.target.value })}
                placeholder={t('page.grading.rubric.titlePlaceholder')}
                className={`${INPUT_BASE} flex-1`}
              />
              <input
                type="number"
                value={q.fullMark}
                min={0}
                step={1}
                onChange={(e) => patchQuestion(q.id, { fullMark: Number(e.target.value) })}
                title={t('page.grading.rubric.fullMark')}
                aria-label={t('page.grading.rubric.fullMark')}
                className={`${INPUT_BASE} w-20`}
              />
            </div>
            <textarea
              value={q.referenceAnswer ?? ''}
              onChange={(e) => patchQuestion(q.id, { referenceAnswer: e.target.value })}
              placeholder={t('page.grading.rubric.referencePlaceholder')}
              rows={2}
              className={`${INPUT_BASE} w-full resize-y`}
            />
          </div>
          <button
            type="button"
            onClick={() => removeQuestion(q.id)}
            className={cn(btnStyle('ghost'), '!px-2 text-red-500')}
            aria-label={t('page.grading.rubric.remove')}
            title={t('page.grading.rubric.remove')}
          >
            ×
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" onClick={addQuestion} className={btnStyle('ghost')}>
          + {t('page.grading.rubric.addQuestion')}
        </button>
        {value.length > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('page.grading.rubric.total')}: {total}
          </span>
        )}
      </div>
    </div>
  )
}
