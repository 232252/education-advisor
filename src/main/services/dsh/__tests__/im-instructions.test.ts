import { describe, expect, it } from 'vitest'
import { composeImInstructions } from '../im-instructions'

describe('composeImInstructions', () => {
  it('把提示里的工具名改成这次挂载能调用的名字', () => {
    const text = composeImInstructions(
      {
        config: { name: '教育参谋', role: 'coordinator', description: '主协调' },
        soulContent: '先调用 eaa_score 再回答。',
        sharedRulesContent: '',
        rulesContent: '',
        skillsSection: '',
        steeringMode: 'all',
        followUpMode: 'one-at-a-time',
        showImages: true,
      },
      { eaa_score: 'mcp__im-1__eaa_score' },
    )
    expect(text).toContain('mcp__im-1__eaa_score')
    expect(text).not.toContain('调用 eaa_score')
    expect(text).toContain('即时消息')
    expect(text).toContain('confirm')
  })
})
