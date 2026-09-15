// =============================================================
// OverlayPrintDocument — 套打回写版式(批阅痕迹第三模式)
// 无底图红痕层: 每题短痕/页边批注按毫米坐标落在空白页上,
// 打印时与系统对话框一起以 100% 实际大小输出,套回学生原卷。
// 屏幕预览: 扫描件半透明垫底(所见即所得) + 校准/纸张规格/定位检测
// 控制面板(均不进打印)。
// 版式规范: docs/research/2026-09-15-overlay-print-annotation-research.md
// =============================================================

import type { PrinterInfo } from '@shared/api/sys'
import type { PageQuad, PaperSpec } from '@shared/grading-geometry'
import {
  anchorSquarePositionsMm,
  matchPaperSpec,
  PAPER_SPECS,
  paperSpecById,
  rescaleQuad,
} from '@shared/grading-geometry'
import {
  DEFAULT_OVERLAY_CALIBRATION,
  layoutOverlayPaper,
  type OverlayCalibration,
  type OverlayPaperLayout,
} from '@shared/overlay-layout'
import type { GradingPaper, GradingTask } from '@shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tr, useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { cn } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { QuadEditorDialog } from './QuadEditorDialog'
import { TemplateCalibrateDialog } from './TemplateCalibrateDialog'

export interface OverlayPrintView {
  paper: GradingPaper
  imageUrls: string[]
}

interface OverlayPrintDocumentProps {
  task: GradingTask
  views: OverlayPrintView[]
  onRefresh: () => Promise<void>
}

/** 量出来的扫描图尺寸(页下标对齐;测量完成前 undefined) */
type SizeMap = Record<string, Array<{ width: number; height: number } | undefined>>

function ptToMm(pt: number): number {
  return pt * 0.3528
}

