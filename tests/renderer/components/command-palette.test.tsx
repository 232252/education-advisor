// =============================================================
// CommandPalette — 全局搜索面板组件测试
// 覆盖: Ctrl+K 开关、打开时加载数据且过滤 Deleted 学生、本地搜索
//       Enter 跳转、Escape/遮罩关闭、EAA 事件搜索防抖与陈旧响应守卫、
//       搜索失败提示、清空按钮
// =============================================================

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))

const mockListStudents = vi.fn().mockResolvedValue({ success: true, data: { students: [] } })
const mockListClasses = vi.fn().mockResolvedValue({ success: true, data: [] })
const mockEaaSearch = vi.fn()

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    eaa: { listStudents: mockListStudents, search: mockEaaSearch },
    class: { list: mockListClasses },
  }),
}))

const { CommandPalette } = await import('../../../src/renderer/components/command-palette/CommandPalette')
const { usePaletteStore } = await import('../../../src/renderer/stores/paletteStore')
const { useAgentStore } = await import('../../../src/renderer/stores/agent/store')

const student = (entity_id: string, name: string, status = 'Active') =>
  ({ entity_id, name, class_id: 'c1', status, score: 90 }) as never

function renderPalette() {
  return render(createElement(CommandPalette))
}

beforeEach(() => {
  vi.clearAllMocks()
  usePaletteStore.getState().setOpen(false)
  useAgentStore.setState({ agents: [] } as never)
})

describe('开关与数据加载', () => {
  it('Ctrl+K 打开面板,再按关闭', () => {
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('打开时加载数据并过滤 Deleted 学生', async () => {
    mockListStudents.mockResolvedValue({
      success: true,
      data: { students: [student('e1', '张三'), student('e2', '李四', 'Deleted')] },
    })
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await waitFor(() => expect(mockListStudents).toHaveBeenCalled())
    const input = screen.getByPlaceholderText(/搜索学生/)
    fireEvent.change(input, { target: { value: '张三' } })
    // 张三命中,已删除的李四不可见
    await waitFor(() => expect(screen.getByText('张三')).toBeTruthy())
    expect(screen.queryByText('李四')).toBeNull()
  })

  it('Enter 跳转选中结果并关闭面板', async () => {
    mockListStudents.mockResolvedValue({
      success: true,
      data: { students: [student('e1', '张三')] },
    })
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const input = await screen.findByPlaceholderText(/搜索学生/)
    fireEvent.change(input, { target: { value: '张三' } })
    await waitFor(() => expect(screen.getByText('张三')).toBeTruthy())
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigateMock).toHaveBeenCalledWith('/students?entity_id=e1')
    expect(usePaletteStore.getState().open).toBe(false)
  })
})

describe('关闭途径', () => {
  it('Escape 关闭面板', () => {
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(screen.getByPlaceholderText(/搜索学生/), { key: 'Escape' })
    expect(usePaletteStore.getState().open).toBe(false)
  })

  it('点击遮罩关闭,点击面板内部不关闭', () => {
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const dialog = screen.getByRole('dialog')
    const overlay = dialog.parentElement as HTMLElement
    fireEvent.mouseDown(dialog, { target: dialog }) // 面板内部 → 不关
    expect(usePaletteStore.getState().open).toBe(true)
    fireEvent.mouseDown(overlay, { target: overlay }) // 遮罩自身 → 关
    expect(usePaletteStore.getState().open).toBe(false)
  })
})

describe('EAA 事件异步搜索', () => {
  it('防抖后触发事件搜索并展示结果', async () => {
    vi.useFakeTimers()
    try {
      mockEaaSearch.mockResolvedValue({
        success: true,
        data: {
          events: [
            {
              event_id: 'ev1',
              name: '张三',
              reason_code: 'LATE',
              score_delta: -2,
              timestamp: '2026-09-01T08:00:00Z',
              entity_id: 'e1',
              is_valid: true,
            },
          ],
        },
      })
      renderPalette()
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      const input = screen.getByPlaceholderText(/搜索学生/)
      fireEvent.change(input, { target: { value: '张三' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(260)
      })
      expect(mockEaaSearch).toHaveBeenCalledWith('张三', 8)
      expect(screen.getByText(/LATE/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('陈旧响应守卫: 旧查询晚到的响应不覆盖新查询结果', async () => {
    vi.useFakeTimers()
    try {
      let resolveAb: (v: unknown) => void = () => {}
      mockEaaSearch.mockImplementation((q: string) => {
        if (q === 'ab') {
          return new Promise((res) => {
            resolveAb = res
          })
        }
        return Promise.resolve({
          success: true,
          data: { events: [{ event_id: 'ev9', name: 'ABC事件', reason_code: 'LATE', score_delta: 1, timestamp: '2026-09-02T08:00:00Z', entity_id: 'e9', is_valid: true }] },
        })
      })
      renderPalette()
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      const input = screen.getByPlaceholderText(/搜索学生/)
      fireEvent.change(input, { target: { value: 'ab' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(260) // 'ab' 的搜索已发出(挂起)
      })
      fireEvent.change(input, { target: { value: 'abc' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(260) // 'abc' 的搜索完成并渲染
      })
      expect(screen.getByText(/ABC事件/)).toBeTruthy()
      // 'ab' 的慢响应此刻才回来 — 应被 cancelled 守卫丢弃
      await act(async () => {
        resolveAb({
          success: true,
          data: { events: [{ event_id: 'evOld', name: '旧查询结果', reason_code: 'LATE', score_delta: 1, timestamp: '2026-09-01T08:00:00Z', entity_id: 'e1', is_valid: true }] },
        })
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.queryByText(/旧查询结果/)).toBeNull()
      expect(screen.getByText(/ABC事件/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('事件搜索失败时展示空态提示', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      mockEaaSearch.mockRejectedValue(new Error('boom'))
      renderPalette()
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      const input = screen.getByPlaceholderText(/搜索学生/)
      fireEvent.change(input, { target: { value: 'xyz' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(260)
      })
      expect(screen.getByText(/未找到匹配结果/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
      warn.mockRestore()
    }
  })
})
