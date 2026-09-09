// =============================================================
// useMountedRef — 卸载守卫统一设施
// 组件卸载后置 false,异步回调据此丢弃 setState。
// 此前 useIpcQuery/useMultiLoader/useAgentAnalysis 各持一份手写拷贝,
// useCommunicationScript 拆出时漏拷了卸载 effect 致守卫静默失效(已修复),
// 故收口为共享 hook,杜绝再次漏拷。
// =============================================================

import { useEffect, useRef } from 'react'

export function useMountedRef() {
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  return mountedRef
}
