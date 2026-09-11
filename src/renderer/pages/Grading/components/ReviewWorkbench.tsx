// =============================================================
// ReviewWorkbench — 教师复核工作台(双栏)
// 左: 试卷扫描件(base64 经 IPC 读取,多页纵排)
// 右: 逐题 AI 得分+依据,教师改分/评语(= grade_override 范式),
//     总评 + 生效总分实时合成(override 优先)。
// =============================================================

import {
  effectiveQuestionScore,
  effectiveTotalScore,
  markScoreFromSelection,
  paperMarkOverlays,
} from '@shared/grading-helpers'
import type { GradingPaper, GradingTask, TeacherReview } from '@shared/types'
import { useEffect, useMemo, useState } from 'react'
import { PaperScanPages } from '../../../components/print/PaperScanPages'
import { tr, useT } from '../../../i18n'
import { btnStyle, cn, INPUT_BASE } from '../../../lib/ui-utils'
import { loadPaperImageUrls } from '../lib/paper-images'

interface ReviewWorkbenchProps {
  task: GradingTask
  paperId: string
  /** 复核序列中可切换的试卷(有 AI 结果的) */
  reviewablePapers: GradingTask['papers']
  onClose: () => void
  onNavigate: (paperId: string) => void
  onSaveReview: (taskId: string, paperId: string, review: TeacherReview) => Promise<boolean>
  onPrintMarks?: (paper: GradingPaper) => void
  printLoading?: boolean
}

