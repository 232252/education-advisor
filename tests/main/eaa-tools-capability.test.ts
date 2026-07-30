// =============================================================
// eaa-tools — getToolsByCapability 单元测试
// 验证 capability → tool 映射: all/* 通配、read/write 组合、单项、大小写、去重
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

// mock electron: eaa-tools → eaa-bridge 构造时调用 app.getPath('userData')
vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'eaa-tools-cap-test'),
    isPackaged: false,
  },
}))

import {
  allEAATools,
  dangerousEAATools,
  getToolsByCapability,
  addEventTool,
  addStudentTool,
  queryScoreTool,
  historyTool,
  searchEventsTool,
  listStudentsTool,
  rankingTool,
  statsTool,
  codesTool,
  summaryTool,
  rangeTool,
  setStudentMetaTool,
  revertEventTool,
  tagTool,
  deleteStudentTool,
} from '../../src/main/services/eaa-tools'

describe('getToolsByCapability — 通配符', () => {
  it('"all" 返回全部安全工具(14个,不含删除)', () => {
    const tools = getToolsByCapability(['all'])
    expect(tools.length).toBe(allEAATools.length)
    expect(new Set(tools).size).toBe(allEAATools.length)
    // GAP-1: 'all' 不应包含危险删除工具
    expect(tools).not.toContain(deleteStudentTool)
  })

  it('"*" 同样返回全部安全工具', () => {
    const tools = getToolsByCapability(['*'])
    expect(tools.length).toBe(allEAATools.length)
    expect(tools).not.toContain(deleteStudentTool)
  })

  it('大小写不敏感: ALL / All 也匹配', () => {
    expect(getToolsByCapability(['ALL']).length).toBe(allEAATools.length)
    expect(getToolsByCapability(['All']).length).toBe(allEAATools.length)
  })

  it('GAP-1 安全: 即使 all + delete 同时声明,删除工具仍需显式 delete 才出现', () => {
    // all 单独不含删除
    expect(getToolsByCapability(['all'])).not.toContain(deleteStudentTool)
    // 显式 delete 才获得
    const withDelete = getToolsByCapability(['all', 'delete'])
    expect(withDelete).toContain(deleteStudentTool)
    expect(withDelete.filter((t) => t === deleteStudentTool)).toHaveLength(1)
  })
})

describe('getToolsByCapability — 单项 capability', () => {
  it('score → [queryScoreTool]', () => {
    expect(getToolsByCapability(['score'])).toEqual([queryScoreTool])
  })
  it('add_event → [addEventTool]', () => {
    expect(getToolsByCapability(['add_event'])).toEqual([addEventTool])
  })
  it('history → [historyTool]', () => {
    expect(getToolsByCapability(['history'])).toEqual([historyTool])
  })
  it('search → [searchEventsTool]', () => {
    expect(getToolsByCapability(['search'])).toEqual([searchEventsTool])
  })
  it('list → [listStudentsTool]', () => {
    expect(getToolsByCapability(['list'])).toEqual([listStudentsTool])
  })
  it('ranking → [rankingTool]', () => {
    expect(getToolsByCapability(['ranking'])).toEqual([rankingTool])
  })
  it('stats → [statsTool]', () => {
    expect(getToolsByCapability(['stats'])).toEqual([statsTool])
  })
  it('codes → [codesTool]', () => {
    expect(getToolsByCapability(['codes'])).toEqual([codesTool])
  })
  it('summary → [summaryTool]', () => {
    expect(getToolsByCapability(['summary'])).toEqual([summaryTool])
  })
  it('add_student → [addStudentTool]', () => {
    expect(getToolsByCapability(['add_student'])).toEqual([addStudentTool])
  })
  it('range → [rangeTool]', () => {
    expect(getToolsByCapability(['range'])).toEqual([rangeTool])
  })
  it('set_student_meta → [setStudentMetaTool]', () => {
    expect(getToolsByCapability(['set_student_meta'])).toEqual([setStudentMetaTool])
  })
  it('revert → [revertEventTool]', () => {
    expect(getToolsByCapability(['revert'])).toEqual([revertEventTool])
  })
  it('tag → [tagTool]', () => {
    expect(getToolsByCapability(['tag'])).toEqual([tagTool])
  })
  it('delete → [deleteStudentTool]', () => {
    expect(getToolsByCapability(['delete'])).toEqual([deleteStudentTool])
  })
})

describe('getToolsByCapability — read / write 分组', () => {
  it('read 返回所有只读工具(含 tag,不含写操作)', () => {
    const tools = getToolsByCapability(['read'])
    const names = tools.map((t) => t.name)
    expect(names).toContain('eaa_score')
    expect(names).toContain('eaa_history')
    expect(names).toContain('eaa_search')
    expect(names).toContain('eaa_list_students')
    expect(names).toContain('eaa_ranking')
    expect(names).toContain('eaa_stats')
    expect(names).toContain('eaa_codes')
    expect(names).toContain('eaa_summary')
    expect(names).toContain('eaa_range')
    expect(names).toContain('eaa_tag') // GAP-1: tag 归入只读
    expect(names).not.toContain('eaa_add_event')
    expect(names).not.toContain('eaa_add_student')
    expect(names).not.toContain('eaa_set_student_meta')
    expect(names).not.toContain('eaa_revert_event')
    expect(tools.length).toBe(10)
  })

  it('write 返回 add_event + add_student + set_student_meta + revert', () => {
    const tools = getToolsByCapability(['write'])
    expect(tools).toEqual([addEventTool, addStudentTool, setStudentMetaTool, revertEventTool])
    // 危险的 delete 不在 write 里
    expect(tools).not.toContain(deleteStudentTool)
  })

  it('read + write 应去重并合并', () => {
    const tools = getToolsByCapability(['read', 'write'])
    // read(10) + write(4 个,均不在 read 中) = 14 (不含 delete)
    expect(tools.length).toBe(14)
    expect(tools).not.toContain(deleteStudentTool)
  })
})

describe('getToolsByCapability — 组合 / 边界', () => {
  it('多项 capability 合并去重', () => {
    const tools = getToolsByCapability(['score', 'score', 'history'])
    expect(tools.length).toBe(2)
  })

  it('read + 单项 → 去重(单项已在 read 中)', () => {
    const tools = getToolsByCapability(['read', 'ranking'])
    expect(tools.length).toBe(10) // ranking 已在 read 中,read 共 10 个
  })

  it('未知 capability → 空数组', () => {
    expect(getToolsByCapability(['unknown'])).toEqual([])
  })

  it('空数组 → 空结果', () => {
    expect(getToolsByCapability([])).toEqual([])
  })

  it('未知 + 已知混合: 只返回已知对应的', () => {
    const tools = getToolsByCapability(['unknown', 'score', 'another_unknown'])
    expect(tools).toEqual([queryScoreTool])
  })

  it('大小写: RANKING 与 ranking 等价', () => {
    expect(getToolsByCapability(['RANKING'])).toEqual([rankingTool])
    expect(getToolsByCapability(['Ranking'])).toEqual([rankingTool])
  })
})

describe('allEAATools — 集合完整性', () => {
  it('应包含全部 14 个安全工具,且 name 唯一', () => {
    expect(allEAATools.length).toBe(14)
    const names = allEAATools.map((t) => t.name)
    expect(new Set(names).size).toBe(14)
  })

  it('dangerousEAATools 仅含删除工具', () => {
    expect(dangerousEAATools).toEqual([deleteStudentTool])
    expect(allEAATools).not.toContain(deleteStudentTool)
  })
})
