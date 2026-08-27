// =============================================================
// R2-05 测试 — 班级上下文注入
// 覆盖: (a) buildClassContextSection 纯函数输出(含缺字段省略)
//       (b) getClassContext 数据拼装(班级/人数/科目)
//       (c) 无班级 → null → 空段(不输出占位)
//       (d) 缓存失效
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const classMock = vi.hoisted(() => ({
  list: vi.fn(),
}))

const bridgeMock = vi.hoisted(() => ({
  execute: vi.fn(),
}))

const academicMock = vi.hoisted(() => ({
  getConfig: vi.fn(),
}))

vi.mock('../../src/main/services/class-service', () => ({ classService: classMock }))
vi.mock('../../src/main/services/eaa-bridge', () => ({ eaaBridge: bridgeMock }))
vi.mock('../../src/main/services/academic-service', () => ({ academicService: academicMock }))

import {
  buildClassContextSection,
  getClassContext,
  getClassContextSection,
  invalidateClassContextCache,
} from '../../src/main/services/agent/class-context'

const CLASS = {
  id: 'c1',
  class_id: 'G7-3',
  name: '七年级3班',
  grade: '七年级',
  teacher: '李老师',
  archived: 0,
}

const SUBJECTS = [
  { id: 'chinese', name: '语文' },
  { id: 'math', name: '数学' },
]

beforeEach(() => {
  vi.clearAllMocks()
  invalidateClassContextCache()
})

describe('buildClassContextSection 纯函数', () => {
  it('完整信息渲染全部字段', () => {
    const section = buildClassContextSection({
      className: '七年级3班',
      grade: '七年级',
      teacher: '李老师',
      studentCount: 48,
      subjects: ['语文', '数学'],
    })
    expect(section).toContain('班级：七年级3班')
    expect(section).toContain('年级：七年级')
    expect(section).toContain('学生人数：48')
    expect(section).toContain('考试科目：语文、数学')
    expect(section).toContain('实时核实')
  })

  it('null / 空班级返回空串(整段省略)', () => {
    expect(buildClassContextSection(null)).toBe('')
    expect(buildClassContextSection({ className: '' })).toBe('')
  })

  it('缺字段时对应行省略,段不缺失', () => {
    const section = buildClassContextSection({ className: '高一(2)班' })
    expect(section).toContain('班级：高一(2)班')
    expect(section).not.toContain('学生人数：')
    expect(section).not.toContain('年级：')
    expect(section).not.toContain('考试科目：')
  })
})

describe('getClassContext 数据拼装', () => {
  it('首个未存档班级 + list-students 人数 + 科目', async () => {
    classMock.list.mockReturnValue([CLASS])
    bridgeMock.execute.mockResolvedValue({
      success: true,
      data: [{ class_id: 'G7-3', name: '张三' }],
      stderr: '',
      exitCode: 0,
    })
    academicMock.getConfig.mockResolvedValue({ subjects: SUBJECTS })

    const info = await getClassContext()
    expect(info).toEqual({
      className: '七年级3班',
      grade: '七年级',
      teacher: '李老师',
      studentCount: 1,
      subjects: ['语文', '数学'],
    })
  })

  it('list-students 失败/空数据时降级为不注入人数', async () => {
    classMock.list.mockReturnValue([CLASS])
    bridgeMock.execute.mockRejectedValue(new Error('boom'))
    academicMock.getConfig.mockResolvedValue({ subjects: [] })

    const info = await getClassContext()
    expect(info?.className).toBe('七年级3班')
    expect(info?.studentCount).toBeUndefined()
  })

  it('无班级时返回 null,getClassContextSection 为空串', async () => {
    classMock.list.mockReturnValue([])
    expect(await getClassContext()).toBeNull()
    expect(await getClassContextSection()).toBe('')
  })
})

describe('缓存', () => {
  it('5 分钟内多次调用只读一次数据源,失效后重读', async () => {
    classMock.list.mockReturnValue([CLASS])
    bridgeMock.execute.mockResolvedValue({ success: true, data: [], stderr: '', exitCode: 0 })
    academicMock.getConfig.mockResolvedValue({ subjects: [] })

    await getClassContext()
    await getClassContext()
    expect(classMock.list).toHaveBeenCalledTimes(1)

    invalidateClassContextCache()
    await getClassContext()
    expect(classMock.list).toHaveBeenCalledTimes(2)
  })
})
