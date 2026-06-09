// =============================================================
// useAutoDismiss — 自动清空消息状态（替代散落的 setTimeout）
// 修复 P2-6: 业务代码 7 处 setTimeout(() => setXxxMessage(''), 3000)
//   没有 cleanup,组件 unmount 后仍会 setState 触发 warning
//   且快速连续触发时多个 timer 互相覆盖
// 用法：
//   const [msg, setMsg] = useState('')
//   const setAutoMsg = useAutoDismiss(setMsg, '' /* clearTo */, 3000)
//   setAutoMsg('xxx')             // 3s 后自动 setMsg('')
//   setAutoMsg('yyy')             // 重置 timer, 3s 后 setMsg('')
//   setAutoMsg('zzz', 5000)       // 单次覆盖 delay 为 5s
// =============================================================

import { useCallback, useEffect, useRef } from 'react'

export function useAutoDismiss<T>(
  setValue: (value: T) => void,
  clearTo: T,
  delayMs: number = 3000,
): (value: T, delayMsOverride?: number) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const delayRef = useRef(delayMs)
  const clearToRef = useRef(clearTo)
  delayRef.current = delayMs
  clearToRef.current = clearTo

  // 清理上次的 timer
  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // 包装函数：每次 setValue 时重置 timer
  // 可选第二个参数:覆盖本次 delay(用于成功/失败用不同展示时长)
  const setWithAutoDismiss = useCallback(
    (value: T, delayMsOverride?: number) => {
      clear()
      setValue(value)
      const usedDelay =
        typeof delayMsOverride === 'number' &&
        Number.isFinite(delayMsOverride) &&
        delayMsOverride > 0
          ? delayMsOverride
          : delayRef.current
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setValue(clearToRef.current)
      }, usedDelay)
    },
    [setValue, clear],
  )

  // 组件 unmount 时清理
  useEffect(() => {
    return () => {
      clear()
    }
  }, [clear])

  return setWithAutoDismiss
}
