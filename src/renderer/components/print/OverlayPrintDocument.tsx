// =============================================================
// OverlayPrintDocument — 套打原卷工作台
// 屏幕: 教师按「对齐 → 对照预览 → 试打 / 全班套打」操作;
// 打印: 无底图红痕层按毫米坐标落在空白页上,套回学生原卷。
// 垫底预览把扫描图按四角拉正,与红痕同坐标系(所见即所得)。
// =============================================================

import type { PrinterInfo } from '@shared/api/sys'
import type { PageQuad, PaperSpec } from '@shared/grading-geometry'
import {
  anchorSquarePositionsMm,
  homographyToCssMatrix3d,
  matchPaperSpec,
  PAPER_SPECS,
  paperSpecById,
  quadToPageCssHomography,
  rescaleQuad,
} from '@shared/grading-geometry'
import {
  DEFAULT_OVERLAY_CALIBRATION,
  layoutOverlayPaper,
  type OverlayCalibration,
  type OverlayPaperLayout,
} from '@shared/overlay-layout'
import type { GradingPaper, GradingTask, PrintDuplexMode, PrintOrder } from '@shared/types'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Printer,
  Ruler,
  ScanLine,
} from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { tr, useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { cn } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { Button } from '../Button'
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
  /** 连打排序留档(views 已按该序渲染;透传给 overlaySilentPrint 做值域校验) */
  printOrder?: PrintOrder
}

/** 量出来的扫描图尺寸(页下标对齐;测量完成前 undefined) */
type SizeMap = Record<string, Array<{ width: number; height: number } | undefined>>

type OverlayViewMode = 'papers' | 'calibration' | 'master'
type AlignStatus = 'aligned' | 'approx' | 'manual'

function ptToMm(pt: number): number {
  return pt * 0.3528
}

