// =============================================================
// TemplateCalibrateDialog — 母版标定(Tier B)
// 选样卷图片 → 留档 + 四点检测 + AI 逐题定位 → 落库。
// 标定后全班痕迹位统一走模板坐标,学生卷无需逐份定位。
// =============================================================

import { useState } from 'react'
import { useT } from '../../i18n'
import { pickFiles } from '../../lib/dialog'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

interface TemplateCalibrateDialogProps {
  taskId: string
  onClose: () => void
  onDone: () => Promise<void> | void
}

export function TemplateCalibrateDialog({ taskId, onClose, onDone }: TemplateCalibrateDialogProps) {
  const { t } = useT()
  const [paths, setPaths] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{
    located: number
    missing: string[]
    pages: number
    quadsOk: number
  } | null>(null)

  const pick = async () => {
    const picked = await pickFiles({
      title: t('page.grading.overlay.tplPickTitle', '选择样卷图片(1-8 页)'),
      filters: [
        { name: 'Images & PDF', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'pdf'] },
      ],
    })
    if (picked.length > 0) setPaths(picked.slice(0, 8))
  }

  const run = async () => {
    if (paths.length === 0) {
      toast.warning(t('page.grading.overlay.tplNoFiles', '请先选择样卷图片'))
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const res = await getAPI().grading.calibrateOverlayTemplate(taskId, paths)
      if (!res.success || !res.data)
        throw new Error(res.error || t('common.saveFailed', '保存失败'))
      setResult(res.data.result)
      toast.success(
        t('page.grading.overlay.tplDone', `母版已标定: 定位 ${res.data.result.located} 题`),
      )
      await onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/10">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('page.grading.overlay.tplTitle', '用空白样卷统一落点')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"
          >
            {t('common.close', '关闭')}
          </button>
        </div>
        <div className="space-y-3 p-4 text-xs text-gray-700 dark:text-gray-200">
          <p className="rounded bg-blue-50 px-2 py-1.5 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
            {t(
              'page.grading.overlay.tplHint',
              '用一份空白或干净的样卷(每页一张图)。系统会在样卷上标出每题作答位置,全班套打共用这套落点 — 比对着每张学生照片对齐更稳。没标到的题会自动回落到该卷自己的位置。',
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void pick()}
              className="rounded border border-gray-300 px-2.5 py-1 font-medium dark:border-white/20"
            >
              {t('page.grading.overlay.tplPick', '选择样卷图片')}
            </button>
            <span className="text-gray-500">
              {paths.length > 0
                ? t('page.grading.overlay.tplPicked', `${paths.length} 张已选`)
                : t('page.grading.overlay.tplNone', '未选择')}
            </span>
          </div>
          {result && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              <p>
                {t(
                  'page.grading.overlay.tplResult',
                  `${result.pages} 页 · 四点 ${result.quadsOk}/${result.pages} · 定位 ${result.located} 题`,
                )}
              </p>
              {result.missing.length > 0 && (
                <p className="mt-1">
                  {t('page.grading.overlay.tplMissing', '未定位题(回落逐卷定位):')}
                  {result.missing.join('、')}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
          >
            {t('common.close', '关闭')}
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || paths.length === 0}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
          >
            {busy
              ? t('page.grading.overlay.tplBusy', '标定中…')
              : t('page.grading.overlay.tplRun', '开始标定')}
          </button>
        </div>
      </div>
    </div>
  )
}
