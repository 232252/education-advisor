// =============================================================
// Student Store — EAA 学生列表共享数据层 (M20)
// 之前四页各自 fetch eaa.listStudents 各存一份: 页面切换重复
// spawn EAA 二进制(~95ms/次),且一处写后另一处不刷新。收敛为
// 单一 store,Students/Classes/Dashboard/Academics 全部复用。
// TTL/并发去重/generation 语义见 lib/create-shared-list-store。
// store 存未过滤全量(含 Deleted),消费方按需过滤。
// =============================================================

import type { EAAStudent } from '@shared/types'
import { getAPI } from '../../lib/ipc-client'
import { createSharedListStore, resetSharedListStore } from '../lib/create-shared-list-store'

export const useStudentStore = createSharedListStore<EAAStudent>(async () => {
  const r = await getAPI().eaa.listStudents()
  return { success: r.success && !!r.data?.students, data: r.data?.students ?? null }
})

/** 强制刷新: 先清 EAA 主进程读缓存,再 force 拉取 */
export async function refreshStudents(): Promise<EAAStudent[]> {
  try {
    await getAPI().eaa.invalidateCache()
  } catch {
    /* 清缓存失败不阻塞刷新 */
  }
  return useStudentStore.getState().fetchItems({ force: true })
}

/** 测试辅助: 重置为初始状态(vitest 单文件多用例间隔离用) */
export const resetStudentStoreForTest = (): void => resetSharedListStore(useStudentStore)
