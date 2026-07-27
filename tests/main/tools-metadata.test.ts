// =============================================================
// EAA Tools — 工具定义元数据完整性测试
// 验证: 每个工具都有 name/label/description/parameters/execute
// 捕获: 缺失字段、空描述、重复名称
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'eaa-tools-meta-test'),
    isPackaged: false,
  },
}))

import { allEAATools } from '../../src/main/services/eaa-tools'
import { allFileTools } from '../../src/main/services/file-tools'
import { allUtilityTools } from '../../src/main/services/utility-tools'

const allTools = [...allEAATools, ...allFileTools, ...allUtilityTools]

describe('工具定义 — 元数据完整性', () => {
  it('全部工具数量应合理(>=18)', () => {
    expect(allTools.length).toBeGreaterThanOrEqual(18)
  })

  for (const tool of allTools) {
    describe(`工具 ${tool.name}`, () => {
      it('name 应为非空字符串', () => {
        expect(typeof tool.name).toBe('string')
        expect(tool.name.length).toBeGreaterThan(0)
      })

      it('label 应为非空字符串', () => {
        expect(typeof tool.label).toBe('string')
        expect(tool.label.length).toBeGreaterThan(0)
      })

      it('description 应为非空字符串', () => {
        expect(typeof tool.description).toBe('string')
        expect(tool.description.length).toBeGreaterThan(5)
      })

      it('parameters 应定义', () => {
        expect(tool.parameters).toBeDefined()
      })

      it('execute 应为函数', () => {
        expect(typeof tool.execute).toBe('function')
      })

      it('name 应为 snake_case', () => {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/)
      })
    })
  }
})

describe('工具定义 — 名称唯一性', () => {
  it('所有工具名称应唯一(无重复)', () => {
    const names = allTools.map((t) => t.name)
    const dups = names.filter((n, i) => names.indexOf(n) !== i)
    expect(dups).toEqual([])
  })
})

describe('工具定义 — 描述质量', () => {
  it('描述不应过短(<10 字符可能是占位)', () => {
    const tooShort = allTools.filter((t) => t.description.length < 10)
    expect(tooShort).toEqual([])
  })

  it('描述不应含 TODO/FIXME 占位符', () => {
    const placeholders = allTools.filter((t) =>
      /\b(TODO|FIXME|XXX|placeholder)\b/i.test(t.description),
    )
    expect(placeholders).toEqual([])
  })
})

describe('工具分组 — 各组完整性', () => {
  it('EAA 工具应包含核心工具(score/add/history/search)', () => {
    const names = allEAATools.map((t) => t.name)
    expect(names).toContain('eaa_score')
    expect(names).toContain('eaa_add_event')
    expect(names).toContain('eaa_history')
    expect(names).toContain('eaa_search')
  })

  it('文件工具应包含 6 个工具', () => {
    expect(allFileTools.length).toBe(6)
    const names = allFileTools.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('read_excel')
    expect(names).toContain('write_excel')
    expect(names).toContain('write_csv')
    expect(names).toContain('list_dir')
  })

  it('实用工具应包含 2 个工具(time + calculate)', () => {
    expect(allUtilityTools.length).toBe(2)
    const names = allUtilityTools.map((t) => t.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('calculate')
  })
})
