import { describe, expect, it } from 'vitest'
import { providerDisplayName } from '@shared/provider-labels'

describe('provider-labels', () => {
  it('pi 中国区厂商用中文显示名', () => {
    expect(providerDisplayName('zai-coding-cn', 'Z.AI Coding CN')).toBe('智谱（中国）')
    expect(providerDisplayName('zai', 'Z.AI')).toBe('智谱 Z.AI（国际）')
    expect(providerDisplayName('minimax-cn', 'MiniMax CN')).toBe('MiniMax（中国）')
    expect(providerDisplayName('moonshotai-cn', 'Moonshot AI CN')).toBe('Moonshot AI（中国）')
    expect(providerDisplayName('qwen-token-plan-cn', 'Qwen Token Plan CN')).toBe(
      '通义千问 Token Plan（中国）',
    )
    expect(providerDisplayName('xiaomi-token-plan-cn', 'Xiaomi Token Plan CN')).toBe(
      '小米 Token Plan（中国）',
    )
    expect(providerDisplayName('openai', 'OpenAI')).toBe('OpenAI')
  })
})
