// =============================================================
// useStudentList — 学生列表数据加载域 hook 测试
// 覆盖: 加载学生/班级、Deleted 过滤、导出格式 fallback、
//       refreshStudents、archived 派生集合、entity_id 自动选中
// 需要 MemoryRouter 提供 useSearchParams 上下文
// =============================================================

import type { ReactNode } from 'react'
import { act } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClassEntity, EAAStudent } from '@shared/types'
import { useStudentList } from '../../../../src/renderer/pages/Students/hooks/useStudentList'
import { resetClassStoreForTest } from '../../../../src/renderer/stores/class/store'
import { resetStudentStoreForTest } from '../../../../src/renderer/stores/student/store'

// ---------- toast mock ----------

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
    warning: toastMocks.warning,
    info: toastMocks.info,
    show: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}))

// ---------- window.api mock ----------

const apiMocks = vi.hoisted(() => ({
  listStudents: vi.fn(),
  exportFormats: vi.fn(),
  invalidateCache: vi.fn(),
  classList: vi.fn(),
}))

function installApi() {
  ;(window as unknown as { api: unknown }).api = {
    eaa: {
      listStudents: apiMocks.listStudents,
      exportFormats: apiMocks.exportFormats,
      invalidateCache: apiMocks.invalidateCache,
    },
    class: { list: apiMocks.classList },
  }
}

// ---------- 测试数据 ----------

function makeStudent(overrides: Partial<EAAStudent>): EAAStudent {
  return {
    name: '学生',
    entity_id: 'e0',
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

const s1 = makeStudent({ name: '甲', entity_id: 'e1', class_id: 'G7-1' })
const s2 = makeStudent({ name: '乙', entity_id: 'e2', status: 'Deleted' })
const s3 = makeStudent({ name: '丙', entity_id: 'e3', class_id: 'G8-1' })

const classEntities: ClassEntity[] = [
  { id: '1', class_id: 'G7-1', name: '七年级1班', archived: false, created_at: 0 },
  { id: '2', class_id: 'G8-1', name: '八年级1班', archived: true, created_at: 0 },
]

function createWrapper(initialEntries: string[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  }
}

function setup(initialEntries: string[] = ['/']) {
  const setSelectedStudent = vi.fn()
  const utils = renderHook(() => useStudentList(setSelectedStudent), {
    wrapper: createWrapper(initialEntries),
  })
  return { ...utils, setSelectedStudent }
}

describe('useStudentList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApi()
    // M20: 学生/班级数据在共享 store(模块级单例),用例间必须重置,
    // 否则上一用例的 TTL 缓存会让下一用例跳过 fetch
    resetStudentStoreForTest()
    resetClassStoreForTest()
    apiMocks.listStudents.mockResolvedValue({
      success: true,
      data: { students: [s1, s2, s3], total: 3 },
    })
    apiMocks.classList.mockResolvedValue({ success: true, data: classEntities })
    apiMocks.exportFormats.mockResolvedValue(['csv', 'jsonl', 'html'])
    apiMocks.invalidateCache.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('初始 loading=true, 挂载后自动加载学生与班级', async () => {
    const { result } = setup()
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(apiMocks.listStudents).toHaveBeenCalledTimes(1)
    expect(apiMocks.classList).toHaveBeenCalledTimes(1)
  })

  it('加载结果过滤已删除(Deleted)学生', async () => {
    const { result } = setup()
    await waitFor(() => {
      expect(result.current.students).toHaveLength(2)
    })
    expect(result.current.students.map((s) => s.name)).toEqual(['甲', '丙'])
  })

  it('listStudents 抛错: toast.error 且 students 为空', async () => {
    apiMocks.listStudents.mockRejectedValue(new Error('ipc down'))
    const { result } = setup()

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.students).toEqual([])
    expect(toastMocks.error).toHaveBeenCalledTimes(1)
  })

  it('导出格式: 从 EAA 动态获取', async () => {
    apiMocks.exportFormats.mockResolvedValue(['csv', 'json', 'html'])
    const { result } = setup()
    await waitFor(() => {
      expect(result.current.exportFormats).toEqual(['csv', 'json', 'html'])
    })
  })

  it('导出格式: 获取失败时回退内置列表', async () => {
    apiMocks.exportFormats.mockRejectedValue(new Error('no eaa'))
    const { result } = setup()
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.exportFormats).toEqual(['csv', 'jsonl', 'html'])
  })

  it('导出格式: 空数组同样回退内置列表', async () => {
    apiMocks.exportFormats.mockResolvedValue([])
    const { result } = setup()
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.exportFormats).toEqual(['csv', 'jsonl', 'html'])
  })

  it('派生数据: archivedClassIds / classIdToName / activeClassList', async () => {
    const { result } = setup()
    await waitFor(() => {
      expect(result.current.classList).toHaveLength(2)
    })
    expect(result.current.archivedClassIds).toEqual(new Set(['G8-1']))
    expect(result.current.classIdToName).toEqual({
      'G7-1': '七年级1班',
      'G8-1': '八年级1班',
    })
    expect(result.current.activeClassList.map((c) => c.class_id)).toEqual(['G7-1'])
  })

  it('refreshStudents: 先清缓存再重新加载', async () => {
    const { result } = setup()
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.refreshStudents()
    })

    expect(apiMocks.invalidateCache).toHaveBeenCalledTimes(1)
    expect(apiMocks.listStudents).toHaveBeenCalledTimes(2)
  })

  describe('entity_id 自动选中(Dashboard 排行榜跳转)', () => {
    it('命中学生: 自动选中并只触发一次', async () => {
      const { result, setSelectedStudent } = setup(['/?entity_id=e1'])
      await waitFor(() => {
        expect(setSelectedStudent).toHaveBeenCalledTimes(1)
      })
      expect(setSelectedStudent).toHaveBeenCalledWith(s1)
      expect(result.current.students).toHaveLength(2)
    })

    it('entity_id 不存在: toast.warning 提示', async () => {
      const { setSelectedStudent } = setup(['/?entity_id=e-unknown'])
      await waitFor(() => {
        expect(toastMocks.warning).toHaveBeenCalledTimes(1)
      })
      expect(toastMocks.warning.mock.calls[0][0]).toContain('e-unknown')
      expect(setSelectedStudent).not.toHaveBeenCalled()
    })

    it('学生列表为空: toast.warning 提示且不选中', async () => {
      apiMocks.listStudents.mockResolvedValue({
        success: true,
        data: { students: [], total: 0 },
      })
      const { setSelectedStudent } = setup(['/?entity_id=e1'])

      await waitFor(() => {
        expect(toastMocks.warning).toHaveBeenCalledTimes(1)
      })
      expect(toastMocks.warning.mock.calls[0][0]).toContain('学生列表为空')
      expect(setSelectedStudent).not.toHaveBeenCalled()
    })

    it('无 entity_id 参数: 不触发选中逻辑', async () => {
      const { setSelectedStudent } = setup(['/'])
      await waitFor(() => {
        expect(setSelectedStudent).not.toHaveBeenCalled()
      })
      expect(toastMocks.warning).not.toHaveBeenCalled()
    })
  })
})