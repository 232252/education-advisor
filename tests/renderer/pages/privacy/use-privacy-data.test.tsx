// =============================================================
// usePrivacyData — 隐私控制中心 hook 测试
// 覆盖: 挂载状态探测(unlocked→已初始化)、handleInit 三态(短密码/
//       成功清密码/失败)、handleLoad(C-1 无 init 回退/错误密码不覆盖/
//       成功加载映射)、handleLock 全量复位、handlePreview 三态、
//       handleAddEntity(空名/查重/成功刷新映射并复位表单)
// =============================================================

import { act, renderHook, waitFor } from '@testing-library/react'
import { toastMocks } from '../../helpers/mock-toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  init: vi.fn(),
  load: vi.fn(),
  lock: vi.fn(),
  dryrun: vi.fn(),
  backup: vi.fn(),
  add: vi.fn(),
  list: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    privacy: {
      status: mocks.status,
      init: mocks.init,
      load: mocks.load,
      lock: mocks.lock,
      dryrun: mocks.dryrun,
      backup: mocks.backup,
      add: mocks.add,
      list: mocks.list,
    },
  }),
  getErrorMessage: (r: { error?: string }) => r?.error ?? '未知错误',
}))

vi.mock('../../../../src/renderer/stores/toastStore', async () => (await import('../../helpers/mock-toast')).mockToastStore)

import { usePrivacyData } from '../../../../src/renderer/pages/Privacy/hooks/usePrivacyData'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status.mockResolvedValue({ unlocked: false })
})

describe('挂载状态探测', () => {
  it('主进程已持锁 → 标记已初始化且 unlocked', async () => {
    mocks.status.mockResolvedValue({ unlocked: true })
    const { result } = renderHook(() => usePrivacyData())
    await waitFor(() => expect(result.current.isInitialized).toBe(true))
    expect(result.current.unlocked).toBe(true)
  })

  it('未解锁 → 保持初始态', async () => {
    const { result } = renderHook(() => usePrivacyData())
    await waitFor(() => expect(mocks.status).toHaveBeenCalled())
    expect(result.current.isInitialized).toBe(false)
    expect(result.current.unlocked).toBe(false)
  })
})

describe('handleInit', () => {
  it('密码过短 → 警告且不调用 IPC', async () => {
    const { result } = renderHook(() => usePrivacyData())
    act(() => result.current.setInitPassword('abc'))
    await act(async () => {
      await result.current.handleInit()
    })
    expect(toastMocks.warning).toHaveBeenCalled()
    expect(mocks.init).not.toHaveBeenCalled()
  })

  it('成功 → 初始化+解锁,渲染层密码立即清空', async () => {
    mocks.init.mockResolvedValue({ success: true })
    const { result } = renderHook(() => usePrivacyData())
    act(() => result.current.setInitPassword('secret123'))
    await act(async () => {
      await result.current.handleInit()
    })
    expect(mocks.init).toHaveBeenCalledWith('secret123', true)
    expect(result.current.isInitialized).toBe(true)
    expect(result.current.unlocked).toBe(true)
    expect(result.current.initPassword).toBe('')
  })

  it('success:false → 错误提示并保持未解锁', async () => {
    mocks.init.mockResolvedValue({ success: false, error: '已初始化' })
    const { result } = renderHook(() => usePrivacyData())
    act(() => result.current.setInitPassword('secret123'))
    await act(async () => {
      await result.current.handleInit()
    })
    expect(toastMocks.error).toHaveBeenCalled()
    expect(result.current.unlocked).toBe(false)
  })
})

describe('handleLoad(C-1: 失败不触发 init 覆盖隐私库)', () => {
  it('密码错误 → 仅报错,不调 init 不解锁', async () => {
    mocks.load.mockResolvedValue({ success: false, error: '密码错误' })
    const { result } = renderHook(() => usePrivacyData())
    act(() => result.current.setPassword('wrong'))
    await act(async () => {
      await result.current.handleLoad()
    })
    expect(mocks.load).toHaveBeenCalledWith('wrong')
    expect(mocks.init).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalled()
    expect(result.current.unlocked).toBe(false)
  })

  it('成功 → 解锁并加载映射表', async () => {
    mocks.load.mockResolvedValue({ success: true })
    mocks.list.mockResolvedValue({
      success: true,
      data: [{ entityType: 'person', realName: '张三', fakeName: '晓明' }],
    })
    const { result } = renderHook(() => usePrivacyData())
    act(() => result.current.setPassword('right'))
    await act(async () => {
      await result.current.handleLoad()
    })
    expect(result.current.unlocked).toBe(true)
    expect(result.current.isLoaded).toBe(true)
    expect(result.current.mappings).toEqual([
      { entityType: 'person', realName: '张三', fakeName: '晓明' },
    ])
  })
})

