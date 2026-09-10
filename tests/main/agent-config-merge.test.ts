// =============================================================
// buildAgentConfig — capabilities 并集
// 覆盖: 旧 user override 快照不得删掉 yaml 后补的 class/import_students
// =============================================================

import { describe, expect, it } from 'vitest'
import { buildAgentConfig, mergeCapabilities } from '../../src/main/services/agent/config'

describe('mergeCapabilities', () => {
  it('无覆盖 → yaml 原样', () => {
    expect(mergeCapabilities(['read', 'class'])).toEqual(['read', 'class'])
    expect(mergeCapabilities(['read', 'class'], [])).toEqual(['read', 'class'])
  })

  it('旧快照缺 class → 并回 yaml 保底', () => {
    expect(mergeCapabilities(['read', 'class', 'import_students'], ['read', 'add_student'])).toEqual(
      ['read', 'class', 'import_students', 'add_student'],
    )
  })

  it('覆盖可额外增加 yaml 没有的能力', () => {
    expect(mergeCapabilities(['read'], ['read', 'escalate'])).toEqual(['read', 'escalate'])
  })

  it('yaml 非数组 → 只用覆盖', () => {
    expect(mergeCapabilities(undefined, ['class'])).toEqual(['class'])
    expect(mergeCapabilities('read', ['class'])).toEqual(['class'])
  })
})

describe('buildAgentConfig capabilities', () => {
  it('user override 旧名单不覆盖掉 yaml 的 class', () => {
    const cfg = buildAgentConfig(
      {
        id: 'main',
        name: '教育参谋',
        capabilities: ['read', 'class', 'import_students', 'revert'],
      },
      { enabled: true, capabilities: ['read', 'summary', 'add_student'] },
    )
    expect(cfg?.capabilities).toEqual(
      expect.arrayContaining(['read', 'class', 'import_students', 'revert', 'summary', 'add_student']),
    )
  })
})
