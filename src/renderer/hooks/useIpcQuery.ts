// =============================================================
// useIpcQuery — 单源 IPC 数据加载 hook
// 收口各页面重复的「useState 数据 + useState loading + useCallback
// load + useEffect 挂载触发 + try/catch/finally + console/toast」样板。
// 与 useMultiLoader 的分工: 多源并行聚合用 useMultiLoader,
// 单源加载(含级联 onData)用本 hook。
// 设计抉择:
//   1. stale guard: 令牌比对,慢响应不覆盖新数据,卸载后不写入 —
//      手写样板普遍缺这层,收口后统一获得
//   2. 失败默认 console.error(scope) + toast.error(errorKey);
//      传 onError 时完全接管(不再 toast,console 仍保留)
//   3. reload 返回本次加载的 Promise,调用方可 await 保持先后序
//   4. onData 在 try 内 await — 级联加载抛错走失败路径(与
//      useModelsData 原实现语义一致)
// =============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { toast } from '../stores/toastStore'
import { useMountedRef } from './useMountedRef'

interface UseIpcQueryOptions<T> {
  /** 变化时触发重新加载的依赖;默认仅挂载时加载一次 */
  deps?: unknown[]
  /**
   * loading 置位策略:
   *   'always'(默认) — 每次加载(含重载)前置 true
   *   'initial'      — 仅首次(数据为空时)置 true,重载不闪 loading
   */
  loadingMode?: 'always' | 'initial'
  /** 初始 loading 值(默认 true;依赖驱动的按需加载传 false) */
  initialLoading?: boolean
  /** 数据到达后的副作用(可 async,在 try 内 await,抛错走失败路径) */
  onData?: (data: T) => void | Promise<void>
  /** 自定义失败处理;不传则 console.error + toast.error(errorKey) */
  onError?: (err: unknown) => void
  /** 默认失败 toast 文案的 i18n key */
  errorKey?: string
  /** console 前缀 */
  scope?: string
  /** 失败时是否保留旧数据(默认保留;false = 置 null,如列表失败即清空) */
  keepDataOnError?: boolean
}

interface UseIpcQueryResult<T> {
  data: T | null
  loading: boolean
  /** 最近一次失败原因;加载开始即清空,成功后保持 null */
  error: unknown | null
  /** 重新加载;返回本次加载 Promise,可 await */
  reload: () => Promise<void>
}

export function useIpcQuery<T>(
  fetcher: () => Promise<T>,
  options: UseIpcQueryOptions<T> = {},
): UseIpcQueryResult<T> {
  const {
    deps = [],
    loadingMode = 'always',
    initialLoading = true,
    onData,
    onError,
    errorKey = 'error.unknown',
    scope = 'Query',
    keepDataOnError = true,
  } = options
  const { t } = useT()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(initialLoading)
  const [error, setError] = useState<unknown | null>(null)
  const tokenRef = useRef(0)
  const mountedRef = useMountedRef()
  // fetcher/onData/onError 每次渲染都变,用 ref 透传,由 deps 控制重载时机
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  // 'initial' 模式需判断是否已有数据;用 ref 镜像,避免 data 进 load 依赖
  //   (否则每次加载成功改变 load 身份 → effect 重跑 → 无限循环)
  const dataRef = useRef(data)
  dataRef.current = data

  const load = useCallback(async (): Promise<void> => {
    const token = ++tokenRef.current
    if (loadingMode === 'always' || dataRef.current === null) setLoading(true)
    setError(null)
    try {
      const result = await fetcherRef.current()
      if (!mountedRef.current || token !== tokenRef.current) return
      setData(result)
      const onDataCur = onDataRef.current
      if (onDataCur) await onDataCur(result)
    } catch (err) {
      if (!mountedRef.current || token !== tokenRef.current) return
      if (!keepDataOnError) setData(null)
      setError(err)
      const onErrorCur = onErrorRef.current
      if (onErrorCur) {
        onErrorCur(err)
      } else {
        console.error(`[${scope}] load failed:`, err)
        toast.error(t(errorKey))
      }
    } finally {
      if (mountedRef.current && token === tokenRef.current) setLoading(false)
    }
    // mountedRef 是稳定 ref 对象,入依赖仅为满足 exhaustive 检查,.current 读取不构成重载因子
  }, [loadingMode, keepDataOnError, scope, errorKey, t, mountedRef, ...deps])

  useEffect(() => {
    void load()
  }, [load])

  return { data, loading, error, reload: load }
}
