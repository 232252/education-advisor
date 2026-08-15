// =============================================================
// EAA IPC 缓存上下文 — staticCache / scoreCache 创建
// 从 eaa-handlers.ts 抽出,逻辑零修改(逐行对照搬迁)
// 注意: studentsCache / rankingCache / invalidateStudentsCache 保留在
// eaa-handlers.ts —— tests/e2e 的源码断言(page-render / user-flow-simulation)
// 依赖这些标识符出现在 eaa-handlers.ts 文件内容中,不可移动。
// =============================================================

import { TtlLruCache } from '../../services/eaa-cache'

/** 各 EAA handler 共享的缓存上下文(每次 registerEAAHandlers 调用时新建) */
export interface EaaCacheContext {
  /** 静态数据缓存: info/codes/doctor/replay/tag/stats/validate/summary 返回的数据在会话期间基本不变 */
  staticCache: TtlLruCache<unknown>
  /** score/history 缓存(3s,按学生名缓存) */
  scoreCache: TtlLruCache<unknown>
  /** 与原 setCached 行为一致:仅缓存 success:true 的对象 */
  setStaticCacheIfSuccess: (key: string, data: unknown) => void
}

export function createEaaCacheContext(): EaaCacheContext {
  // ----- 静态数据缓存 -----
  // info/codes/doctor/replay/tag/stats/validate/summary 返回的数据在会话期间基本不变,
  // 缓存以避免重复 spawn 子进程(~40ms/次)
  // 写操作(add-event/add-student/delete-student 等)完成后自动失效
  // MEDIUM 5.3: 用 TtlLruCache 替代手写 Map+TTL+LRU,行为逐字节等价
  // (过期主动删除 + 超容量删最旧 + 仅缓存 success:true 对象)
  const staticCache = new TtlLruCache<unknown>({ ttlMs: 30_000, maxEntries: 100 })

  /** 与原 setCached 行为一致:仅缓存 success:true 的对象 */
  function setStaticCacheIfSuccess(key: string, data: unknown): void {
    if (data && typeof data === 'object' && (data as { success?: boolean }).success) {
      staticCache.set(key, data)
    }
  }

  // ----- score: 查询单个学生分数 (缓存 3s,按学生名缓存) -----
  // H-3: 用 TtlLruCache 替代手写 Map+TTL+LRU,行为逐字节等价
  const scoreCache = new TtlLruCache<unknown>({ ttlMs: 3_000, maxEntries: 500 })

  return { staticCache, scoreCache, setStaticCacheIfSuccess }
}
