// =============================================================
// classStore — 共享数据层测试 (M20)
// 覆盖: TTL 复用 / 并发去重 / force 绕过 / 异常语义 / success:false 静默
// (generation 防覆盖逻辑与 studentStore 同构,studentStore.test.ts 已覆盖)
// =============================================================

import type { ClassEntity } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetClassStoreForTest, useClassStore } from '../class/store'

const apiMocks = vi.hoisted(() => ({
  classList: vi.fn(),
}))

function installApi() {
  ;(window as unknown as { api: unknown }).api = {
    class: { list: apiMocks.classList },
  }
}

const classesA: ClassEntity[] = [
  { id: '1', class_id: 'G7-1', name: '七年级1班', archived: false, created_at: 0 },
]
const classesB: ClassEntity[] = [
  { id: '2', class_id: 'G8-1', name: '八年级1班', archived: false, created_at: 0 },
]

describe('classStore (M20 共享数据层)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    resetClassStoreForTest()
    apiMocks.classList.mockResolvedValue({ success: true, data: classesA })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('首次拉取: loading/settled/classes 正确流转', async () => {
    const p = useClassStore.getState().fetchClasses()
    expect(useClassStore.getState().loading).toBe(true)
    const result = await p
    expect(result).toEqual(classesA)
    const s = useClassStore.getState()
    expect(s.classes).toEqual(classesA)
    expect(s.loading).toBe(false)
    expect(s.settled).toBe(true)
    expect(apiMocks.classList).toHaveBeenCalledTimes(1)
  })

  it('TTL 复用: 3s 内非强制 fetch 直接返回缓存', async () => {
    await useClassStore.getState().fetchClasses()
    const again = await useClassStore.getState().fetchClasses()
    expect(again).toEqual(classesA)
    expect(apiMocks.classList).toHaveBeenCalledTimes(1)
  })

  it('并发去重: 进行中的请求被后续非强制调用复用', async () => {
    let release: ((v: unknown) => void) | undefined
    apiMocks.classList.mockImplementationOnce(
      () =>
        new Promise((res) => {
          release = res
        }),
    )
    const p1 = useClassStore.getState().fetchClasses()
    const p2 = useClassStore.getState().fetchClasses()
    release?.({ success: true, data: classesA })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(classesA) // 两个调用拿到同一份数据
    expect(r2).toEqual(classesA)
    expect(apiMocks.classList).toHaveBeenCalledTimes(1)
  })

  it('force 绕过 TTL: 建班/存档后 force 刷新拿到最新列表', async () => {
    await useClassStore.getState().fetchClasses()
    apiMocks.classList.mockResolvedValue({ success: true, data: classesB })
    const result = await useClassStore.getState().fetchClasses({ force: true })
    expect(result).toEqual(classesB)
    expect(useClassStore.getState().classes).toEqual(classesB)
    expect(apiMocks.classList).toHaveBeenCalledTimes(2)
  })

  it('IPC 异常: 记录 error/settled,保留旧数据', async () => {
    await useClassStore.getState().fetchClasses()
    apiMocks.classList.mockRejectedValue(new Error('db locked'))
    const result = await useClassStore.getState().fetchClasses({ force: true })
    const s = useClassStore.getState()
    expect(result).toEqual(classesA)
    expect(s.error).toBe('db locked')
    expect(s.loading).toBe(false)
    expect(s.settled).toBe(true)
  })

  it('success:false 业务失败: 静默(不记 error),保留旧数据', async () => {
    await useClassStore.getState().fetchClasses()
    apiMocks.classList.mockResolvedValue({ success: false, error: 'internal' })
    await useClassStore.getState().fetchClasses({ force: true })
    const s = useClassStore.getState()
    expect(s.classes).toEqual(classesA)
    expect(s.error).toBeNull()
    expect(s.settled).toBe(true)
  })
})