export function OverlayPrintDocument({ task, views, onRefresh }: OverlayPrintDocumentProps) {
  const { t } = useT()
  const [sizes, setSizes] = useState<SizeMap>({})
  const [specId, setSpecId] = useState<string>(() => task.overlayPrint?.paperSpecId ?? '')
  const [calibration, setCalibration] = useState<OverlayCalibration>(
    () => task.overlayPrint?.calibration ?? DEFAULT_OVERLAY_CALIBRATION,
  )
  const [showUnderlay, setShowUnderlay] = useState(true)
  const [showCalibrationPage, setShowCalibrationPage] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [quadEditor, setQuadEditor] = useState<{ paperId: string; page: number } | null>(null)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [deviceName, setDeviceName] = useState<string>(() => task.overlayPrint?.deviceName ?? '')
  const [silentPrinting, setSilentPrinting] = useState(false)
  const [tplDialog, setTplDialog] = useState(false)
  const [masterUrls, setMasterUrls] = useState<string[] | null>(null)

  // 打印机清单(静默连打选设备;取不到就留空走系统默认)
  useEffect(() => {
    let alive = true
    getAPI()
      .sys.listPrinters()
      .then((res) => {
        if (alive && res.success && res.data) setPrinters(res.data)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // 印制版: 读母版样卷图(留档在 files/<taskId>/template/)
  const loadMaster = async () => {
    if (masterUrls) return
    const tpl = task.overlayTemplate
    if (!tpl || tpl.files.length === 0) return
    const urls: string[] = []
    for (const f of tpl.files) {
      try {
        const res = await getAPI().grading.readPaperFile(task.id, f.storedName)
        if (res.success && res.data) {
          urls.push(`data:${res.data.mime};base64,${res.data.base64}`)
        }
      } catch {
        /* 单页读失败跳过 */
      }
    }
    setMasterUrls(urls)
  }

  // 静默连打: 参数写死 实际尺寸+无边距,按顺序出全部套打页
  const silentPrint = async () => {
    if (showCalibrationPage) {
      toast.warning(t('page.grading.overlay.silentCalib', '请先取消勾选校准页,再静默连打'))
      return
    }
    if (masterUrls) {
      toast.warning(t('page.grading.overlay.silentMaster', '当前是印制版母版,请先返回套打预览'))
      return
    }
    setSilentPrinting(true)
    try {
      if (deviceName) {
        await getAPI().grading.saveOverlayPrint(task.id, { deviceName })
      }
      const res = await getAPI().grading.overlaySilentPrint(task.id, {
        deviceName: deviceName || undefined,
        paperSpecId: effectiveSpecId,
      })
      if (res.data?.ok) {
        toast.success(t('page.grading.overlay.silentOk', '已发送到打印机,请按屏幕顺序放卷'))
      } else {
        toast.error(
          res.data?.reason || res.error || t('page.grading.overlay.silentFail', '打印失败'),
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSilentPrinting(false)
    }
  }

  // 纸张规格: 未保存过时按首页图片宽高比给建议
  const suggestedSpecId = useMemo(() => {
    const first = Object.values(sizes)
      .flat()
      .find((s): s is { width: number; height: number } => !!s)
    return first ? (matchPaperSpec(first.width, first.height)?.spec.id ?? 'a4') : 'a4'
  }, [sizes])
  const effectiveSpecId = specId || suggestedSpecId
  const spec: PaperSpec = paperSpecById(effectiveSpecId)

  // 量扫描图自然尺寸(缓存按 url)
  useEffect(() => {
    let alive = true
    for (const view of views) {
      for (const [i, url] of view.imageUrls.entries()) {
        const img = new Image()
        img.onload = () => {
          if (!alive) return
          setSizes((prev) => {
            if (prev[view.paper.id]?.[i]?.width === img.naturalWidth) return prev
            const list = [...(prev[view.paper.id] ?? [])]
            list[i] = { width: img.naturalWidth, height: img.naturalHeight }
            return { ...prev, [view.paper.id]: list }
          })
        }
        img.src = url
      }
    }
    return () => {
      alive = false
    }
  }, [views])

  // 版式: 每份卷一套(四点从最新 task 取,与 views 内旧对象解耦)
  const layouts = useMemo<OverlayPaperLayout[]>(() => {
    const paperById = new Map(task.papers.map((p) => [p.id, p]))
    return views.map((view) => {
      const paper = paperById.get(view.paper.id) ?? view.paper
      return layoutOverlayPaper({
        paper,
        rubric: task.rubric,
        quads: paper.overlayQuads ?? [],
        imageSizes: sizes[view.paper.id] ?? [],
        spec,
        calibration,
        template: task.overlayTemplate,
      })
    })
  }, [views, task, sizes, spec, calibration])

  // 纸张规格/校准/打印机持久化(跳过首帧)
  const savedRef = useRef({
    spec: task.overlayPrint?.paperSpecId,
    calib: task.overlayPrint?.calibration,
    device: task.overlayPrint?.deviceName,
  })
  useEffect(() => {
    if (showCalibrationPage) return
    const timer = window.setTimeout(() => {
      const wantSaveSpec = specId !== '' && specId !== savedRef.current.spec
      const c = calibration
      const prev = savedRef.current.calib
      const wantSaveCalib =
        !prev || prev.dxMm !== c.dxMm || prev.dyMm !== c.dyMm || prev.scalePct !== c.scalePct
      const wantSaveDevice = deviceName !== savedRef.current.device
      if (!wantSaveSpec && !wantSaveCalib && !wantSaveDevice) return
      getAPI()
        .grading.saveOverlayPrint(task.id, {
          ...(wantSaveSpec ? { paperSpecId: specId } : {}),
          ...(wantSaveCalib ? { calibration: c } : {}),
          ...(wantSaveDevice ? { deviceName } : {}),
        })
        .then(() => {
          savedRef.current = {
            spec: wantSaveSpec ? specId : savedRef.current.spec,
            calib: c,
            device: deviceName,
          }
        })
        .catch(() => undefined)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [specId, calibration, task.id, showCalibrationPage, deviceName])

  // 自动定位四点(CV→AI 自动链)
  const detect = async () => {
    setDetecting(true)
    try {
      const res = await getAPI().grading.detectQuads(task.id, { useAiFallback: true })
      const pages = res.data?.results.flatMap((r) => r.pages) ?? []
      const ok = pages.filter((p) => p.ok).length
      const fail = pages.length - ok
      if (pages.length === 0) {
        toast.warning(t('page.grading.overlay.detectPartial', '未找到可定位的试卷'))
      } else if (fail === 0) {
        toast.success(tr('page.grading.overlay.detectOk', { n: ok }, `定位完成: ${ok} 页全部成功`))
      } else {
        toast.warning(
          tr(
            'page.grading.overlay.detectPartial',
            { ok, fail },
            `定位完成: ${ok} 页成功,${fail} 页需手动四点`,
          ),
        )
      }
      await onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setDetecting(false)
    }
  }

  // 需要人工兜底的卷: 有扫描件但存在未定位页
  // 母版标定生效: 模板有逐题 boxes 且至少一页有四点 → 学生卷免定位
  const templateActive = useMemo(() => {
    const tpl = task.overlayTemplate
    return !!tpl?.boxes && Object.keys(tpl.boxes).length > 0 && !!tpl.quads?.some((q) => q != null)
  }, [task])
  const tplLocated = Object.keys(task.overlayTemplate?.boxes ?? {}).length

  // 需要人工兜底的卷: 有扫描件但存在未定位页(母版生效时不逐卷定位)
  const needManual = useMemo(() => {
    if (templateActive) return []
    const byId = new Map(task.papers.map((p) => [p.id, p]))
    return views
      .map((v) => byId.get(v.paper.id) ?? v.paper)
      .filter(
        (p) => p.files.length > 0 && (!p.overlayQuads || p.overlayQuads.some((q) => q == null)),
      )
  }, [views, task, templateActive])

  const stepCalibration = (key: keyof OverlayCalibration, delta: number) => {
    setCalibration((c) => {
      const step = key === 'scalePct' ? 0.1 : 0.5
      const round = key === 'scalePct' ? 2 : 1
      const v = Number((c[key] + delta * step).toFixed(round))
      const clamped =
        key === 'scalePct' ? Math.min(Math.max(v, 90), 110) : Math.min(Math.max(v, -30), 30)
      return { ...c, [key]: clamped }
    })
  }

  const editorPaper = quadEditor
    ? (views.find((v) => v.paper.id === quadEditor.paperId) ?? null)
    : null
  const editorInitialQuad: PageQuad | null = useMemo(() => {
    if (!quadEditor || !editorPaper) return null
    const paper = task.papers.find((p) => p.id === quadEditor.paperId) ?? editorPaper.paper
    const stored = paper.overlayQuads?.[quadEditor.page]
    const size = sizes[quadEditor.paperId]?.[quadEditor.page]
    if (!size) return null
    if (stored) return rescaleQuad(stored, size.width, size.height)
    return null
  }, [quadEditor, editorPaper, task, sizes])

  return (
    <div className="text-gray-900">
      <style>{`@media print { @page { size: ${spec.widthMm}mm ${spec.heightMm}mm; margin: 0; } }`}</style>

      {/* ===== 控制面板(仅屏幕) ===== */}
      <div className="overlay-screen-only mx-auto mb-4 w-[210mm] max-w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-white/10 dark:bg-white/5 dark:text-gray-200">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5">
            {t('page.grading.overlay.paperSpec', '纸张')}
            <select
              value={effectiveSpecId}
              onChange={(e) => {
                setSpecId(e.target.value)
              }}
              className="rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-white/20 dark:bg-white/10"
            >
              {PAPER_SPECS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.widthMm}×{s.heightMm}mm)
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setTplDialog(true)}
            className="rounded border border-blue-500 px-2.5 py-1 font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10"
          >
            {templateActive
              ? t('page.grading.overlay.tplRecalibrate', '重新标定母版')
              : t('page.grading.overlay.tplCalibrate', '母版标定')}
          </button>
          {templateActive && (
            <>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                {t(
                  'page.grading.overlay.tplActive',
                  `母版生效: ${tplLocated} 题统一痕迹位,学生卷免定位`,
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowCalibrationPage(false)
                  if (masterUrls) setMasterUrls(null)
                  else void loadMaster()
                }}
                className={cn(
                  'rounded px-2.5 py-1 font-medium',
                  masterUrls
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-200'
                    : 'border border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300',
                )}
                title={t(
                  'page.grading.overlay.masterHint',
                  '把样卷带四角定位点重新打印,作下次考试的印制母版',
                )}
              >
                {masterUrls
                  ? t('page.grading.overlay.masterBack', '返回套打预览')
                  : t('page.grading.overlay.masterPrint', '印制版(带定位点)')}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void detect()}
            disabled={detecting}
            className={cn(
              'rounded px-2.5 py-1 font-medium text-white',
              detecting ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700',
            )}
          >
            {detecting
              ? t('page.grading.overlay.detecting', '定位中…')
              : t('page.grading.overlay.detect', '自动定位四点')}
          </button>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={showUnderlay}
              onChange={(e) => setShowUnderlay(e.target.checked)}
            />
            {t('page.grading.overlay.underlay', '垫底预览')}
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={showCalibrationPage}
              onChange={(e) => setShowCalibrationPage(e.target.checked)}
            />
            {t('page.grading.overlay.calibrationPage', '校准页')}
          </label>
          {printers.length > 0 && (
            <label className="flex items-center gap-1.5">
              {t('page.grading.overlay.printer', '打印机')}
              <select
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="max-w-44 rounded border border-gray-300 bg-white px-1.5 py-0.5 dark:border-white/20 dark:bg-white/10"
              >
                <option value="">{t('page.grading.overlay.systemDefault', '系统默认')}</option>
                {printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName || p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => void silentPrint()}
            disabled={silentPrinting}
            className={cn(
              'rounded px-2.5 py-1 font-medium text-white',
              silentPrinting ? 'bg-gray-400' : 'bg-emerald-600 hover:bg-emerald-700',
            )}
          >
            {silentPrinting
              ? t('page.grading.overlay.silentDoing', '打印中…')
              : t('page.grading.overlay.silentPrint', '静默连打')}
          </button>
          <div className="ml-auto flex items-center gap-1 font-mono">
            <span className="text-gray-500">dx</span>
            <button
              type="button"
              onClick={() => stepCalibration('dxMm', -1)}
              className="rounded border border-gray-300 px-1 dark:border-white/20"
            >
              −
            </button>
            <span className="w-12 text-center">{calibration.dxMm.toFixed(1)}</span>
            <button
              type="button"
              onClick={() => stepCalibration('dxMm', 1)}
              className="rounded border border-gray-300 px-1 dark:border-white/20"
            >
              +
            </button>
            <span className="ml-2 text-gray-500">dy</span>
            <button
              type="button"
              onClick={() => stepCalibration('dyMm', -1)}
              className="rounded border border-gray-300 px-1 dark:border-white/20"
            >
              −
            </button>
            <span className="w-12 text-center">{calibration.dyMm.toFixed(1)}</span>
            <button
              type="button"
              onClick={() => stepCalibration('dyMm', 1)}
              className="rounded border border-gray-300 px-1 dark:border-white/20"
            >
              +
            </button>
            <span className="ml-2 text-gray-500">mm</span>
            <span className="ml-2 text-gray-500">{t('page.grading.overlay.scale', '缩放')}</span>
            <button
              type="button"
              onClick={() => stepCalibration('scalePct', -1)}
              className="rounded border border-gray-300 px-1 dark:border-white/20"
            >
              −
            </button>
            <span className="w-14 text-center">{calibration.scalePct.toFixed(2)}%</span>
            <button
              type="button"
              onClick={() => stepCalibration('scalePct', 1)}
              className="rounded border border-gray-300 px-1 dark:border-white/20"
            >
              +
            </button>
          </div>
        </div>
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          {t(
            'page.grading.overlay.printHint',
            '套打要点: 打印对话框选「实际大小/100%」,纸张规格与上方一致,关闭「适应页面/无边距」;原卷压平,按屏幕顺序逐张进纸,每 5 份抽查一次对位。',
          )}
        </p>
        {needManual.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-gray-500">
              {t('page.grading.overlay.needManual', '未定位(可手动四点):')}
            </span>
            {needManual.map((p) => {
              const missingPages = (p.overlayQuads ?? p.files.map(() => null))
                .map((q, i) => (q == null ? i : -1))
                .filter((i) => i >= 0)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setQuadEditor({ paperId: p.id, page: missingPages[0] ?? 0 })}
                  className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
                >
                  {p.studentName ?? t('print.gradingMarks.unassigned', '未归组')}
                  {missingPages.length > 0 ? ` ·P${missingPages.map((i) => i + 1).join('/')}` : ''}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ===== 页面 ===== */}
      {showCalibrationPage ? (
        <CalibrationPrintPage spec={spec} />
      ) : masterUrls && masterUrls.length > 0 ? (
        <div className="overlay-paper mb-6">
          <p className="overlay-screen-only mb-1 text-xs text-amber-700 dark:text-amber-300">
            {t(
              'page.grading.overlay.masterNote',
              '印制版母版: 按 100% 实际大小打印后即为下次考试的原卷(四角带■定位点,天生可精准套打);复印/胶印请保持 1:1。',
            )}
          </p>
          {masterUrls.map((url, i) => (
            <div
              key={`master-${url.slice(-16)}`}
              className="overlay-page relative mx-auto overflow-hidden bg-white"
              style={{ width: `${spec.widthMm}mm`, height: `${spec.heightMm}mm` }}
            >
              <img
                src={url}
                alt={`master-${i + 1}`}
                className="absolute inset-0 h-full w-full object-fill"
              />
              {anchorSquarePositionsMm(spec).map((a) => (
                <div
                  key={`anchor-${a.x}-${a.y}`}
                  className="absolute bg-black"
                  style={{
                    left: `${a.x}mm`,
                    top: `${a.y}mm`,
                    width: `${a.sizeMm}mm`,
                    height: `${a.sizeMm}mm`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        views.map((view, vi) => {
          const layout = layouts[vi]
          const student = view.paper.studentName ?? t('print.gradingMarks.unassigned', '未归组')
          const pageCount = Math.max(view.imageUrls.length, layout?.pages.length ?? 0)
          return (
            <div key={view.paper.id} className="overlay-paper mb-6">
              <p className="overlay-screen-only mb-1 text-xs text-gray-500">
                {student}
                {layout && layout.warnings.length > 0 ? ` · ${layout.warnings.join(' · ')}` : ''}
              </p>
              {Array.from({ length: pageCount }, (_, page) => (
                <OverlayPage
                  // biome-ignore lint/suspicious/noArrayIndexKey: 静态页列表,页序即稳定键
                  key={`page-${page}`}
                  spec={spec}
                  underlayUrl={showUnderlay ? view.imageUrls[page] : undefined}
                  marks={layout?.pages[page]?.marks ?? []}
                  notes={layout?.pages[page]?.notes ?? []}
                  total={layout?.total && page === 0 ? layout.total : null}
                />
              ))}
            </div>
          )
        })
      )}

      {/* ===== 母版标定 ===== */}
      {tplDialog && (
        <TemplateCalibrateDialog
          taskId={task.id}
          onClose={() => setTplDialog(false)}
          onDone={onRefresh}
        />
      )}

      {/* ===== 手动四点逃生门 ===== */}
      {quadEditor && editorPaper && (
        <QuadEditorDialog
          taskId={task.id}
          paperId={quadEditor.paperId}
          page={quadEditor.page}
          imageUrls={editorPaper.imageUrls}
          naturalSize={sizes[quadEditor.paperId]?.[quadEditor.page]}
          initialQuad={editorInitialQuad}
          onClose={() => setQuadEditor(null)}
          onSaved={async () => {
            setQuadEditor(null)
            await onRefresh()
          }}
        />
      )}
    </div>
  )
}

// ===== 单页(毫米坐标系) =====

interface OverlayPageProps {
  spec: PaperSpec
  underlayUrl?: string
  marks: OverlayPaperLayout['pages'][number]['marks']
  notes: OverlayPaperLayout['pages'][number]['notes']
  total: OverlayPaperLayout['total']
}

function OverlayPage({ spec, underlayUrl, marks, notes, total }: OverlayPageProps) {
  return (
    <div
      className="overlay-page relative mx-auto overflow-hidden bg-white shadow-sm"
      style={{ width: `${spec.widthMm}mm`, height: `${spec.heightMm}mm` }}
    >
      {underlayUrl && (
        <img
          src={underlayUrl}
          alt="overlay-underlay"
          className="overlay-underlay pointer-events-none absolute inset-0 h-full w-full object-fill opacity-15"
        />
      )}
      {total && (
        <div
          className="handwriting-mark absolute whitespace-nowrap text-red-700"
          style={{ left: `${total.xMm}mm`, top: `${total.yMm}mm` }}
        >
          <span style={{ fontSize: `${total.mainPt}pt`, lineHeight: 1 }}>{total.mainText}</span>
          <span style={{ fontSize: `${total.subPt}pt` }}>{total.subText}</span>
        </div>
      )}
      {marks.map((m) => (
        <div
          key={m.questionId}
          className="handwriting-mark absolute whitespace-nowrap leading-none text-red-700"
          style={{ left: `${m.xMm}mm`, top: `${m.yMm}mm`, fontSize: `${m.pt}pt` }}
        >
          {m.text}
        </div>
      ))}
      {notes.map((n) => (
        <div
          key={n.questionId}
          className="handwriting-mark absolute whitespace-pre-wrap break-all text-red-800"
          style={{
            left: `${n.xMm}mm`,
            top: `${n.yMm}mm`,
            width: `${n.widthMm}mm`,
            fontSize: `${n.pt}pt`,
            lineHeight: `${n.lineHeightMm / ptToMm(n.pt)}`,
          }}
        >
          <span className="font-semibold">{n.header}</span>
          {n.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 批注行序即稳定键
            <span key={`${n.questionId}-line-${i}`} className="block pl-[2mm]">
              {line}
            </span>
          ))}
        </div>
      ))}
    </div>
  )
}

// ===== 校准页(100mm 标尺 + 四角十字线) =====

function CalibrationPrintPage({ spec }: { spec: PaperSpec }) {
  const { t } = useT()
  const ticks = Array.from({ length: 101 }, (_, i) => i)
  const crossAt = [
    { x: 10, y: 10 },
    { x: spec.widthMm - 10, y: 10 },
    { x: spec.widthMm - 10, y: spec.heightMm - 10 },
    { x: 10, y: spec.heightMm - 10 },
  ]
  return (
    <div className="overlay-paper">
      <p className="overlay-screen-only mb-1 text-xs text-gray-500">
        {t(
          'page.grading.overlay.calibrationHint',
          '校准页: 打印一张到套打用的同款纸上,量横/竖 100mm 标尺的实际长度(缩放=实测/100×100%),量左上十字线中心距纸边的 x/y(即 dx/dy 的修正值),录入上方微调后重新试打。',
        )}
      </p>
      <div
        className="overlay-page relative mx-auto bg-white"
        style={{ width: `${spec.widthMm}mm`, height: `${spec.heightMm}mm` }}
      >
        {/* 硬件死区可视化(6mm 虚线框) */}
        <div
          className="absolute border border-dashed border-gray-300"
          style={{
            left: '6mm',
            top: '6mm',
            width: `${spec.widthMm - 12}mm`,
            height: `${spec.heightMm - 12}mm`,
          }}
        />
        {/* 横向标尺: x 30–130mm,基线 y=60 */}
        <div
          className="absolute bg-gray-800"
          style={{ left: '30mm', top: '60mm', width: '100mm', height: '0.3mm' }}
        />
        {ticks.map((mm) => (
          <div
            key={`h${mm}`}
            className="absolute bg-gray-800"
            style={{
              left: `${30 + mm}mm`,
              top: `${60 - (mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3.2 : 1.8)}mm`,
              width: '0.3mm',
              height: `${mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3.2 : 1.8}mm`,
            }}
          />
        ))}
        {[0, 50, 100].map((mm) => (
          <span
            key={`hl${mm}`}
            className="absolute text-[8pt] text-gray-700"
            style={{ left: `${28 + mm}mm`, top: '53mm' }}
          >
            {mm}
          </span>
        ))}
        <span
          className="absolute text-[9pt] font-medium text-gray-800"
          style={{ left: '70mm', top: '48mm' }}
        >
          100mm
        </span>
        {/* 纵向标尺: y 30–130mm,基线 x=60 */}
        <div
          className="absolute bg-gray-800"
          style={{ left: '60mm', top: '30mm', width: '0.3mm', height: '100mm' }}
        />
        {ticks.map((mm) => (
          <div
            key={`v${mm}`}
            className="absolute bg-gray-800"
            style={{
              left: `${60 - (mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3.2 : 1.8)}mm`,
              top: `${30 + mm}mm`,
              width: `${mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3.2 : 1.8}mm`,
              height: '0.3mm',
            }}
          />
        ))}
        {[0, 50, 100].map((mm) => (
          <span
            key={`vl${mm}`}
            className="absolute text-[8pt] text-gray-700"
            style={{ left: '48mm', top: `${28.5 + mm}mm` }}
          >
            {mm}
          </span>
        ))}
        {/* 四角十字线 */}
        {crossAt.map((c) => (
          <div key={`cross-${c.x}-${c.y}`}>
            <div
              className="absolute bg-red-600"
              style={{ left: `${c.x - 6}mm`, top: `${c.y}mm`, width: '12mm', height: '0.3mm' }}
            />
            <div
              className="absolute bg-red-600"
              style={{ left: `${c.x}mm`, top: `${c.y - 6}mm`, width: '0.3mm', height: '12mm' }}
            />
          </div>
        ))}
        {/* 红字样例(检查红色墨与字号层级) */}
        <div
          className="handwriting-mark absolute text-red-700"
          style={{ left: '80mm', top: '80mm' }}
        >
          <div style={{ fontSize: '20pt', lineHeight: 1 }}>
            86<span style={{ fontSize: '10pt' }}>/100</span>
          </div>
          <div className="mt-2" style={{ fontSize: '13pt' }}>
            ✓ ✗ 9/12
          </div>
          <div className="mt-2 whitespace-pre-wrap" style={{ fontSize: '8pt', width: '30mm' }}>
            {t('page.grading.overlay.calibrationSample', '① 9/12\n-2 单位未换算\n-1 未画受力图')}
          </div>
        </div>
        <span
          className="absolute text-[7pt] text-gray-500"
          style={{ left: '10mm', top: `${spec.heightMm - 8}mm` }}
        >
          {t(
            'page.grading.overlay.calibrationFooter',
            'Education Advisor 套打校准页 — 打印时选「实际大小 100%」',
          )}
        </span>
      </div>
    </div>
  )
}
