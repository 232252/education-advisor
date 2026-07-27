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

import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseMultiLoaderOptions<TKeys extends string> {
  /** 重新加载的依赖（任意值变化会触发 reload）。默认只在挂载时加载一次。 */
  deps?: unknown[]
  /** 是否启用加载（默认 true；false 时不发起请求且 loading 立即为 false）。 */
  enabled?: boolean
  /** TypeScript 占位，防止外部误传 fetchers 到 options */
  _keys?: TKeys
}

export interface UseMultiLoaderResult<T extends Record<string, unknown>> {
  /** 仅包含成功加载的 key */
  data: Partial<T>
  loading: boolean
  /** 每个 key 的失败原因（成功 key 不在对象中） */
  errors: Partial<Record<keyof T, Error>>
  /** 手动重新加载 */
  reload: () => void
}

export function useMultiLoader<T extends Record<string, unknown>>(
  fetchers: { [K in keyof T]: () => Promise<T[K]> },
  options: UseMultiLoaderOptions<keyof T & string> = {},
): UseMultiLoaderResult<T> {
  const { deps = [], enabled = true } = options
  const [data, setData] = useState<Partial<T>>({})
  const [loading, setLoading] = useState(enabled)
  const [errors, setErrors] = useState<Partial<Record<keyof T, Error>>>({})
  // 用 token 区分每次加载，旧请求 resolve 时若 token 不匹配则丢弃
  const tokenRef = useRef(0)
  const mountedRef = useRef(true)

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
    const entries = Object.entries(fetchers) as Array<[keyof T & string, () => Promise<unknown>]>
    Promise.allSettled(entries.map(([, fn]) => fn())).then((results) => {
      if (!mountedRef.current) return
      if (token !== tokenRef.current) return // stale
      const nextData: Partial<T> = { ...data }
      const nextErrors: Partial<Record<keyof T, Error>> = {}
      results.forEach((r, i) => {
        const key = entries[i][0]
        if (r.status === 'fulfilled') {
          nextData[key] = r.value as T[typeof key]
        } else {
          nextErrors[key] = r.reason instanceof Error ? r.reason : new Error(String(r.reason))
        }
      })
      setData(nextData)
      setErrors(nextErrors)
      setLoading(false)
    })
  }, [enabled, ...deps])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // load 的 useCallback 依赖已包含所有重载驱动因子（enabled + deps）,
  //   enabled 作为额外守卫;显式列出 enabled 会与 load 双重触发
  // biome-ignore lint/correctness/useExhaustiveDependencies: load 已编码 enabled+deps,无需重复
  useEffect(() => {
    if (enabled) load()
  }, [load])

  return { data, loading, errors, reload: load }
}
