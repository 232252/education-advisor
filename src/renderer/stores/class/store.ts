// =============================================================
// Class Store — 班级列表共享数据层 (M20)
//
// 与 student/store.ts 同构: 之前 Students/Classes/Dashboard/Academics
// 四页各自 fetch class.list 并各存一份组件 state。收敛为单一 store,
// TTL 复用 + 并发去重 + force 绕过 + generation 防覆盖。
// class.list 走本地 SQLite(极快),共享的主要收益不是省 spawn,
// 而是"一处写(建班/存档/删除)全局刷新"与状态单一来源。
// =============================================================

import type { ClassEntity } from '@shared/types'
import { create } from 'zustand'
import { getAPI } from '../../lib/ipc-client'

/** 非强制 fetch 的复用窗口(ms) */
const STALE_MS = 3_000

export interface ClassState {
  classes: ClassEntity[]
  loading: boolean
  /** 最近一次 IPC 异常的错误信息(success:false 业务失败不记,与原行为一致) */
  error: string | null
  /** 最近一次成功拉取时间戳(0=从未成功),TTL 判断依据 */
  lastFetchedAt: number
  /** 首次拉取尝试是否已完成(无论成败) — 消费方据此推导初始 loading */
  settled: boolean
  /** 进行中的请求 promise(并发去重) */
  _pending: Promise<ClassEntity[]> | null
  /** 请求代号: 递增使被 force 取代的旧响应写入作废 */
  _generation: number

  /** 拉取班级列表;force=true 绕过 TTL/并发去重(建班/存档/删除后重载用) */
  fetchClasses: (opts?: { force?: boolean }) => Promise<ClassEntity[]>
}

export const useClassStore = create<ClassState>((set, get) => ({
  classes: [],
  loading: false,
  error: null,
  lastFetchedAt: 0,
  settled: false,
  _pending: null,
  _generation: 0,

  fetchClasses: async (opts) => {
    const { classes, lastFetchedAt, _pending } = get()
    // 非强制 + 数据新鲜 → 直接复用
    if (!opts?.force && lastFetchedAt > 0 && Date.now() - lastFetchedAt < STALE_MS) {
      return classes
    }
    // 非强制 + 有进行中请求 → 并发去重
    if (!opts?.force && _pending) return _pending

    const gen = get()._generation + 1
    const p = (async () => {
      set({ loading: true, error: null, _generation: gen })
      try {
        const r = await getAPI().class.list()
        if (gen !== get()._generation) return get().classes
        if (r.success && r.data) {
          set({ classes: r.data, lastFetchedAt: Date.now(), settled: true })
        } else {
          // 业务失败: 保留旧数据,静默(与原四页行为一致)
          set({ settled: true })
        }
        return get().classes
      } catch (err) {
        if (gen === get()._generation) {
          set({ error: err instanceof Error ? err.message : String(err), settled: true })
        }
        return get().classes
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

/** 测试辅助: 重置为初始状态(vitest 单文件多用例间隔离用) */
export function resetClassStoreForTest(): void {
  useClassStore.setState({
    classes: [],
    loading: false,
    error: null,
    lastFetchedAt: 0,
    settled: false,
    _pending: null,
    _generation: 0,
  })
}
