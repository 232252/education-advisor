import { describe, expect, it } from 'vitest'
import { effectiveThinkingLevel, visibleThinkingLevels } from '../../src/shared/thinking-levels'

describe('visibleThinkingLevels', () => {
  it('没有目录时列出全部档', () => {
    expect(visibleThinkingLevels(undefined)).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('目录里写成空的档不出现，关始终保留', () => {
    expect(
      visibleThinkingLevels({
        minimal: null,
        low: 'low',
        medium: null,
        high: 'high',
        max: 'max',
      }),
    ).toEqual(['off', 'low', 'high', 'max'])
  })
})

describe('effectiveThinkingLevel', () => {
  it('当前模型没有选中的档时按关闭显示', () => {
    expect(effectiveThinkingLevel('medium', ['off', 'low', 'high'])).toBe('off')
    expect(effectiveThinkingLevel('high', ['off', 'low', 'high'])).toBe('high')
  })
})
