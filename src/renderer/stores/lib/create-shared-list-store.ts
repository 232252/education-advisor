// =============================================================
// 共享列表 store 工厂 — 跨页共享列表数据的通用骨架 (M20 模式)
//
// 把多页各自 fetch 各存一份组件 state 收敛为单一 zustand store:
//   - TTL 复用: STALE_MS 内的非强制 fetch 直接返回缓存
//   - 并发去重: 进行中的请求被后续非强制调用复用(多页同挂载只拉一次)
//   - 强制刷新: force:true 绕过 TTL;generation 递增使被 force 取代
//     的旧响应写入作废(防慢的旧请求覆盖新数据)
// 错误语义与原各页行为对齐: 仅 IPC 异常记入 error(success:false 的
// 业务失败保留旧数据、静默)。
// class/student 两个 store 为首批接入方;新增共享列表只需 3 行。
// =============================================================

import { create } from 'zustand'
import { errText } from '../../lib/ipc-client'

/** 非强制 fetch 的复用窗口(ms) */
const STALE_MS = 3_000

/** 取数函数: success=false 或 data 缺空视为业务失败(静默保旧数据) */
type SharedListFetcher<T> = () => Promise<{ success: boolean; data?: T[] | null }>

export interface SharedListState<T> {
  items: T[]
  loading: boolean
  /** 最近一次 IPC 异常的错误信息(success:false 业务失败不记) */
  error: string | null
  /** 最近一次成功拉取时间戳(0=从未成功),TTL 判断依据 */
  lastFetchedAt: number
  /** 首次拉取尝试是否已完成(无论成败) — 消费方据此推导初始 loading */
  settled: boolean
  /** 进行中的请求 promise(并发去重) */
  _pending: Promise<T[]> | null
  /** 请求代号: 递增使被 force 取代的旧响应写入作废 */
  _generation: number
  /** 拉取列表;force=true 绕过 TTL/并发去重(写后读、手动刷新用) */
  fetchItems: (opts?: { force?: boolean }) => Promise<T[]>
}

/** 测试辅助: 重置为初始状态(vitest 单文件多用例间隔离用) */
export function resetSharedListStore<T>(store: {
  setState: (s: Partial<SharedListState<T>>) => void
}): void {
  store.setState({
    items: [],
    loading: false,
    error: null,
    lastFetchedAt: 0,
    settled: false,
    _pending: null,
    _generation: 0,
  })
}

export function createSharedListStore<T>(fetcher: SharedListFetcher<T>) {
  return create<SharedListState<T>>((set, get) => ({
    items: [],
    loading: false,
    error: null,
    lastFetchedAt: 0,
    settled: false,
    _pending: null,
    _generation: 0,

    fetchItems: async (opts) => {
      const { items, lastFetchedAt, _pending } = get()
      // 非强制 + 数据新鲜 → 直接复用
      if (!opts?.force && lastFetchedAt > 0 && Date.now() - lastFetchedAt < STALE_MS) {
        return items
      }
      // 非强制 + 有进行中请求 → 并发去重
      if (!opts?.force && _pending) return _pending

      const gen = get()._generation + 1
      const p = (async () => {
        set({ loading: true, error: null, _generation: gen })
        try {
          const r = await fetcher()
          // 已被更新的请求(force)取代 → 丢弃本次响应,不写入
          if (gen !== get()._generation) return get().items
          if (r.success && r.data) {
            set({ items: r.data, lastFetchedAt: Date.now(), settled: true })
          } else {
            set({ settled: true })
          }
          return get().items
        } catch (err) {
          if (gen === get()._generation) {
            set({ error: errText(err), settled: true })
          }
          return get().items
        } finally {
          if (gen === get()._generation) {
            set({ loading: false, _pending: null })
          }
        }
      })()
      set({ _pending: p })
      return p
    },
  }))
}
