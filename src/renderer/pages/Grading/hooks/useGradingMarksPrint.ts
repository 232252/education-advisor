// =============================================================
// useGradingMarksPrint — 批阅痕迹打印数据
// 加载扫描件 data URL;PrintOverlay 由调用方渲染(与成绩单 hook 同口径)。
// =============================================================

import type { GradingPaper, GradingTask } from '@shared/types'
import { useCallback, useState } from 'react'
import { useT } from '../../../i18n'
import { toast } from '../../../stores/toastStore'
import { loadPaperImageUrls } from '../lib/paper-images'

export interface GradingMarksPrintView {
  paper: GradingPaper
  imageUrls: string[]
}

function sortPapersForPrint(papers: GradingPaper[]): GradingPaper[] {
  return [...papers].sort((a, b) => {
    const an = a.studentName ?? ''
    const bn = b.studentName ?? ''
    if (!an && bn) return 1
    if (an && !bn) return -1
    return an.localeCompare(bn, 'zh')
  })
}

export function useGradingMarksPrint() {
  const { t } = useT()
  const [task, setTask] = useState<GradingTask | null>(null)
  const [views, setViews] = useState<GradingMarksPrintView[] | null>(null)
  const [loading, setLoading] = useState(false)

  const printPapers = useCallback(
    async (nextTask: GradingTask, papers: GradingPaper[]) => {
      const graded = papers.filter((p) => p.ai)
      if (graded.length === 0) {
        toast.warning(t('page.grading.exportMarks.empty', '没有已批改的试卷可导出'))
        return
      }
      setLoading(true)
      try {
        const loaded: GradingMarksPrintView[] = []
        for (const paper of sortPapersForPrint(graded)) {
          const imageUrls = await loadPaperImageUrls(nextTask.id, paper)
          loaded.push({ paper, imageUrls })
        }
        setTask(nextTask)
        setViews(loaded)
      } catch (err) {
        console.error('[Print] load grading marks failed:', err)
        toast.error(t('print.loadFailed', '打印数据加载失败'))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  const close = useCallback(() => {
    setTask(null)
    setViews(null)
  }, [])

  return { task, views, loading, printPapers, close }
}
