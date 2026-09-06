// =============================================================
// useIpcSubscription — IPC 事件订阅 hook
// 收口各页面反复手写的:
//   useEffect(() => { const unsub = getAPI().x.onY(cb); return unsub }, [deps])
// 挂载期订阅一次(mount-only),handler 经 ref 持有最新闭包 ——
// 与手写版把 handler 依赖放进 deps 的"总是最新"语义等价,但不会因
// 回调/依赖身份变化而反复退订重订。
// subscribe 包装为箭头传入即可: (cb) => getAPI().cron.onStatusUpdate(cb)
// =============================================================

import { useEffect, useRef } from 'react'

export function useIpcSubscription<T>(
  subscribe: (callback: (data: T) => void) => () => void,
  handler: (data: T) => void,
): void {
  const subscribeRef = useRef(subscribe)
  subscribeRef.current = subscribe
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => subscribeRef.current((d) => handlerRef.current(d)), [])
}
