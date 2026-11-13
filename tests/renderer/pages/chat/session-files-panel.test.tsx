// =============================================================
// SessionFilesPanel — 会话产出文件面板（列出 + 另存）
// =============================================================

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  listFiles: vi.fn(async () => ({
    success: true,
    files: [
      { path: '周报.md', size: 120 },
      { path: 'sub/数据.csv', size: 40 },
    ],
  })),
  saveAs: vi.fn(async () => ({ success: true, path: 'C:/saved/周报.md' })),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({ workspace: { listFiles: harness.listFiles, saveAs: harness.saveAs } }),
}))

import { SessionFilesPanel } from '../../../../src/renderer/pages/Chat/components/SessionFilesPanel'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SessionFilesPanel', () => {
  it('列出会话产出文件', async () => {
    render(<SessionFilesPanel sessionId="s1" />)
    expect(await screen.findByText('周报.md')).toBeTruthy()
    expect(screen.getByText('sub/数据.csv')).toBeTruthy()
    expect(harness.listFiles).toHaveBeenCalledWith('s1')
  })

  it('点另存调用 saveAs', async () => {
    render(<SessionFilesPanel sessionId="s1" />)
    await screen.findByText('周报.md')
    const buttons = screen.getAllByRole('button', { name: '另存' })
    fireEvent.click(buttons[0])
    await waitFor(() => expect(harness.saveAs).toHaveBeenCalledWith('s1', '周报.md'))
  })

  it('无会话 id 时不拉取', () => {
    render(<SessionFilesPanel sessionId="" />)
    expect(harness.listFiles).not.toHaveBeenCalled()
  })

  it('空目录显示空态', async () => {
    harness.listFiles.mockResolvedValueOnce({ success: true, files: [] })
    render(<SessionFilesPanel sessionId="s1" />)
    expect(await screen.findByText('本会话还没有产出文件')).toBeTruthy()
  })
})