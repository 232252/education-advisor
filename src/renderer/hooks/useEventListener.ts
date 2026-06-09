// =============================================================
// useEventListener — 全局事件监听 hook(自动清理)
// 用法: useEventListener('keydown', (e) => ...)
// =============================================================

import { useEffect, useRef } from 'react'

type Handler<E extends Event = Event> = (event: E) => void
type EventTarget = Window | HTMLElement | null

// overload 签名 — 不能有默认参数
export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: Handler<WindowEventMap[K]>,
  element?: EventTarget,
): void
export function useEventListener<E extends Event = Event>(
  eventName: string,
  handler: Handler<E>,
  element?: EventTarget,
): void
// 实现签名 — 可以有默认参数
export function useEventListener(
  eventName: string,
  handler: Handler,
  element: EventTarget = typeof window !== 'undefined' ? window : null,
): void {
  const savedHandler = useRef<Handler>(handler)

  useEffect(() => {
    savedHandler.current = handler
  }, [handler])

  useEffect(() => {
    if (!element) return
    const eventListener = (event: Event) => savedHandler.current(event)
    element.addEventListener(eventName, eventListener)
    return () => element.removeEventListener(eventName, eventListener)
  }, [eventName, element])
}
