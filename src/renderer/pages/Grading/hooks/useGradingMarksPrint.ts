// =============================================================
// useGradingMarksPrint — 批阅痕迹打印数据
// 加载扫描件 data URL;PrintOverlay 由调用方渲染(与成绩单 hook 同口径)。
// 排序用 @shared/grading-helpers 的 sortPapersForPrint(共享纯函数,
// 主进程 handler 校验同一值域)。
// =============================================================

import { sortPapersForPrint } from '@shared/grading-helpers'
import type { GradingPaper, GradingTask, PrintOrder } from '@shared/types'
import { useCallback, useState } from 'react'
import { tr, useT } from '../../../i18n'
import { saveAs } from '../../../lib/dialog'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import { loadPaperImageUrls } from '../lib/paper-images'

export interface GradingMarksPrintView {
  paper: GradingPaper
  imageUrls: string[]
}

export function useGradingMarksPrint() {
  const { t } = useT()
  const [task, setTask] = useState<GradingTask | null>(null)
  const [views, setViews] = useState<GradingMarksPrintView[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const printPapers = useCallback(
    async (nextTask: GradingTask, papers: GradingPaper[], order: PrintOrder = 'name-asc') => {
      const graded = papers.filter((p) => p.ai)
      if (graded.length === 0) {
        toast.warning(t('page.grading.exportMarks.empty', '没有已批改的试卷可导出'))
        return
      }
      setLoading(true)
      try {
        const loaded: GradingMarksPrintView[] = []
        for (const paper of sortPapersForPrint(graded, order)) {
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

  /**
   * 逐页批注 PDF 直出: 对当前已渲染的批阅痕迹窗口调主进程
   * webContents.printToPDF(打印 CSS 已滤出批注文档),B5/8K/16K 走
   * paperSpecToPdfPageSize 英寸口径自定义纸。
   */
  const exportPdf = useCallback(async () => {
    if (!task) return
    const filePath = await saveAs({
      title: t('page.grading.exportPdf.saveTitle', '导出批注 PDF'),
      defaultPath: tr(
        'page.grading.exportPdf.defaultName',
        { name: task.name },
        '{name}-批阅痕迹.pdf',
      ),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (!filePath) return
    setExporting(true)
    try {
      const r = await getAPI().grading.exportAnnotatedPdf(task.id, {
        filePath,
        paperSpecId: task.overlayPrint?.paperSpecId,
      })
      if (r.success) {
        toast.success(t('page.grading.exportPdf.done', 'PDF 已导出'))
      } else {
        toast.error(r.error ?? t('page.grading.exportPdf.fail', '导出失败'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }, [task, t])

  const close = useCallback(() => {
    setTask(null)
    setViews(null)
  }, [])

  return { task, views, loading, exporting, printPapers, exportPdf, close }
}
