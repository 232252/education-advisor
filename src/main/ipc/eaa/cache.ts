// =============================================================
// EAA IPC 缓存上下文 — staticCache / scoreCache 创建 + ranking 预热
// 从 eaa-handlers.ts 抽出,逻辑零修改(逐行对照搬迁)
// M18: prefillScoreCacheFromRanking 从 eaa/commands.ts 迁入(缓存预热归本文件,
// 参数组装归 params.ts); studentsCache / rankingCache / invalidateStudentsCache
// 位于 handlers-system.ts(随 ranking/list-students handler 一起迁入)
// =============================================================

import type { EAAResult } from '../../services/eaa-bridge'
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

/**
 * 用 ranking 结果预填充 scoreCache(按学生名缓存)。
 * 这样后续 eaa:score 调用可直接命中缓存,避免 spawn EAA 二进制 (~95ms → 0.2ms)。
 * 注意: scoreCache 按学生名缓存,ranking 的 name 字段是学生名,entity_id 是内部 ID。
 */
export function prefillScoreCacheFromRanking(
  scoreCache: TtlLruCache<unknown>,
  result: EAAResult | null | undefined,
): void {
  const data = result?.data as
    | {
        ranking?: Array<{
          entity_id: string
          name?: string
          score?: number
          class_id?: string | null
        }>
      }
    | undefined
  if (result?.success && data?.ranking) {
    for (const item of data.ranking) {
      const studentName = item.name ?? item.entity_id
      if (studentName && typeof item.score === 'number') {
        scoreCache.set(studentName, {
          success: true,
          data: { score: item.score, entity_id: item.entity_id, name: studentName },
        })
      }
    }
  }
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
