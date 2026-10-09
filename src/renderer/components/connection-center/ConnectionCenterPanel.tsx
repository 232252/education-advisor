// =============================================================
// ConnectionCenterPanel — 连接中心弹出面板
//
// 主界面是 DeepSeek 官方 dsh-im。登录 cookie 不能进跨源 iframe，
// 所以这里只占一块区域，真正的页面由主进程贴到这块区域上。
// 打开后侧栏直接停在 IM 插件，飞书 / 企微 / 钉钉 / QQ 在这里登录。
// 外壳只留一条关闭和「数据同步」。标题和平台列表用官方页面自己的。
// =============================================================

import { Settings, X } from 'lucide-react'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'

const PANEL_GAP = 8
const PANEL_MIN_WIDTH = 480
const PANEL_MIN_HEIGHT = 420
/** 官方 IM 页在视口窄于 840px 时改成上下堆叠，频道栏会挤到二维码上面。 */
const IM_TWO_COLUMN_WIDTH = 860

interface ConnectionCenterPanelProps {
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLDivElement | null>
}

interface PanelBox {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 贴在侧栏右侧，占满剩余窗口。
 * 剩下的宽度不够官方 IM 页左右分栏时，改为铺满窗口，避免频道栏被挤到二维码上面。
 * 不用 transform 动画：原生子视图跟不上 CSS 位移，停下来会错一截。
 */
export function computePanelBox(
  anchor: HTMLElement,
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
): PanelBox {
  const entry = anchor.getBoundingClientRect()
  const aside = anchor.closest('aside')
  const sidebarRight = aside?.getBoundingClientRect().right ?? entry.right
  let left = Math.max(PANEL_GAP, Math.round(sidebarRight + PANEL_GAP))
  let width = Math.round(viewport.width - left - PANEL_GAP)
  if (width < IM_TWO_COLUMN_WIDTH) {
    left = PANEL_GAP
    width = Math.round(viewport.width - PANEL_GAP * 2)
  }
  const maxWidth = Math.max(0, Math.round(viewport.width - left - PANEL_GAP))
  const maxHeight = Math.max(0, Math.round(viewport.height - PANEL_GAP * 2))
  // 窗口放得下最小尺寸时再守住下限。放不下就贴住窗口，避免关闭按钮被挤出屏幕。
  width = Math.min(Math.max(width, Math.min(PANEL_MIN_WIDTH, maxWidth)), maxWidth)
  return { left, top: PANEL_GAP, width, height: maxHeight }
}

export function ConnectionCenterPanel({
  onClose,
  anchorRef,
  panelRef,
}: ConnectionCenterPanelProps) {
  const { t } = useT()
  const openFailed = t('connectionCenter.im.openFailed', 'IM 面板没有打开')
  const navigate = useNavigate()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<PanelBox>(() => {
    const anchor = anchorRef.current
    if (anchor && typeof window !== 'undefined') return computePanelBox(anchor)
    return {
      left: PANEL_GAP,
      top: PANEL_GAP,
      width:
        typeof window === 'undefined'
          ? PANEL_MIN_WIDTH
          : Math.min(PANEL_MIN_WIDTH, Math.max(0, window.innerWidth - PANEL_GAP * 2)),
      height:
        typeof window === 'undefined'
          ? PANEL_MIN_HEIGHT
          : Math.min(PANEL_MIN_HEIGHT, Math.max(0, window.innerHeight - PANEL_GAP * 2)),
    }
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (error) return
    const el = viewportRef.current
    if (!el) return
    let disposed = false
    let last = ''
    const push = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return
      const next = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
      if (next === last) return
      last = next
      void getAPI()
        .dshIm.show({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
        .then((result) => {
          if (disposed) return
          if (!result.ok) setError(result.error || openFailed)
        })
        .catch((err: unknown) => {
          if (!disposed) setError(err instanceof Error ? err.message : String(err))
        })
    }
    push()
    // 打开后的第一帧高度有时还是 0。补一次测量，之后只在区域真的变了再贴。
    const follow = window.requestAnimationFrame(() => push())
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => push()) : null
    ro?.observe(el)
    window.addEventListener('resize', push)
    return () => {
      disposed = true
      window.cancelAnimationFrame(follow)
      ro?.disconnect()
      window.removeEventListener('resize', push)
      void getAPI().dshIm.hide()
    }
  }, [error, openFailed])

  useEffect(() => {
    return getAPI().dshIm.onClosed(onClose)
  }, [onClose])

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const update = () => setPos(computePanelBox(anchor))
    update()
    window.addEventListener('resize', update)
    const aside = anchor.closest('aside')
    const ro = aside ? new ResizeObserver(update) : null
    if (aside) ro?.observe(aside)
    return () => {
      window.removeEventListener('resize', update)
      ro?.disconnect()
    }
  }, [anchorRef])

  const openSettings = () => {
    onClose()
    navigate('/settings#connection')
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={panelRef}
      data-testid="connection-center-panel"
      className="fixed bg-white dark:bg-surface-elevated rounded-xl shadow-2xl dark:shadow-[0_24px_64px_rgba(0,0,0,0.6)] dark:ring-1 dark:ring-white/[0.07] border border-gray-200/60 dark:border-white/[0.08] overflow-hidden z-[65] flex flex-col"
      style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height }}
    >
      <div className="flex items-center gap-2 px-2 h-9 border-b border-gray-200/70 dark:border-white/[0.07]">
        <span className="sr-only">{t('connectionCenter.title', '连接中心')}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openSettings}
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-1.5"
        >
          <Settings size={12} />
          {t('connectionCenter.openDataSync', '数据同步')}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close', '关闭')}
          className="p-1 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 bg-gray-50 dark:bg-black/20">
        {error ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-gray-700 dark:text-gray-200" data-testid="dsh-im-error">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                setError(null)
              }}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
            >
              {t('common.retry', '重试')}
            </button>
          </div>
        ) : (
          <div ref={viewportRef} data-testid="dsh-im-viewport" className="relative w-full h-full">
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400">
              {t('connectionCenter.im.loading', '正在打开 IM 插件…')}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