describe('handleLock / handlePreview', () => {
  it('锁定 → 全量复位', async () => {
    mocks.lock.mockResolvedValue({ success: true })
    const { result } = renderHook(() => usePrivacyData())
    act(() => {
      result.current.setInitPassword('x')
    })
    await act(async () => {
      await result.current.handleLock()
    })
    expect(result.current.unlocked).toBe(false)
    expect(result.current.isLoaded).toBe(false)
    expect(result.current.isInitialized).toBe(false)
    expect(result.current.mappings).toEqual([])
  })

  it('预览成功 → JSON 字符串;失败 → 错误文本', async () => {
    mocks.dryrun.mockResolvedValue({ success: true, data: { masked: '晓*' } })
    const { result } = renderHook(() => usePrivacyData())
    act(() => result.current.setPreviewInput('张三的作文'))
    await act(async () => {
      await result.current.handlePreview()
    })
    expect(result.current.previewResult).toBe(JSON.stringify({ masked: '晓*' }, null, 2))

    mocks.dryrun.mockResolvedValue({ success: false, error: '引擎未解锁' })
    await act(async () => {
      await result.current.handlePreview()
    })
    expect(result.current.previewResult).toContain('错误: 引擎未解锁')
  })

  it('预览空输入 → 不调用', async () => {
    const { result } = renderHook(() => usePrivacyData())
    await act(async () => {
      await result.current.handlePreview()
    })
    expect(mocks.dryrun).not.toHaveBeenCalled()
  })
})

describe('handleAddEntity', () => {
  /** 先经 handleLoad 注入映射表,再驱动添加实体 */
  async function setupWithMappings() {
    mocks.load.mockResolvedValue({ success: true })
    mocks.list.mockResolvedValue({
      success: true,
      data: [{ entityType: 'person', realName: 'Zhang San', fakeName: '晓明' }],
    })
    const { result } = renderHook(() => usePrivacyData())
    act(() => result.current.setPassword('right'))
    await act(async () => {
      await result.current.handleLoad()
    })
    return result
  }

  it('空名警告且不调用 IPC', async () => {
    const result = await setupWithMappings()
    await act(async () => {
      await result.current.handleAddEntity()
    })
    expect(toastMocks.warning).toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('person 类型大小写不敏感查重 → 警告且不调 IPC', async () => {
    const result = await setupWithMappings()
    act(() => {
      result.current.setNewEntityType('person')
      result.current.setNewEntityName('zhang san')
    })
    await act(async () => {
      await result.current.handleAddEntity()
    })
    expect(toastMocks.warning).toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('成功 → 刷新映射表/清空表单/复位类型/adding 复位', async () => {
    const result = await setupWithMappings()
    mocks.add.mockResolvedValue({ success: true })
    mocks.list.mockResolvedValue({
      success: true,
      data: [
        { entityType: 'person', realName: 'Zhang San', fakeName: '晓明' },
        { entityType: 'place', realName: '三中', fakeName: '某校' },
      ],
    })
    act(() => {
      result.current.setNewEntityType('place')
      result.current.setNewEntityName('三中')
    })
    await act(async () => {
      await result.current.handleAddEntity()
    })
    expect(mocks.add).toHaveBeenCalledWith('place', '三中')
    expect(result.current.mappings).toHaveLength(2)
    expect(result.current.newEntityName).toBe('')
    expect(result.current.newEntityType).toBe('person')
    expect(result.current.adding).toBe(false)
  })

  it('success:false → 错误提示且 adding 复位', async () => {
    const result = await setupWithMappings()
    mocks.add.mockResolvedValue({ success: false, error: '引擎未解锁' })
    act(() => result.current.setNewEntityName('新实体'))
    await act(async () => {
      await result.current.handleAddEntity()
    })
    expect(toastMocks.error).toHaveBeenCalled()
    expect(result.current.adding).toBe(false)
  })
})
