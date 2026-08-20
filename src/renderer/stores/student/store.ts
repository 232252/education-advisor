// =============================================================
// Student Store — EAA 学生列表共享数据层 (M20)
//
// 之前 Students/Classes/Dashboard/Academics 四页各自 fetch
// eaa.listStudents 并各存一份组件 state: 页面切换重复 spawn EAA
// 二进制(~95ms/次),且一处写后另一处不刷新。
// 收敛为单一 zustand store,四个消费域全部复用:
//   - TTL 复用: STALE_MS 内的非强制 fetch 直接返回缓存(跨页共享核心收益)
//   - 并发去重: 进行中的请求被后续非强制调用复用(多页同挂载只 spawn 一次)
//   - 强制刷新: 写后读/手动刷新 force:true 绕过 TTL;generation 递增使
//     被取代的旧响应写入作废(防止慢的旧请求覆盖新数据)
//   - 原始数据: store 存未过滤全量(含 Deleted),消费方按需过滤
//     (Students/Dashboard/Academics 过滤 Deleted;Classes 人数统计用全量)
// 错误语义与原四页行为对齐: 仅 IPC 异常记入 error(消费方自行 toast),
// success:false 的业务失败保留旧数据、静默。
// =============================================================

import type { EAAStudent } from '@shared/types'
import { create } from 'zustand'
import { getAPI } from '../../lib/ipc-client'

/** 非强制 fetch 的复用窗口(ms): 窗口内直接返回缓存,不 spawn EAA */
const STALE_MS = 3_000

export interface StudentState {
  /** EAA 全量学生(未过滤 Deleted) */
  students: EAAStudent[]
  loading: boolean
  /** 最近一次 IPC 异常的错误信息(success:false 业务失败不记,与原行为一致) */
  error: string | null
  /** 最近一次成功拉取时间戳(0=从未成功),TTL 判断依据 */
  lastFetchedAt: number
  /** 首次拉取尝试是否已完成(无论成败) — 消费方据此推导初始 loading */
  settled: boolean
  /** 进行中的请求 promise(并发去重) */
  _pending: Promise<EAAStudent[]> | null
  /** 请求代号: 递增使被 force 取代的旧响应写入作废 */
  _generation: number

  /** 拉取学生列表;force=true 绕过 TTL/并发去重(写后读、手动刷新用) */
  fetchStudents: (opts?: { force?: boolean }) => Promise<EAAStudent[]>
  /** 强制刷新: 先清 EAA 主进程读缓存,再 force 拉取 */
  refreshStudents: () => Promise<EAAStudent[]>
}

export const useStudentStore = create<StudentState>((set, get) => ({
  students: [],
  loading: false,
  error: null,
  lastFetchedAt: 0,
  settled: false,
  _pending: null,
  _generation: 0,

  fetchStudents: async (opts) => {
    const { students, lastFetchedAt, _pending } = get()
    // 非强制 + 数据新鲜 → 直接复用(跨页共享,零 spawn)
    if (!opts?.force && lastFetchedAt > 0 && Date.now() - lastFetchedAt < STALE_MS) {
      return students
    }
    // 非强制 + 有进行中请求 → 并发去重(多页同挂载只 spawn 一次)
    if (!opts?.force && _pending) return _pending

    // 发起新请求(强制或无可用缓存)
    const gen = get()._generation + 1
    const p = (async () => {
      set({ loading: true, error: null, _generation: gen })
      try {
        const r = await getAPI().eaa.listStudents()
        // 已被更新的请求(force)取代 → 丢弃本次响应,不写入
        if (gen !== get()._generation) return get().students
        if (r.success && r.data?.students) {
          set({ students: r.data.students, lastFetchedAt: Date.now(), settled: true })
        } else {
          // 业务失败(success:false): 保留旧数据,静默(与原四页行为一致)
          set({ settled: true })
        }
        return get().students
      } catch (err) {
        if (gen === get()._generation) {
          set({ error: err instanceof Error ? err.message : String(err), settled: true })
        }
        return get().students
      } finally {
        if (gen === get()._generation) {
          set({ loading: false, _pending: null })
        }
      }
    })()
    set({ _pending: p })
    return p
  },

  refreshStudents: async () => {
    try {
      await getAPI().eaa.invalidateCache()
    } catch {
      /* 清缓存失败不阻塞刷新 */
    }
    return get().fetchStudents({ force: true })
  },
}))

/** 测试辅助: 重置为初始状态(vitest 单文件多用例间隔离用) */
export function resetStudentStoreForTest(): void {
  useStudentStore.setState({
    students: [],
    loading: false,
    error: null,
    lastFetchedAt: 0,
    settled: false,
    _pending: null,
    _generation: 0,
  })
}