export function ReviewWorkbench({
  task,
  paperId,
  reviewablePapers,
  onClose,
  onNavigate,
  onSaveReview,
  onPrintMarks,
  printLoading = false,
}: ReviewWorkbenchProps) {
  const { t } = useT()
  const paper = task.papers.find((p) => p.id === paperId)
  const seqIndex = reviewablePapers.findIndex((p) => p.id === paperId)

  // 改分/评语编辑态(初始 = 已存复核;输入为空 = 沿用 AI 值)
  const [scoreEdits, setScoreEdits] = useState<Record<string, string>>({})
  const [commentEdits, setCommentEdits] = useState<Record<string, string>>({})
  const [selectedMarks, setSelectedMarks] = useState<Record<string, number[]>>({})
  const [overall, setOverall] = useState('')
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // 切换试卷时重置编辑态(已存复核回填)并加载图片
  useEffect(() => {
    const review = paper?.review
    setScoreEdits(
      Object.fromEntries(
        Object.entries(review?.questions ?? {}).map(([qid, o]) => [qid, o.score?.toString() ?? '']),
      ),
    )
    setCommentEdits(
      Object.fromEntries(
        Object.entries(review?.questions ?? {}).map(([qid, o]) => [qid, o.comment ?? '']),
      ),
    )
    setSelectedMarks(
      Object.fromEntries(
        Object.entries(review?.questions ?? {})
          .filter(([, o]) => Array.isArray(o.marks) && o.marks.length > 0)
          .map(([qid, o]) => [qid, o.marks ?? []]),
      ),
    )
    setOverall(review?.overallComment ?? '')
    setImageUrls([])
    if (!paper) return
    let cancelled = false
    void (async () => {
      const urls = await loadPaperImageUrls(task.id, paper)
      if (!cancelled) setImageUrls(urls)
    })()
    return () => {
      cancelled = true
    }
  }, [paper?.id, paper, task.id])

  const draftReview = useMemo<TeacherReview>(() => {
    const questions: TeacherReview['questions'] = {}
    for (const q of task.rubric) {
      const scoreText = scoreEdits[q.id]?.trim()
      const commentText = commentEdits[q.id]?.trim()
      const marks = selectedMarks[q.id]
      if (scoreText !== undefined && scoreText !== '') {
        questions[q.id] = {
          score: Number(scoreText),
          ...(commentText ? { comment: commentText } : {}),
          ...(marks && marks.length > 0 ? { marks } : {}),
        }
      } else if (marks && marks.length > 0) {
        questions[q.id] = {
          score: markScoreFromSelection(q.fullMark, q.presetMarks ?? [], marks),
          ...(commentText ? { comment: commentText } : {}),
          marks,
        }
      } else if (commentText) {
        questions[q.id] = { comment: commentText }
      }
    }
    return { questions, overallComment: overall.trim() || undefined, reviewedAt: '' }
  }, [scoreEdits, commentEdits, selectedMarks, overall, task.rubric])

  const toggleMark = (
    questionId: string,
    index: number,
    fullMark: number,
    marks: (typeof task.rubric)[number]['presetMarks'],
  ) => {
    const preset = marks ?? []
    const cur = selectedMarks[questionId] ?? []
    const next = cur.includes(index)
      ? cur.filter((x) => x !== index)
      : [...cur, index].sort((a, b) => a - b)
    setSelectedMarks((prev) => ({ ...prev, [questionId]: next }))
    setScoreEdits((scores) => ({
      ...scores,
      [questionId]: next.length > 0 ? String(markScoreFromSelection(fullMark, preset, next)) : '',
    }))
  }

  if (!paper?.ai) return null
  // 生效总分(编辑中的草稿口径实时合成)
  const draftPaper = { ...paper, review: { ...draftReview, reviewedAt: new Date().toISOString() } }
  const effectiveTotal = effectiveTotalScore(draftPaper)
  const fullMarkTotal = task.rubric.reduce((s, q) => s + q.fullMark, 0)

  const save = async () => {
    setSaving(true)
    const ok = await onSaveReview(task.id, paper.id, draftReview)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部: 学生 + 导航 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-white/[0.06]">
        <button
          type="button"
          onClick={onClose}
          className={cn(btnStyle('ghost'), '!px-2')}
          aria-label={t('page.grading.review.back')}
        >
          ←
        </button>
        <h2 className="flex-1 truncate text-sm font-semibold">
          {paper.studentName ?? t('page.grading.papers.unassigned')}
          <span className="ml-2 text-xs font-normal text-gray-500">
            {tr('page.grading.review.paperIndex', {
              n: seqIndex + 1,
              total: reviewablePapers.length,
            })}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => seqIndex > 0 && onNavigate(reviewablePapers[seqIndex - 1].id)}
          disabled={seqIndex <= 0}
          className={btnStyle('secondary')}
        >
          {t('page.grading.review.prev')}
        </button>
        <button
          type="button"
          onClick={() =>
            seqIndex < reviewablePapers.length - 1 && onNavigate(reviewablePapers[seqIndex + 1].id)
          }
          disabled={seqIndex >= reviewablePapers.length - 1}
          className={btnStyle('secondary')}
        >
          {t('page.grading.review.next')}
        </button>
        {onPrintMarks && (
          <button
            type="button"
            onClick={() => onPrintMarks(draftPaper)}
            disabled={printLoading}
            className={btnStyle('secondary')}
            title={t('page.grading.exportMarksTitle', '把卷面批注与得分导出为可打印 PDF')}
          >
            {printLoading
              ? t('page.grading.exportMarksLoading', '正在准备打印…')
              : t('page.grading.exportMarksOne', '导出痕迹')}
          </button>
        )}
      </div>

      {/* 双栏主体 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左: 扫描件 */}
        <div className="w-1/2 overflow-y-auto bg-gray-100 p-3 dark:bg-black/20">
          {imageUrls.length === 0 ? (
            <p className="pt-8 text-center text-xs text-gray-400">
              {t('page.grading.review.loadingImage')}
            </p>
          ) : (
            <PaperScanPages
              imageUrls={imageUrls}
              overlays={paperMarkOverlays(draftPaper, task.rubric)}
            />
          )}
        </div>

        {/* 右: 逐题给分 */}
        <div className="flex w-1/2 flex-col overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {task.rubric.map((q, i) => {
              const ai = paper.ai?.questions.find((a) => a.questionId === q.id)
              const effective = effectiveQuestionScore(draftPaper, q.id)
              return (
                <div
                  key={q.id}
                  className="rounded-lg border border-gray-200 p-3 dark:border-white/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {i + 1}. {q.title}
                    </span>
                    <span className="font-mono text-sm">
                      <span className="text-gray-400">{effective ?? '—'}</span>
                      <span className="text-xs text-gray-400">/{q.fullMark}</span>
                    </span>
                  </div>
                  {ai?.evidence && (
                    <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{ai.evidence}</p>
                  )}
                  {ai?.comment && <p className="mt-1 text-xs text-blue-500">{ai.comment}</p>}
                  {(q.presetMarks?.length ?? 0) > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(q.presetMarks ?? []).map((m, mi) => {
                        const on = (selectedMarks[q.id] ?? []).includes(mi)
                        const aiHit = (ai?.appliedMarks ?? []).includes(mi)
                        return (
                          <button
                            key={`${q.id}-${m.note}-${m.points}`}
                            type="button"
                            onClick={() => toggleMark(q.id, mi, q.fullMark, q.presetMarks)}
                            title={
                              aiHit
                                ? t('page.grading.review.markAiPicked')
                                : t('page.grading.review.markToggle')
                            }
                            className={cn(
                              'rounded px-1.5 py-0.5 text-xs',
                              on
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
                            )}
                          >
                            {m.points > 0 ? '+' : ''}
                            {m.points} {m.note}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={q.fullMark}
                      step={1}
                      value={scoreEdits[q.id] ?? ''}
                      onChange={(e) =>
                        setScoreEdits((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                      placeholder={t('page.grading.review.aiScore')}
                      aria-label={t('page.grading.review.override')}
                      className={cn(INPUT_BASE, 'w-24')}
                    />
                    <input
                      type="text"
                      value={commentEdits[q.id] ?? ''}
                      onChange={(e) =>
                        setCommentEdits((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                      placeholder={t('page.grading.review.overrideComment')}
                      className={cn(INPUT_BASE, 'flex-1')}
                    />
                  </div>
                </div>
              )
            })}
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('page.grading.review.overallComment')}
              </span>
              <textarea
                value={overall}
                onChange={(e) => setOverall(e.target.value)}
                rows={2}
                className={cn(INPUT_BASE, 'mt-1 w-full resize-y')}
              />
            </div>
          </div>
          {/* 底部: 生效总分 + 保存 */}
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 dark:border-white/[0.06]">
            <span className="text-sm">
              {t('page.grading.review.effectiveTotal')}:{' '}
              <span className="font-mono font-semibold">
                {effectiveTotal ?? '—'}/{fullMarkTotal}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={btnStyle('primary')}
            >
              {t('page.grading.review.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
