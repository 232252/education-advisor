// =============================================================
// channels/manifest 校验 — 飞书 manifest 与坏 manifest 的回归
// =============================================================

import { describe, expect, it } from 'vitest'
import type { ChannelManifest } from '@shared/types'
import { validateManifest } from '../../../src/main/services/channels/manifest'
import { feishuManifest } from '../../../src/main/services/channels/adapters/feishu/manifest'

/** 最小可过 manifest(坏例在其上改字段) */
function baseManifest(): ChannelManifest {
  return {
    id: 'demo',
    label: '演示渠道',
    description: 'desc',
    icon: 'demo',
    capabilities: {
      receivesVia: 'ws',
      streamingKind: 'none',
      canSendCard: false,
      maxTextLength: null,
      replyWindowMs: null,
      streamWindowMs: null,
      pushPolicy: 'free',
      receivesFiles: false,
    },
    configSchema: [{ name: 'token', label: 'Token', type: 'secret', required: true }],
  }
}

describe('validateManifest', () => {
  it('飞书 manifest 通过校验', () => {
    expect(validateManifest(feishuManifest)).toEqual([])
  })

  it('最小合法 manifest 通过校验', () => {
    expect(validateManifest(baseManifest())).toEqual([])
  })

  it('拒绝非法 id(须 kebab-case)', () => {
    const m = baseManifest()
    m.id = 'Feishu_Bot'
    expect(validateManifest(m)).toContainEqual(expect.stringMatching(/id 非法/))
  })

  it('拒绝重复字段名与 select 缺 options', () => {
    const m = baseManifest()
    m.configSchema = [
      { name: 'a', label: 'A', type: 'string' },
      { name: 'a', label: 'A2', type: 'string' },
      { name: 'mode', label: '模式', type: 'select' },
    ]
    const problems = validateManifest(m)
    expect(problems.some((p) => p.includes('重复'))).toBe(true)
    expect(problems.some((p) => p.includes('select') && p.includes('options'))).toBe(true)
  })

  it('拒绝 secret 带 default 与坏正则', () => {
    const m = baseManifest()
    m.configSchema = [
      { name: 'secretField', label: 'S', type: 'secret', default: 'must-not-be-here' },
      { name: 'bad', label: 'B', type: 'string', pattern: '([unclosed' },
    ]
    const problems = validateManifest(m)
    expect(problems.some((p) => p.includes('secret') && p.includes('default'))).toBe(true)
    expect(problems.some((p) => p.includes('pattern'))).toBe(true)
  })

  it('拒绝 showIf 引用不存在的字段', () => {
    const m = baseManifest()
    m.configSchema = [
      { name: 'a', label: 'A', type: 'string' },
      { name: 'b', label: 'B', type: 'string', showIf: { field: 'nope', equals: 1 } },
    ]
    expect(validateManifest(m).some((p) => p.includes('showIf'))).toBe(true)
  })

  it('缺 capabilities/setupGuide 空步骤被点名', () => {
    const m = baseManifest()
    const m2 = baseManifest()
    delete (m as { capabilities?: unknown }).capabilities
    m2.setupGuide = { title: 'T', steps: [] }
    expect(validateManifest(m).some((p) => p.includes('capabilities'))).toBe(true)
    expect(validateManifest(m2).some((p) => p.includes('setupGuide.steps'))).toBe(true)
  })
})
