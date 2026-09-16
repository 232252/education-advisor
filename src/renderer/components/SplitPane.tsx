// =============================================================
// SplitPane — 左右可拖动分栏(桌面鼠标拖拽,零依赖)
// 分隔条 mousedown 起拖 → window mousemove 改左栏占比 → mouseup 落定;
// 占比持久化到 localStorage(storageKey 必填,多实例互不串位),
// 双击分隔条恢复默认占比。拖拽期间全局禁用文本选择/统一列宽光标。
// =============================================================

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { cn } from '../lib/ui-utils'

interface SplitPaneProps {
  storageKey: string
  /** 左栏默认占比(0-1) */
  defaultRatio: number
  /** 占比钳制范围(0-1) */
  minRatio?: number
  maxRatio?: number
  className?: string
  /** 恰好两栏: [左, 右] */
  children: [ReactNode, ReactNode]
}

function clampRatio(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.min(max, Math.max(min, v))
}

function loadRatio(storageKey: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return fallback
    return clampRatio(Number.parseFloat(raw), 0.05, 0.95)
  } catch {
    return fallback
  }
}

export function SplitPane({
  storageKey,
  defaultRatio,
  minRatio = 0.2,
  maxRatio = 0.8,
  className,
  children,
}: SplitPaneProps) {
  const { t } = useT()
  const [ratio, setRatio] = useState(() => loadRatio(storageKey, defaultRatio))
  const [dragging, setDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const stopDrag = useCallback(() => setDragging(false), [])

  // 拖拽监听挂 window:鼠标移出分隔条甚至窗口仍可继续拖
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      setRatio(clampRatio((e.clientX - rect.left) / rect.width, minRatio, maxRatio))
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stopDrag()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stopDrag)
    window.addEventListener('keydown', onKey)
    // 拖拽期间禁文本选择 + 全窗口列宽光标,避免划选/光标闪烁
    const prevSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('keydown', onKey)
      document.body.style.userSelect = prevSelect
      document.body.style.cursor = prevCursor
    }
  }, [dragging, minRatio, maxRatio, stopDrag])

  // 落定时才写 localStorage(拖拽高频写盘无意义)
  useEffect(() => {
    if (dragging) return
    try {
      window.localStorage.setItem(storageKey, String(ratio))
    } catch {
      // 隐私模式等写入失败可忽略
    }
  }, [dragging, ratio, storageKey])

  return (
    <div ref={containerRef} className={cn('flex min-w-0 overflow-hidden', className)}>
      <div className="min-w-0 shrink-0 overflow-hidden" style={{ width: `${ratio * 100}%` }}>
        {children[0]}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={(e) => {
          // 左键起拖;双击复位由 onDoubleClick 处理
          if (e.button === 0) setDragging(true)
        }}
        onDoubleClick={() => setRatio(clampRatio(defaultRatio, minRatio, maxRatio))}
        className={cn(
          'w-1.5 shrink-0 cursor-col-resize bg-gray-200 transition-colors hover:bg-blue-300 dark:bg-white/[0.08] dark:hover:bg-blue-500/50',
          dragging && 'bg-blue-400 dark:bg-blue-500',
        )}
        title={t('common.splitPane.hint', '拖动调整分栏宽度 · 双击复位')}
      />
      <div className="min-w-0 flex-1 overflow-hidden">{children[1]}</div>
    </div>
  )
}
