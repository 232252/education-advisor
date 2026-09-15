// =============================================================
// QuadEditorDialog — 手动四点逃生门(套打定位的最后兜底)
// 在扫描图上把四个角拖到卷子四角(以卷面文字方向为准)。
// 自动链(CV→AI)失手的少数卷在这里救回;预填已检四点或按图片
// 四角 3% 内缩。保存 source='manual' 落库。
// =============================================================

import type { PageQuad } from '@shared/grading-geometry'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

interface QuadEditorDialogProps {
  taskId: string
  paperId: string
  /** 编辑的页下标 */
  page: number
  imageUrls: string[]
  naturalSize?: { width: number; height: number }
  initialQuad?: PageQuad | null
  onClose: () => void
  onSaved: () => Promise<void> | void
}

type CornerKey = 'tl' | 'tr' | 'br' | 'bl'

export function QuadEditorDialog({
  taskId,
  paperId,
  page,
  imageUrls,
  naturalSize,
  initialQuad,
  onClose,
  onSaved,
}: QuadEditorDialogProps) {
  const { t } = useT()
  const cornerLabel = (k: CornerKey): string => {
    if (k === 'tl') return t('page.grading.overlay.cornerTl', '左上')
    if (k === 'tr') return t('page.grading.overlay.cornerTr', '右上')
    if (k === 'br') return t('page.grading.overlay.cornerBr', '右下')
    return t('page.grading.overlay.cornerBl', '左下')
  }
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState<CornerKey | null>(null)
  const [saving, setSaving] = useState(false)
  // 归一化 0-1 坐标(相对图片),显示时按容器百分比
  const [pts, setPts] = useState<Record<CornerKey, { x: number; y: number }>>(() => {
    const inset = 0.03
    if (initialQuad && naturalSize) {
      const n = (p: { x: number; y: number }) => ({
        x: p.x / naturalSize.width,
        y: p.y / naturalSize.height,
      })
      return {
        tl: n(initialQuad.tl),
        tr: n(initialQuad.tr),
        br: n(initialQuad.br),
        bl: n(initialQuad.bl),
      }
    }
    return {
      tl: { x: inset, y: inset },
      tr: { x: 1 - inset, y: inset },
      br: { x: 1 - inset, y: 1 - inset },
      bl: { x: inset, y: 1 - inset },
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const url = imageUrls[page]
  const size = naturalSize

  const toLocal = (e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: toLocal 仅读容器 ref,依赖不变
  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const p = toLocal(e)
      setPts((prev) => ({ ...prev, [dragging]: p }))
    }
    const up = () => setDragging(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging])

  const quadPolygon = useMemo(
    () =>
      `${pts.tl.x * 100},${pts.tl.y * 100} ${pts.tr.x * 100},${pts.tr.y * 100} ` +
      `${pts.br.x * 100},${pts.br.y * 100} ${pts.bl.x * 100},${pts.bl.y * 100}`,
    [pts],
  )

  const save = async () => {
    if (!size) {
      toast.error(t('page.grading.overlay.noSize', '图片尺寸尚未加载,请稍候重试'))
      return
    }
    setSaving(true)
    try {
      const quad: PageQuad = {
        tl: { x: pts.tl.x * size.width, y: pts.tl.y * size.height },
        tr: { x: pts.tr.x * size.width, y: pts.tr.y * size.height },
        br: { x: pts.br.x * size.width, y: pts.br.y * size.height },
        bl: { x: pts.bl.x * size.width, y: pts.bl.y * size.height },
        source: 'manual',
        confidence: 1,
        imageWidth: size.width,
        imageHeight: size.height,
        detectedAt: new Date().toISOString(),
      }
      // 读取现有四点数组,只替换当前页
      const taskRes = await getAPI().grading.getTask(taskId)
      const paper = taskRes.data?.papers.find((p) => p.id === paperId)
      const pageCount = paper?.files.length ?? page + 1
      const quads: Array<PageQuad | null> = Array.from(
        { length: pageCount },
        (_, i) => paper?.overlayQuads?.[i] ?? null,
      )
      quads[page] = quad
      const res = await getAPI().grading.saveQuads(taskId, paperId, quads)
      if (!res.success) throw new Error(res.error || t('common.saveFailed', '保存失败'))
      toast.success(t('page.grading.overlay.manualSaved', '四点已保存'))
      await onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleStyle = (key: CornerKey): CSSProperties => ({
    left: `${pts[key].x * 100}%`,
    top: `${pts[key].y * 100}%`,
  })

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-white/10">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('page.grading.overlay.quadEditor', '手动四点校正')}
            <span className="ml-2 font-normal text-gray-500">
              {t('page.grading.overlay.quadEditorHint', '把四个角拖到卷子四角(以卷面文字方向为准)')}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"
          >
            {t('common.close', '关闭')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {imageUrls.length > 1 && (
            <p className="mb-2 text-xs text-gray-500">
              {t('page.grading.overlay.editingPage', '正在校正第')} {page + 1} / {imageUrls.length}{' '}
              {t('page.grading.overlay.editingPageSuffix', '页(其余页在保存后逐页校正)')}
            </p>
          )}
          <div
            ref={containerRef}
            className="relative touch-none select-none"
            onPointerDown={(e) => {
              const p = toLocal(e)
              // 点附近 6% 内吸附最近的角
              const order: CornerKey[] = ['tl', 'tr', 'br', 'bl']
              let best: CornerKey | null = null
              let bestD = 0.06
              for (const k of order) {
                const d = Math.hypot(pts[k].x - p.x, pts[k].y - p.y)
                if (d < bestD) {
                  bestD = d
                  best = k
                }
              }
              if (best) {
                setDragging(best)
                setPts((prev) => ({ ...prev, [best]: p }))
              }
            }}
          >
            {url ? (
              <img src={url} alt="quad-editor" className="block w-full" draggable={false} />
            ) : (
              <p className="py-10 text-center text-xs text-gray-400">
                {t('page.grading.overlay.noImage', '该页没有扫描图')}
              </p>
            )}
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <polygon
                points={quadPolygon}
                fill="rgba(239,68,68,0.08)"
                stroke="rgb(239,68,68)"
                strokeWidth="0.4"
                strokeDasharray="2 1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {(['tl', 'tr', 'br', 'bl'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setDragging(k)
                }}
                className="pointer-events-auto absolute z-10 -ml-3 -mt-3 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 text-[9px] font-bold text-white shadow-md"
                style={handleStyle(k)}
              >
                {cornerLabel(k)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !size}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
          >
            {saving ? t('common.saving', '保存中…') : t('common.save', '保存')}
          </button>
        </div>
      </div>
    </div>
  )
}
