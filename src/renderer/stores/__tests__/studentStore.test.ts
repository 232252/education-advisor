// =============================================================
// studentStore — 共享数据层测试 (M20)
// 覆盖: TTL 复用 / 并发去重 / force 绕过 / 异常语义 /
//       success:false 静默 / generation 防慢请求覆盖 / refreshStudents
// =============================================================

import type { EAAStudent } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetStudentStoreForTest, useStudentStore } from '../student/store'

const apiMocks = vi.hoisted(() => ({
  listStudents: vi.fn(),
  invalidateCache: vi.fn(),
}))

function installApi() {
  ;(window as unknown as { api: unknown }).api = {
    eaa: {
      listStudents: apiMocks.listStudents,
      invalidateCache: apiMocks.invalidateCache,
    },
  }
}

function makeStudent(name: string, overrides: Partial<EAAStudent> = {}): EAAStudent {
  return {
    name,
    entity_id: name,
    score: 100,
    delta: 0,
    risk: '低',
    status: 'Active',
    events_count: 0,
    groups: [],
    roles: [],
    class_id: null,
    ...overrides,
  }
}

const studentsA = [makeStudent('甲')]
const studentsB = [makeStudent('乙'), makeStudent('丙')]

describe('studentStore (M20 共享数据层)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    resetStudentStoreForTest()
    apiMocks.listStudents.mockResolvedValue({ success: true, data: { students: studentsA } })
    apiMocks.invalidateCache.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('首次拉取: loading/settled/students 正确流转', async () => {
    expect(useStudentStore.getState().loading).toBe(false)
    expect(useStudentStore.getState().settled).toBe(false)

    const p = useStudentStore.getState().fetchStudents()
    expect(useStudentStore.getState().loading).toBe(true)

    const result = await p
    expect(result).toEqual(studentsA)
    const s = useStudentStore.getState()
    expect(s.students).toEqual(studentsA)
    expect(s.loading).toBe(false)
    expect(s.settled).toBe(true)
    expect(s.error).toBeNull()
    expect(s.lastFetchedAt).toBeGreaterThan(0)
    expect(apiMocks.listStudents).toHaveBeenCalledTimes(1)
  })

  it('TTL 复用: 3s 内非强制 fetch 直接返回缓存,不重复 spawn EAA', async () => {
    await useStudentStore.getState().fetchStudents()
    const again = await useStudentStore.getState().fetchStudents()
    expect(again).toEqual(studentsA)
    expect(apiMocks.listStudents).toHaveBeenCalledTimes(1)
  })

  it('并发去重: 进行中的请求被后续非强制调用复用(只 1 次 IPC)', async () => {
    let release: ((v: unknown) => void) | undefined
    apiMocks.listStudents.mockImplementationOnce(
      () =>
        new Promise((res) => {
          release = res
        }),
    )
    const p1 = useStudentStore.getState().fetchStudents()
    const p2 = useStudentStore.getState().fetchStudents()
    release?.({ success: true, data: { students: studentsA } })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual(studentsA) // 两个调用拿到同一份数据
    expect(r2).toEqual(studentsA)
    expect(apiMocks.listStudents).toHaveBeenCalledTimes(1)
  })

  it('force 绕过 TTL: 强制刷新总能拉到最新数据', async () => {
    await useStudentStore.getState().fetchStudents()
    apiMocks.listStudents.mockResolvedValue({ success: true, data: { students: studentsB } })
    const result = await useStudentStore.getState().fetchStudents({ force: true })
    expect(result).toEqual(studentsB)
    expect(useStudentStore.getState().students).toEqual(studentsB)
    expect(apiMocks.listStudents).toHaveBeenCalledTimes(2)
  })

  it('IPC 异常: 记录 error/settled,保留旧数据', async () => {
    await useStudentStore.getState().fetchStudents()
    apiMocks.listStudents.mockRejectedValue(new Error('ipc down'))
    const result = await useStudentStore.getState().fetchStudents({ force: true })
    const s = useStudentStore.getState()
    expect(result).toEqual(studentsA) // 旧数据保留
    expect(s.error).toBe('ipc down')
    expect(s.settled).toBe(true)
    expect(s.loading).toBe(false)
  })

  it('success:false 业务失败: 静默(不记 error),保留旧数据', async () => {
    await useStudentStore.getState().fetchStudents()
    apiMocks.listStudents.mockResolvedValue({ success: false, error: 'EAA internal error' })
    await useStudentStore.getState().fetchStudents({ force: true })
    const s = useStudentStore.getState()
    expect(s.students).toEqual(studentsA)
    expect(s.error).toBeNull()
    expect(s.settled).toBe(true)
  })

  it('generation 防覆盖: 慢的旧请求被 force 取代后,响应被丢弃', async () => {
    // 第一个请求挂起(模拟慢 EAA spawn)
    let releaseFirst: ((v: unknown) => void) | undefined
    apiMocks.listStudents.mockImplementationOnce(
      () =>
        new Promise((res) => {
          releaseFirst = res
        }),
    )
    apiMocks.listStudents.mockResolvedValue({ success: true, data: { students: studentsB } })

    const p1 = useStudentStore.getState().fetchStudents()
    // 挂起期间发生写操作 → force 拉取(gen 递增,取代旧请求)
    const p2 = useStudentStore.getState().fetchStudents({ force: true })
    await p2
    expect(useStudentStore.getState().students).toEqual(studentsB)

    // 旧请求此刻才返回(旧数据) — 必须被丢弃,不得覆盖新数据
    releaseFirst?.({ success: true, data: { students: studentsA } })
    await p1
    expect(useStudentStore.getState().students).toEqual(studentsB)
    expect(useStudentStore.getState().loading).toBe(false)
    expect(useStudentStore.getState()._pending).toBeNull()
  })

  it('refreshStudents: 先清 EAA 主进程缓存,再 force 拉取', async () => {
    await useStudentStore.getState().fetchStudents() // 1 次
    apiMocks.listStudents.mockResolvedValue({ success: true, data: { students: studentsB } })
    const result = await useStudentStore.getState().refreshStudents()
    expect(apiMocks.invalidateCache).toHaveBeenCalledTimes(1)
    expect(apiMocks.listStudents).toHaveBeenCalledTimes(2)
    expect(result).toEqual(studentsB)
  })

  it('refreshStudents: 清缓存失败不阻塞刷新', async () => {
    await useStudentStore.getState().fetchStudents()
    apiMocks.invalidateCache.mockRejectedValue(new Error('no eaa'))
    apiMocks.listStudents.mockResolvedValue({ success: true, data: { students: studentsB } })
    const result = await useStudentStore.getState().refreshStudents()
    expect(result).toEqual(studentsB)
    expect(apiMocks.listStudents).toHaveBeenCalledTimes(2)
  })
})