export function OverlayPrintDocument({
  task,
  views,
  onRefresh,
  printOrder,
}: OverlayPrintDocumentProps) {
  const { t } = useT()
  const [sizes, setSizes] = useState<SizeMap>({})
  const [specId, setSpecId] = useState<string>(() => task.overlayPrint?.paperSpecId ?? '')
  const [calibration, setCalibration] = useState<OverlayCalibration>(
    () => task.overlayPrint?.calibration ?? DEFAULT_OVERLAY_CALIBRATION,
  )
  const [showUnderlay, setShowUnderlay] = useState(true)
  const [viewMode, setViewMode] = useState<OverlayViewMode>('papers')
  const [detecting, setDetecting] = useState(false)
  const [quadEditor, setQuadEditor] = useState<{ paperId: string; page: number } | null>(null)
  const [printers, setPrinters] = useState<PrinterInfo[]>([])
  const [deviceName, setDeviceName] = useState<string>(() => task.overlayPrint?.deviceName ?? '')
  const [silentPrinting, setSilentPrinting] = useState(false)
  // 双面打印(electron print 的 duplexMode 字段;simplex 默认=单面)
  const [duplexMode, setDuplexMode] = useState<PrintDuplexMode>('simplex')
  const [tplDialog, setTplDialog] = useState(false)
  const [masterUrls, setMasterUrls] = useState<string[] | null>(null)
  const [activePaperId, setActivePaperId] = useState<string | null>(null)
  const [printOnlyId, setPrintOnlyId] = useState<string | null>(null)
  const [printArmed, setPrintArmed] = useState(false)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const paperAnchorRefs = useRef<Record<string, HTMLDivElement | null>>({})

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

  const silentPrint = async () => {
    if (viewMode === 'calibration') {
      toast.warning(t('page.grading.overlay.silentCalib', '请先返回套打预览,再按顺序套打'))
      return
    }
    if (viewMode === 'master') {
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
        order: printOrder,
        duplexMode,
      })
      if (res.data?.ok) {
        toast.success(
          t('page.grading.overlay.silentOk', '已发送到打印机,请按屏幕顺序放卷') +
            // 驱动不支持自动双面时的兜底提示(单测不覆盖真实驱动,人工验收项)
            (duplexMode !== 'simplex'
              ? t(
                  'page.grading.overlay.duplexManualHint',
                  '；若打印机不支持自动双面，请打印后手动双面',
                )
              : ''),
        )
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

  const suggestedSpecId = useMemo(() => {
    const first = Object.values(sizes)
      .flat()
      .find((s): s is { width: number; height: number } => !!s)
    return first ? (matchPaperSpec(first.width, first.height)?.spec.id ?? 'a4') : 'a4'
  }, [sizes])
  const effectiveSpecId = specId || suggestedSpecId
  const spec: PaperSpec = paperSpecById(effectiveSpecId)

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

  const savedRef = useRef({
    spec: task.overlayPrint?.paperSpecId,
    calib: task.overlayPrint?.calibration,
    device: task.overlayPrint?.deviceName,
  })
  useEffect(() => {
    if (viewMode === 'calibration') return
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
  }, [specId, calibration, task.id, viewMode, deviceName])

  const detect = async () => {
    setDetecting(true)
    try {
      const res = await getAPI().grading.detectQuads(task.id, { useAiFallback: true })
      const pages = res.data?.results.flatMap((r) => r.pages) ?? []
      const ok = pages.filter((p) => p.ok).length
      const fail = pages.length - ok
      if (pages.length === 0) {
        toast.warning(t('page.grading.overlay.detectEmpty', '未找到可对齐的试卷'))
      } else if (fail === 0) {
        toast.success(tr('page.grading.overlay.detectOk', { n: ok }, `对齐完成: ${ok} 页全部成功`))
      } else {
        toast.warning(
          tr(
            'page.grading.overlay.detectPartial',
            { ok, fail },
            `对齐完成: ${ok} 页成功,${fail} 页需手动对齐四角`,
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

  const templateActive = useMemo(() => {
    const tpl = task.overlayTemplate
    return !!tpl?.boxes && Object.keys(tpl.boxes).length > 0 && !!tpl.quads?.some((q) => q != null)
  }, [task])
  const tplLocated = Object.keys(task.overlayTemplate?.boxes ?? {}).length

  const needManual = useMemo(() => {
    if (templateActive) return []
    const byId = new Map(task.papers.map((p) => [p.id, p]))
    return views
      .map((v) => byId.get(v.paper.id) ?? v.paper)
      .filter(
        (p) => p.files.length > 0 && (!p.overlayQuads || p.overlayQuads.some((q) => q == null)),
      )
  }, [views, task, templateActive])

  const paperStatuses = useMemo(() => {
    const byId = new Map(task.papers.map((p) => [p.id, p]))
    return views.map((v, i) => {
      const paper = byId.get(v.paper.id) ?? v.paper
      const name = paper.studentName ?? t('print.gradingMarks.unassigned', '未归组')
      let status: AlignStatus = 'aligned'
      if (!templateActive) {
        const quads = paper.overlayQuads
        const missing = !quads || quads.some((q) => q == null)
        if (missing) status = 'manual'
        else if ((layouts[i]?.approxPages ?? 0) > 0) status = 'approx'
      }
      return { id: paper.id, name, status }
    })
  }, [views, task, templateActive, layouts, t])

  const statusCounts = useMemo(() => {
    let aligned = 0
    let approx = 0
    let manual = 0
    for (const p of paperStatuses) {
      if (p.status === 'aligned') aligned += 1
      else if (p.status === 'approx') approx += 1
      else manual += 1
    }
    return { aligned, approx, manual }
  }, [paperStatuses])

  const detectRef = useRef(detect)
  detectRef.current = detect
  const autoDetectRef = useRef(false)
  const anyQuadAttempted = task.papers.some((p) => (p.overlayQuads?.length ?? 0) > 0)
  useEffect(() => {
    if (autoDetectRef.current || anyQuadAttempted || needManual.length === 0) return
    autoDetectRef.current = true
    void detectRef.current()
  }, [anyQuadAttempted, needManual])

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

  const currentPaperId = activePaperId ?? views[0]?.paper.id ?? null

  const jumpToPaper = (id: string) => {
    setActivePaperId(id)
    setViewMode('papers')
    paperAnchorRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const openManualAlign = (paperId: string) => {
    const byId = new Map(task.papers.map((p) => [p.id, p]))
    const paper = byId.get(paperId)
    if (!paper) return
    const missingPages = (paper.overlayQuads ?? paper.files.map(() => null))
      .map((q, i) => (q == null ? i : -1))
      .filter((i) => i >= 0)
    setQuadEditor({ paperId, page: missingPages[0] ?? 0 })
  }

  useEffect(() => {
    if (!printArmed) return
    const timer = window.setTimeout(() => {
      window.print()
      setPrintArmed(false)
      setPrintOnlyId(null)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [printArmed])

  const testPrintCurrent = () => {
    if (viewMode !== 'papers') {
      window.print()
      return
    }
    if (!currentPaperId) {
      window.print()
      return
    }
    setPrintOnlyId(currentPaperId)
    setPrintArmed(true)
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

  const openMaster = async () => {
    setViewMode('master')
    await loadMaster()
  }

  return (
    <div className="overlay-workspace text-gray-900">
      <style>{`@media print { @page { size: ${spec.widthMm}mm ${spec.heightMm}mm; margin: 0; } }`}</style>

      <div className="overlay-screen-only overlay-workbench">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-wide text-red-700/80">
              {t('page.grading.overlay.kicker', '红笔套回原卷')}
            </p>
            <h2 className="text-base font-semibold text-gray-900">
              {t('page.grading.overlay.heroTitle', '套打原卷')}
            </h2>
            <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-gray-600">
              {t(
                'page.grading.overlay.heroBody',
                '只打印分数、对错和批注。把学生写过的原卷放进打印机,红笔会落在对应题目旁边。',
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <StatusPill tone="ok">
              {tr(
                'page.grading.overlay.alignedCount',
                { n: statusCounts.aligned },
                `${statusCounts.aligned} 份已对齐`,
              )}
            </StatusPill>
            {statusCounts.approx > 0 && (
              <StatusPill tone="warn">
                {tr(
                  'page.grading.overlay.approxCount',
                  { n: statusCounts.approx },
                  `${statusCounts.approx} 份大致对齐`,
                )}
              </StatusPill>
            )}
            {statusCounts.manual > 0 && (
              <StatusPill tone="bad">
                {tr(
                  'page.grading.overlay.needCount',
                  { n: statusCounts.manual },
                  `${statusCounts.manual} 份需手动对齐`,
                )}
              </StatusPill>
            )}
            {templateActive && (
              <StatusPill tone="ok">
                {tr(
                  'page.grading.overlay.tplActive',
                  { n: tplLocated },
                  `样卷已统一 ${tplLocated} 题落点`,
                )}
              </StatusPill>
            )}
          </div>
        </div>

        {viewMode === 'papers' && statusCounts.manual > 0 && (
          <p className="mt-2 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
            {t(
              'page.grading.overlay.manualBanner',
              '红字已按整页大致排好,但对位不准。点学生名手动对齐四角,或先「自动对齐」。',
            )}
          </p>
        )}
        {viewMode === 'papers' && statusCounts.manual === 0 && statusCounts.approx > 0 && (
          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            {t(
              'page.grading.overlay.approxBanner',
              '部分卷是估算位置,可以先试打一张看准不准。要更准请自动对齐,或用空白样卷统一落点。',
            )}
          </p>
        )}
        {viewMode === 'calibration' && (
          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            {t(
              'page.grading.overlay.calibrationHint',
              '把这一页打到套打用的同款纸上。量 100mm 标尺得缩放,量左上十字线距纸边得左右/上下偏移,填进「微调对位」后再试打。',
            )}
          </p>
        )}
        {viewMode === 'master' && (
          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            {t(
              'page.grading.overlay.masterNote',
              '按 100% 实际大小打印后,就是下次考试带四角定位点的原卷。复印请保持 1:1。',
            )}
          </p>
        )}

        {paperStatuses.length > 0 && viewMode === 'papers' && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {paperStatuses.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => jumpToPaper(p.id)}
                className={cn(
                  'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  currentPaperId === p.id
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : p.status === 'manual'
                      ? 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100'
                      : p.status === 'approx'
                        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                )}
              >
                {p.status === 'aligned' ? '✓ ' : p.status === 'approx' ? '~ ' : '! '}
                {p.name}
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary"
            icon={<ScanLine size={13} />}
            loading={detecting}
            onClick={() => void detect()}
          >
            {detecting
              ? t('page.grading.overlay.detecting', '对齐中…')
              : t('page.grading.overlay.detect', '自动对齐')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={templateActive ? 'secondary' : 'outline'}
            onClick={() => setTplDialog(true)}
          >
            {templateActive
              ? t('page.grading.overlay.tplRecalibrate', '重新用样卷统一落点')
              : t('page.grading.overlay.tplCalibrate', '用空白样卷统一落点')}
          </Button>
          <span className="mx-1 hidden h-4 w-px bg-gray-200 sm:inline-block" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            icon={<Printer size={13} />}
            onClick={testPrintCurrent}
          >
            {t('page.grading.overlay.testPrint', '试打这一份')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="success"
            loading={silentPrinting}
            onClick={() => void silentPrint()}
          >
            {silentPrinting
              ? t('page.grading.overlay.silentDoing', '打印中…')
              : t('page.grading.overlay.batchPrint', '按顺序套打全班')}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-700">
          <label className="flex items-center gap-1.5">
            {t('page.grading.overlay.paperSpec', '纸张')}
            <select
              value={effectiveSpecId}
              onChange={(e) => setSpecId(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5"
            >
              {PAPER_SPECS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.widthMm}×{s.heightMm}mm)
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex items-center gap-1.5"
            title={t(
              'page.grading.overlay.duplexTitle',
              '双面打印由打印机驱动支持决定；不支持时请打印后手动双面',
            )}
          >
            {t('page.grading.overlay.duplex', '双面')}
            <select
              value={duplexMode}
              onChange={(e) => setDuplexMode(e.target.value as PrintDuplexMode)}
              className="rounded-md border border-gray-300 bg-white px-1.5 py-0.5"
            >
              <option value="simplex">{t('page.grading.overlay.duplexSimplex', '单面')}</option>
              <option value="longEdge">
                {t('page.grading.overlay.duplexLongEdge', '双面·长边翻')}
              </option>
              <option value="shortEdge">
                {t('page.grading.overlay.duplexShortEdge', '双面·短边翻')}
              </option>
            </select>
          </label>
          <div className="flex items-center rounded-md border border-gray-200 bg-gray-50 p-0.5">
            <button
              type="button"
              onClick={() => setShowUnderlay(true)}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-0.5',
                showUnderlay ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500',
              )}
            >
              <Eye size={12} />
              {t('page.grading.overlay.previewCompare', '对照原卷')}
            </button>
            <button
              type="button"
              onClick={() => setShowUnderlay(false)}
              className={cn(
                'inline-flex items-center gap-1 rounded px-2 py-0.5',
                !showUnderlay ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500',
              )}
            >
              <EyeOff size={12} />
              {t('page.grading.overlay.previewInk', '只看红字')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNudgeOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
          >
            {t('page.grading.overlay.nudge', '微调对位')}
            <ChevronDown
              size={12}
              className={cn('transition-transform', nudgeOpen && 'rotate-180')}
            />
          </button>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
          >
            {t('page.grading.overlay.more', '更多')}
            <ChevronDown
              size={12}
              className={cn('transition-transform', moreOpen && 'rotate-180')}
            />
          </button>
        </div>

        {nudgeOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-2 font-mono text-xs">
            <span className="font-sans text-gray-500">
              {t('page.grading.overlay.shiftX', '左右')}
            </span>
            <NudgeBtn onClick={() => stepCalibration('dxMm', -1)}>−</NudgeBtn>
            <span className="w-12 text-center">{calibration.dxMm.toFixed(1)}</span>
            <NudgeBtn onClick={() => stepCalibration('dxMm', 1)}>+</NudgeBtn>
            <span className="ml-2 font-sans text-gray-500">
              {t('page.grading.overlay.shiftY', '上下')}
            </span>
            <NudgeBtn onClick={() => stepCalibration('dyMm', -1)}>−</NudgeBtn>
            <span className="w-12 text-center">{calibration.dyMm.toFixed(1)}</span>
            <NudgeBtn onClick={() => stepCalibration('dyMm', 1)}>+</NudgeBtn>
            <span className="font-sans text-gray-500">mm</span>
            <span className="ml-2 font-sans text-gray-500">
              {t('page.grading.overlay.scale', '缩放')}
            </span>
            <NudgeBtn onClick={() => stepCalibration('scalePct', -1)}>−</NudgeBtn>
            <span className="w-14 text-center">{calibration.scalePct.toFixed(2)}%</span>
            <NudgeBtn onClick={() => stepCalibration('scalePct', 1)}>+</NudgeBtn>
            <Button
              type="button"
              size="xs"
              variant={viewMode === 'calibration' ? 'warning' : 'outline'}
              icon={<Ruler size={12} />}
              onClick={() => setViewMode((m) => (m === 'calibration' ? 'papers' : 'calibration'))}
            >
              {viewMode === 'calibration'
                ? t('page.grading.overlay.calibBack', '返回预览')
                : t('page.grading.overlay.calibOpen', '打印校准页')}
            </Button>
          </div>
        )}

        {moreOpen && (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-gray-200 bg-gray-50 px-2 py-2 text-xs">
            {printers.length > 0 && (
              <label className="flex items-center gap-1.5">
                {t('page.grading.overlay.printer', '打印机')}
                <select
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="max-w-44 rounded border border-gray-300 bg-white px-1.5 py-0.5"
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
            {templateActive && (
              <Button
                type="button"
                size="xs"
                variant={viewMode === 'master' ? 'warning' : 'outline'}
                onClick={() => {
                  if (viewMode === 'master') setViewMode('papers')
                  else void openMaster()
                }}
              >
                {viewMode === 'master'
                  ? t('page.grading.overlay.masterBack', '返回套打预览')
                  : t('page.grading.overlay.masterPrint', '打印带定位点的样卷')}
              </Button>
            )}
          </div>
        )}

        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          {t(
            'page.grading.overlay.printHint',
            '打印对话框选「实际大小 / 100%」,关掉「适应页面」。原卷压平、单张进纸,按上面学生顺序放,每 5 份抽查一次对位。',
          )}
        </p>
      </div>

      {viewMode === 'calibration' ? (
        <CalibrationPrintPage spec={spec} />
      ) : viewMode === 'master' && masterUrls && masterUrls.length > 0 ? (
        <div className="overlay-paper mb-6">
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
          const status = paperStatuses[vi]
          const student = status?.name ?? t('print.gradingMarks.unassigned', '未归组')
          const pageCount = Math.max(view.imageUrls.length, layout?.pages.length ?? 0)
          const paper = task.papers.find((p) => p.id === view.paper.id) ?? view.paper
          const skip = printOnlyId != null && printOnlyId !== view.paper.id
          return (
            <div
              key={view.paper.id}
              ref={(el) => {
                paperAnchorRefs.current[view.paper.id] = el
              }}
              className={cn('overlay-paper mb-8', skip && 'overlay-print-skip')}
            >
              <div className="overlay-screen-only mx-auto mb-2 flex w-full max-w-[210mm] items-center justify-between gap-2 px-1 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{student}</span>
                  <AlignBadge status={status?.status ?? 'aligned'} />
                </div>
                {status?.status === 'manual' && (
                  <button
                    type="button"
                    onClick={() => openManualAlign(view.paper.id)}
                    className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-100"
                  >
                    {t('page.grading.overlay.fixAlign', '手动对齐四角')}
                  </button>
                )}
              </div>
              {layout && layout.warnings.length > 0 && (
                <p className="overlay-screen-only mx-auto mb-2 max-w-[210mm] px-1 text-[11px] text-amber-800">
                  {layout.warnings.join(' · ')}
                </p>
              )}
              {Array.from({ length: pageCount }, (_, page) => {
                const stored = paper.overlayQuads?.[page]
                const size = sizes[view.paper.id]?.[page]
                const quad =
                  stored && size ? rescaleQuad(stored, size.width, size.height) : (stored ?? null)
                return (
                  <OverlayPage
                    // biome-ignore lint/suspicious/noArrayIndexKey: 静态页列表,页序即稳定键
                    key={`page-${page}`}
                    spec={spec}
                    underlayUrl={showUnderlay ? view.imageUrls[page] : undefined}
                    underlayQuad={quad}
                    underlaySize={size}
                    marks={layout?.pages[page]?.marks ?? []}
                    notes={layout?.pages[page]?.notes ?? []}
                    total={layout?.total && page === 0 ? layout.total : null}
                  />
                )
              })}
            </div>
          )
        })
      )}

      {tplDialog && (
        <TemplateCalibrateDialog
          taskId={task.id}
          onClose={() => setTplDialog(false)}
          onDone={onRefresh}
        />
      )}

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

function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
        tone === 'ok' && 'bg-emerald-50 text-emerald-800',
        tone === 'warn' && 'bg-amber-50 text-amber-900',
        tone === 'bad' && 'bg-red-50 text-red-800',
      )}
    >
      {tone === 'ok' ? <Check size={11} /> : <AlertTriangle size={11} />}
      {children}
    </span>
  )
}

function AlignBadge({ status }: { status: AlignStatus }) {
  const { t } = useT()
  if (status === 'aligned') {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
        {t('page.grading.overlay.statusAligned', '已对齐')}
      </span>
    )
  }
  if (status === 'approx') {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-900">
        {t('page.grading.overlay.statusApprox', '大致对齐')}
      </span>
    )
  }
  return (
    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-800">
      {t('page.grading.overlay.statusManual', '需对齐')}
    </span>
  )
}

function NudgeBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-gray-300 bg-white px-1.5 py-0.5 hover:bg-gray-50"
    >
      {children}
    </button>
  )
}

interface OverlayPageProps {
  spec: PaperSpec
  underlayUrl?: string
  underlayQuad?: PageQuad | null
  underlaySize?: { width: number; height: number }
  marks: OverlayPaperLayout['pages'][number]['marks']
  notes: OverlayPaperLayout['pages'][number]['notes']
  total: OverlayPaperLayout['total']
}

function OverlayPage({
  spec,
  underlayUrl,
  underlayQuad,
  underlaySize,
  marks,
  notes,
  total,
}: OverlayPageProps) {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const [pagePx, setPagePx] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const update = () => {
      const width = el.clientWidth
      const height = el.clientHeight
      if (width > 0 && height > 0) setPagePx({ width, height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const warp = useMemo(() => {
    if (!underlayQuad || !pagePx || !underlaySize) return null
    const h = quadToPageCssHomography(underlayQuad, pagePx.width, pagePx.height)
    if (!h) return null
    return homographyToCssMatrix3d(h)
  }, [underlayQuad, pagePx, underlaySize])

  return (
    <div
      ref={pageRef}
      className="overlay-page relative mx-auto overflow-hidden bg-white"
      style={{ width: `${spec.widthMm}mm`, height: `${spec.heightMm}mm` }}
    >
      {underlayUrl && warp && underlaySize ? (
        <img
          src={underlayUrl}
          alt=""
          className="overlay-underlay pointer-events-none absolute left-0 top-0 max-w-none"
          style={{
            width: `${underlaySize.width}px`,
            height: `${underlaySize.height}px`,
            transformOrigin: '0 0',
            transform: warp,
          }}
        />
      ) : underlayUrl && !underlayQuad ? (
        <img
          src={underlayUrl}
          alt=""
          className="overlay-underlay pointer-events-none absolute inset-0 h-full w-full object-fill"
        />
      ) : null}
      {total && (
        <div
          className="overlay-ink handwriting-mark absolute whitespace-nowrap text-red-700"
          style={{ left: `${total.xMm}mm`, top: `${total.yMm}mm` }}
        >
          <span style={{ fontSize: `${total.mainPt}pt`, lineHeight: 1 }}>{total.mainText}</span>
          <span style={{ fontSize: `${total.subPt}pt` }}>{total.subText}</span>
        </div>
      )}
      {marks.map((m) => (
        <div
          key={m.questionId}
          className="overlay-ink handwriting-mark absolute whitespace-nowrap leading-none text-red-700"
          style={{ left: `${m.xMm}mm`, top: `${m.yMm}mm`, fontSize: `${m.pt}pt` }}
        >
          {m.text}
        </div>
      ))}
      {notes.map((n) => (
        <div
          key={n.questionId}
          className="overlay-ink overlay-note handwriting-mark absolute text-red-800"
          style={{
            left: `${n.xMm}mm`,
            top: `${n.yMm}mm`,
            width: `${n.widthMm}mm`,
            fontSize: `${n.pt}pt`,
            lineHeight: `${n.lineHeightMm / ptToMm(n.pt)}`,
          }}
        >
          <div className="font-semibold whitespace-nowrap">{n.header}</div>
          {n.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 批注行序即稳定键
            <div key={`${n.questionId}-line-${i}`} className="whitespace-nowrap">
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

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
      <div
        className="overlay-page relative mx-auto bg-white"
        style={{ width: `${spec.widthMm}mm`, height: `${spec.heightMm}mm` }}
      >
        <div
          className="absolute border border-dashed border-gray-300"
          style={{
            left: '6mm',
            top: '6mm',
            width: `${spec.widthMm - 12}mm`,
            height: `${spec.heightMm - 12}mm`,
          }}
        />
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
