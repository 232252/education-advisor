import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TeacherConfirmRequest } from '../../src/shared/api/teacher-confirm'

const harness = vi.hoisted(() => {
  const listeners: Array<(req: TeacherConfirmRequest) => void> = []
  return {
    listeners,
    respond: vi.fn(async () => ({ success: true, data: true })),
  }
})

vi.mock('../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    teacherConfirm: {
      onRequest: (cb: (req: TeacherConfirmRequest) => void) => {
        harness.listeners.push(cb)
        return () => {
          const i = harness.listeners.indexOf(cb)
          if (i >= 0) harness.listeners.splice(i, 1)
        }
      },
      respond: harness.respond,
    },
  }),
}))

import { TeacherConfirmHost } from '../../src/renderer/components/TeacherConfirmHost'

describe('TeacherConfirmHost', () => {
  it('极致 AI 等教师点击；取消不把 confirm 参数当确认', async () => {
    harness.respond.mockClear()
    render(<TeacherConfirmHost />)
    expect(harness.listeners.length).toBeGreaterThan(0)
    harness.listeners[0]?.({ id: 'req-extreme', kind: 'extreme-grading', detail: '期中数学' })
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText(/期中数学/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(harness.respond).toHaveBeenCalledWith('req-extreme', false))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('删考试使用危险确认，教师点确认才回传', async () => {
    harness.respond.mockClear()
    const { unmount } = render(<TeacherConfirmHost />)
    const listener = harness.listeners[harness.listeners.length - 1]
    listener?.({ id: 'req-exam', kind: 'delete-exam', detail: '期中 (exam-1)' })
    expect(await screen.findByText('删除这场考试？')).toBeTruthy()
    expect(screen.getByText(/期中 \(exam-1\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(harness.respond).toHaveBeenCalledWith('req-exam', true))
    unmount()
  })
})
