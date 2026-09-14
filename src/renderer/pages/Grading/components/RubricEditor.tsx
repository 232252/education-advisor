// =============================================================
// RubricEditor — 量规(题目/满分/参考答案)编辑器
// 草稿/就绪态可编辑;批改开始后由父组件切换只读展示。
// 受控组件: 值为 RubricQuestion[],onChange 上抛完整数组。
// 「从样卷识别」: 选样卷照片→视觉模型抽题目草稿(主进程无状态调用,
// 不落盘);已有题目时两段式内联确认(同 TaskDetail.confirmDelete),
// 错误内联展示——弹窗 overlay 会盖住页面顶部反馈条。
// =============================================================

import type { ExtractedRubricQuestion } from '@shared/api/grading'
import { questionKind } from '@shared/grading-helpers'
import type { PresetMark, RubricQuestion } from '@shared/types'
import { useState } from 'react'
import { tr, useT } from '../../../i18n'
import { pickFiles } from '../../../lib/dialog'
import { getAPI } from '../../../lib/ipc-client'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'

interface RubricEditorProps {
  value: RubricQuestion[]
  onChange: (next: RubricQuestion[]) => void
}

// 与 PapersTable.IMAGE_FILTERS 同值(域内惯例:本地复制,不跨组件导出)
const IMAGE_FILTERS = [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]

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
  const [extracting, setExtracting] = useState(false)
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [refining, setRefining] = useState(false)
  const [confirmRefine, setConfirmRefine] = useState(false)
  const [refineNotice, setRefineNotice] = useState<string | null>(null)

  const patchQuestion = (id: string, patch: Partial<RubricQuestion>) => {
    onChange(value.map((q) => (q.id === id ? { ...q, ...patch } : q)))
  }

  const patchMarks = (id: string, marks: PresetMark[]) => {
    patchQuestion(id, { presetMarks: marks.length > 0 ? marks : undefined })
  }

  const addMark = (id: string) => {
    const q = value.find((x) => x.id === id)
    patchMarks(id, [...(q?.presetMarks ?? []), { points: -1, note: '' }])
  }

  const updateMark = (id: string, index: number, patch: Partial<PresetMark>) => {
    const q = value.find((x) => x.id === id)
    const marks = [...(q?.presetMarks ?? [])]
    const cur = marks[index]
    if (!cur) return
    marks[index] = { ...cur, ...patch }
    patchMarks(id, marks)
  }

  const removeMark = (id: string, index: number) => {
    const q = value.find((x) => x.id === id)
    patchMarks(
      id,
      (q?.presetMarks ?? []).filter((_, i) => i !== index),
    )
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

  const applyExtracted = (items: ExtractedRubricQuestion[]) => {
    // 整体替换: id 从 q-1 顺排,order 顺序,AI 草稿留空串与手动添加同构
    onChange(
      items.map((it, i) => ({
        id: `q-${i + 1}`,
        title: it.title,
        type: it.type,
        fullMark: it.fullMark,
        referenceAnswer: it.referenceAnswer ?? '',
        order: i + 1,
      })),
    )
  }

  const runExtract = async () => {
    setConfirmOverwrite(false)
    setExtractError(null)
    const paths = await pickFiles({ filters: IMAGE_FILTERS, properties: ['openFile'] })
    if (paths.length === 0) return
    setExtracting(true)
    try {
      const res = await getAPI().grading.extractRubric(paths)
      if (!res.success || !res.data) {
        throw new Error(res.error || t('page.grading.rubric.extractFailed'))
      }
      applyExtracted(res.data)
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : t('page.grading.rubric.extractFailed'))
    } finally {
      setExtracting(false)
    }
  }

  const handleFromPaper = () => {
    setExtractError(null)
    // 已有题目先内联确认覆盖(两段式,同 TaskDetail.confirmDelete 惯例)
    if (value.length > 0 && !confirmOverwrite) {
      setConfirmOverwrite(true)
      return
    }
    void runExtract()
  }

  const runRefine = async () => {
    setConfirmRefine(false)
    setRefineNotice(null)
    setExtractError(null)
    const targets = value.filter(
      (q) => (q.referenceAnswer ?? '').trim().length > 0 && q.title.trim().length > 0,
    )
    if (targets.length === 0) {
      setExtractError(t('page.grading.rubric.refineNoTarget', '请先填写参考答案/评分标准再细化'))
      return
    }
    setRefining(true)
    try {
      const res = await getAPI().grading.refineRubric(value)
      if (!res.success || !res.data) {
        throw new Error(res.error || t('page.grading.rubric.refineFailed', '细化失败'))
      }
      const byId = new Map(res.data.map((r) => [r.id, r.presetMarks]))
      onChange(value.map((q) => (byId.has(q.id) ? { ...q, presetMarks: byId.get(q.id) } : q)))
      setRefineNotice(
        tr('page.grading.rubric.refineDone', {
          n: res.data.length,
          skipped: value.length - res.data.length,
        }),
      )
    } catch (err) {
      setExtractError(
        err instanceof Error ? err.message : t('page.grading.rubric.refineFailed', '细化失败'),
      )
    } finally {
      setRefining(false)
    }
  }

  const handleRefine = () => {
    setRefineNotice(null)
    // 已有评分点将被替换 — 先内联确认(同从样卷识别的两段式惯例)
    if (value.some((q) => (q.presetMarks?.length ?? 0) > 0) && !confirmRefine) {
      setConfirmRefine(true)
      return
    }
    void runRefine()
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
              <select
                value={q.type ?? questionKind(q)}
                onChange={(e) =>
                  patchQuestion(q.id, {
                    type: e.target.value as RubricQuestion['type'],
                  })
                }
                title={t(
                  'page.grading.rubric.kindTitle',
                  '题类：客观题只标✓/✗/得分，主观题才出页边批注',
                )}
                aria-label={t('page.grading.rubric.kindTitle', '题类')}
                className={`${INPUT_BASE} w-24`}
              >
                <option value="subjective">
                  {t('page.grading.rubric.kindSubjective', '主观')}
                </option>
                <option value="objective">{t('page.grading.rubric.kindObjective', '客观')}</option>
              </select>
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
            <div className="space-y-1">
              {(q.presetMarks ?? []).map((m, mi) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 评分点无稳定 id，同题内顺序即身份
                <div key={`${q.id}-m-${mi}`} className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={m.points}
                    step={1}
                    onChange={(e) => updateMark(q.id, mi, { points: Number(e.target.value) })}
                    title={t('page.grading.rubric.markPoints')}
                    aria-label={t('page.grading.rubric.markPoints')}
                    className={`${INPUT_BASE} w-16`}
                  />
                  <input
                    type="text"
                    value={m.note}
                    onChange={(e) => updateMark(q.id, mi, { note: e.target.value })}
                    placeholder={t('page.grading.rubric.markNote')}
                    className={`${INPUT_BASE} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => removeMark(q.id, mi)}
                    className={cn(btnStyle('ghost'), '!px-1.5 text-red-500')}
                    aria-label={t('page.grading.rubric.removeMark')}
                    title={t('page.grading.rubric.removeMark')}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addMark(q.id)}
                className={cn(btnStyle('ghost'), 'text-xs')}
              >
                + {t('page.grading.rubric.addMark')}
              </button>
            </div>
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
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={addQuestion} className={btnStyle('ghost')}>
            + {t('page.grading.rubric.addQuestion')}
          </button>
          <button
            type="button"
            onClick={handleFromPaper}
            disabled={extracting}
            title={t('page.grading.rubric.fromPaperTitle')}
            className={btnStyle('secondary')}
          >
            {extracting ? t('page.grading.rubric.extracting') : t('page.grading.rubric.fromPaper')}
          </button>
          <button
            type="button"
            onClick={handleRefine}
            disabled={refining || value.length === 0}
            title={t(
              'page.grading.rubric.refineTitle',
              '按参考答案为每题生成扣分点（教师可再修改）；需先填写参考答案/评分标准',
            )}
            className={btnStyle('secondary')}
          >
            {refining
              ? t('page.grading.rubric.refining', '细化中…')
              : t('page.grading.rubric.refine', '自动细化评分标准')}
          </button>
          {confirmRefine && !refining && (
            <span className="flex items-center gap-1 text-xs">
              <span className="text-amber-600 dark:text-amber-300">
                {t('page.grading.rubric.refineConfirm', '已手写的评分点将被替换，继续？')}
              </span>
              <button type="button" onClick={() => void runRefine()} className={btnStyle('danger')}>
                {t('common.confirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmRefine(false)}
                className={btnStyle('ghost')}
              >
                {t('common.cancel')}
              </button>
            </span>
          )}
          {confirmOverwrite && !extracting && (
            <span className="flex items-center gap-1 text-xs">
              <span className="text-amber-600 dark:text-amber-300">
                {tr('page.grading.rubric.extractConfirm', { n: value.length })}
              </span>
              <button
                type="button"
                onClick={() => void runExtract()}
                className={btnStyle('danger')}
              >
                {t('page.grading.rubric.extractGo')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOverwrite(false)}
                className={btnStyle('ghost')}
              >
                {t('common.cancel')}
              </button>
            </span>
          )}
        </div>
        {value.length > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t('page.grading.rubric.total')}: {total}
          </span>
        )}
      </div>
      {refineNotice && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-1.5 text-xs text-blue-600 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
          <span className="break-all">{refineNotice}</span>
          <button
            type="button"
            onClick={() => setRefineNotice(null)}
            aria-label={t('common.close')}
            className="shrink-0"
          >
            ×
          </button>
        </div>
      )}
      {extractError && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50/60 px-3 py-1.5 text-xs text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          <span className="break-all">
            {t('page.grading.rubric.extractFailed')}: {extractError}
          </span>
          <button
            type="button"
            onClick={() => setExtractError(null)}
            aria-label={t('common.close')}
            className="shrink-0"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
