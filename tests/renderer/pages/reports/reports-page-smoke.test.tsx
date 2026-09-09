// =============================================================
// ReportsPage 冒烟测试 — 智能调优轮(2026-09-03)的高风险改动回归
// 背景: 列表加载曾收口至 useIpcQuery,并顺带修复"列表从未挂载加载,
// 首进恒空"的缺陷 — 本文件在页面级锁定该修复与错误态呈现。
// =============================================================

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setWindowApi, clearWindowApi } from '../../helpers/window-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportsPage } from '../../../../src/renderer/pages/Reports/ReportsPage'

const listMock = vi.hoisted(() => vi.fn())

beforeEach(() => {
  ;setWindowApi({
    reports: { list: listMock, read: vi.fn() },
    agent: { runManual: vi.fn() },
  })
})

afterEach(() => {
  clearWindowApi()
  vi.clearAllMocks()
})

const ENTRY = {
  name: 'weekly_report_2026-08-30.md',
  size: 1234,
  mtimeMs: 1756500000000,
  ext: '.md',
}

describe('ReportsPage 冒烟(挂载加载修复回归)', () => {
  it('首次进入自动加载列表 — 无需手点刷新(修复前恒为空)', async () => {
    listMock.mockResolvedValue({ success: true, entries: [ENTRY] })
    render(<ReportsPage />)
    // 列表行自动出现
    await waitFor(() => {
      expect(screen.getByText('weekly_report_2026-08-30.md')).toBeDefined()
    })
    // 计数条退出加载态
    expect(screen.getByText(/共 1 份/)).toBeDefined()
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('信封失败: 错误条呈现 + 空态兜底', async () => {
    listMock.mockResolvedValue({ success: false, error: 'read dir failed' })
    render(<ReportsPage />)
    await waitFor(() => {
      expect(screen.getByText('read dir failed')).toBeDefined()
    })
    expect(screen.getByText('暂无报告产物')).toBeDefined()
  })

  it('IPC 异常: errText 落入错误条', async () => {
    listMock.mockRejectedValue(new Error('ipc down'))
    render(<ReportsPage />)
    await waitFor(() => {
      expect(screen.getByText('ipc down')).toBeDefined()
    })
  })

  it('刷新按钮手动重拉列表', async () => {
    listMock.mockResolvedValue({ success: true, entries: [ENTRY] })
    render(<ReportsPage />)
    await waitFor(() => {
      expect(screen.getByText('weekly_report_2026-08-30.md')).toBeDefined()
    })
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2)
    })
  })
})
