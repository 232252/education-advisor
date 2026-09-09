// =============================================================
// Class Store — 班级列表共享数据层 (M20)
// class.list 走本地 SQLite(极快),共享的主要收益不是省 spawn,
// 而是"一处写(建班/存档/删除)全局刷新"与状态单一来源。
// TTL/并发去重/generation 语义见 lib/create-shared-list-store。
// =============================================================

import type { ClassEntity } from '@shared/types'
import { getAPI } from '../../lib/ipc-client'
import { createSharedListStore, resetSharedListStore } from '../lib/create-shared-list-store'

export const useClassStore = createSharedListStore<ClassEntity>(async () => {
  const r = await getAPI().class.list()
  return { success: r.success, data: r.data }
})

/** 测试辅助: 重置为初始状态(vitest 单文件多用例间隔离用) */
export const resetClassStoreForTest = (): void => resetSharedListStore(useClassStore)
