// =============================================================
// Identify Papers 纯函数测试 — prompt 契约 + JSON 解析
// =============================================================

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  return {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return `${tmpBase}/identify-papers-test-${Date.now()}`
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})
vi.mock('electron', () => ({ app: { getPath: mocks.getPath } }))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: () => ({}) },
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getApiKey: () => undefined },
}))
vi.mock('../../src/main/services/grading/grading-service', () => ({
  gradingService: {},
}))

import {
  buildIdentifyPrompt,
  parseIdentifyResponse,
} from '../../src/main/services/grading/identify-papers'

describe('buildIdentifyPrompt', () => {
  it('要求只读页眉姓名栏并输出 JSON', () => {
    const p = buildIdentifyPrompt()
    expect(p).toContain('姓名栏')
    expect(p).toContain('"name"')
    expect(p).toContain('"number"')
    expect(p).toContain('不要猜')
    expect(p).toContain('考号经常不等于学号')
  })
})

describe('parseIdentifyResponse', () => {
  it('标准 JSON 与数字编号', () => {
    expect(parseIdentifyResponse('{"name":"张三","number":"12"}')).toEqual({
      name: '张三',
      number: '12',
    })
    expect(parseIdentifyResponse('{"name":"李四","number":15}')).toEqual({
      name: '李四',
      number: '15',
    })
  })

  it('围栏与空字段', () => {
    expect(parseIdentifyResponse('```json\n{"name":"","number":""}\n```')).toEqual({
      name: '',
      number: '',
    })
    expect(parseIdentifyResponse('不是 json')).toEqual({ name: '', number: '' })
  })
})
