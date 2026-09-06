// =============================================================
// useMultiLoader — 并行多源加载 hook
// 封装 Promise.allSettled + stale guard + reload，消除页面里重复的
//   Promise.allSettled([...]).then(r => r.forEach(... if fulfilled setX(...)))
// 样板。设计抉择：
//   1. 不调 toast —— 错误通过 errors 返回值暴露，由页面决定如何呈现
//      （与 useDataLoader 调 toast 的行为不同，是有意设计）
//   2. 不感知 IPC 的 {success, data?} 包裹结构 —— fetcher 在页面层
//      自行解包，hook 保持通用
// =============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMountedRef } from './useMountedRef'

export interface UseMultiLoaderOptions<TKeys extends string> {
  /** 重新加载的依赖（任意值变化会触发 reload）。默认只在挂载时加载一次。 */
  deps?: unknown[]
  /** 是否启用加载（默认 true；false 时不发起请求且 loading 立即为 false）。 */
  enabled?: boolean
  /** TypeScript 占位，防止外部误传 fetchers 到 options */
  _keys?: TKeys
}

/** 带 fallbacks 的选项: 兜底值须覆盖全部 key(类型强制),提供后 data 为完整对象 */
interface UseMultiLoaderFallbackOptions<T extends Record<string, unknown>> {
  deps?: unknown[]
  enabled?: boolean
  /**
   * 各 key 的兜底值: 未加载/加载失败的 key 落到兜底,消费端可整段删除
   * `data.x ?? 默认值` 归一化 useMemo 样板。
   * 注意: 传模块级常量 — 内联对象每次渲染变体会击穿下游 useMemo。
   */
  fallbacks: T
  _keys?: keyof T & string
}

export interface UseMultiLoaderResult<T extends Record<string, unknown>> {
  /** 仅包含成功加载的 key(fallbacks 模式下为覆盖全部 key 的完整对象) */
  data: Partial<T>
  loading: boolean
  /** 每个 key 的失败原因（成功 key 不在对象中） */
  errors: Partial<Record<keyof T, Error>>
  /** 已 settle（成功或失败）的 key 集合 — 渐进渲染:页面可按 key 先出卡片而非等全屏障 */
  readyKeys: Set<keyof T & string>
  /** 手动重新加载 */
  reload: () => void
}

export function useMultiLoader<T extends Record<string, unknown>>(
  fetchers: { [K in keyof T]: () => Promise<T[K]> },
  options?: UseMultiLoaderOptions<keyof T & string>,
): UseMultiLoaderResult<T>
export function useMultiLoader<T extends Record<string, unknown>>(
  fetchers: { [K in keyof T]: () => Promise<T[K]> },
  options: UseMultiLoaderFallbackOptions<T>,
): UseMultiLoaderResult<T> & { data: T }
export function useMultiLoader<T extends Record<string, unknown>>(
  fetchers: { [K in keyof T]: () => Promise<T[K]> },
  options: UseMultiLoaderOptions<keyof T & string> | UseMultiLoaderFallbackOptions<T> = {},
): UseMultiLoaderResult<T> {
  const { deps = [], enabled = true } = options
  const fallbacks = 'fallbacks' in options ? options.fallbacks : undefined
  const [data, setData] = useState<Partial<T>>({})
  const [loading, setLoading] = useState(enabled)
  const [errors, setErrors] = useState<Partial<Record<keyof T, Error>>>({})
  const [readyKeys, setReadyKeys] = useState<Set<keyof T & string>>(new Set())
  // 用 token 区分每次加载，旧请求 resolve 时若 token 不匹配则丢弃
  const tokenRef = useRef(0)
  const mountedRef = useMountedRef()

  // 注意：data 作为合并基线避免覆盖并发 reload 中间结果;fetchers 每次渲染都变,
  //   由 deps 显式控制重载时机（页面层应 memo fetchers 以避免无谓重载）
  // biome-ignore lint/correctness/useExhaustiveDependencies: data/fetchers 故意不进依赖,避免重渲染死循环
  const load = useCallback(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    const token = ++tokenRef.current
    setLoading(true)
    setErrors({})
    setReadyKeys(new Set())
    const entries = Object.entries(fetchers) as Array<[keyof T & string, () => Promise<unknown>]>
    // 逐 key settle 即写入(渐进渲染),全屏障只负责关闭 loading
    let pendingCount = entries.length
    if (pendingCount === 0) setLoading(false)
    const settleOne = (key: keyof T & string, r: PromiseSettledResult<unknown>) => {
      if (!mountedRef.current) return
      if (token !== tokenRef.current) return // stale
      setReadyKeys((prev) => new Set(prev).add(key))
      if (r.status === 'fulfilled') {
        setData((prev) => ({ ...prev, [key]: r.value as T[typeof key] }))
      } else {
        const reason = r.reason
        setErrors((prev) => ({
          ...prev,
          [key]: reason instanceof Error ? reason : new Error(String(reason)),
        }))
      }
      pendingCount -= 1
      if (pendingCount === 0) setLoading(false)
    }
    for (const [key, fn] of entries) {
      fn().then(
        (value) => settleOne(key, { status: 'fulfilled', value }),
        (reason) => settleOne(key, { status: 'rejected', reason }),
      )
    }
  }, [enabled, ...deps])

  // load 的 useCallback 依赖已包含所有重载驱动因子（enabled + deps）,
  //   enabled 作为额外守卫;显式列出 enabled 会与 load 双重触发
  // biome-ignore lint/correctness/useExhaustiveDependencies: load 已编码 enabled+deps,无需重复
  useEffect(() => {
    if (enabled) load()
  }, [load])

  // fallbacks 模式: 未加载/失败的 key 落到兜底值,data 变为覆盖全部 key 的完整对象。
  // 引用稳定性依赖调用方传模块级 fallbacks 常量(见选项注释)。
  const resolved = useMemo(() => {
    if (!fallbacks) return data
    const out = { ...data } as Record<string, unknown>
    for (const k of Object.keys(fallbacks)) {
      if (out[k] === undefined) out[k] = (fallbacks as Record<string, unknown>)[k]
    }
    return out as T
  }, [data, fallbacks])

  return { data: resolved, loading, errors, readyKeys, reload: load }
}
