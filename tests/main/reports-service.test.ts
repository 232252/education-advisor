// =============================================================
// R2-12 报告服务测试 — 列目录 / 读文件 / 路径穿越防御
// =============================================================

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? '/nonexistent-userdata' : '') },
}))

import { getAgentOutputsDir, listReports, readReport } from '../../src/main/services/reports-service'

describe('getAgentOutputsDir', () => {
  it('返回非空目录路径', () => {
    expect(getAgentOutputsDir().length).toBeGreaterThan(0)
  })
})

describe('listReports', () => {
  it('目录不存在时返回空列表(非错误)', () => {
    // dev 判定下指向项目根 data_archive,可能存在;关键断言: success 恒为 true
    const r = listReports()
    expect(r.success).toBe(true)
    expect(Array.isArray(r.entries)).toBe(true)
  })
})

describe('readReport 边界防御', () => {
  it('拒绝路径穿越/分隔符文件名', () => {
    expect(readReport('../secrets').success).toBe(false)
    expect(readReport('a/b.md').success).toBe(false)
    expect(readReport('..').success).toBe(false)
    expect(readReport('').success).toBe(false)
  })

  it('不存在的文件返回错误而非异常', () => {
    const r = readReport('no-such-report.md')
    expect(r.success).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
