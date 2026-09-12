// canDeleteTask / isProtectedSystemTask
import { describe, expect, it } from 'vitest'
import {
  canDeleteTask,
  isAutoTask,
  isProtectedSystemTask,
} from '../../../../src/renderer/pages/Scheduler/lib/scheduler-utils'

describe('scheduler delete guards', () => {
  it('agent-schedule 可删; 系统内置任务不可删; 用户任务可删', () => {
    expect(isAutoTask('agent-schedule-a-0')).toBe(true)
    expect(canDeleteTask('agent-schedule-a-0')).toBe(true)
    expect(isProtectedSystemTask('feishu-bitable-sync')).toBe(true)
    expect(canDeleteTask('feishu-bitable-sync')).toBe(false)
    expect(canDeleteTask('auto-backup')).toBe(false)
    expect(canDeleteTask('task-123-abc')).toBe(true)
  })
})
