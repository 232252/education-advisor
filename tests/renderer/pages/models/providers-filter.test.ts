import { describe, expect, it } from 'vitest'
import type { ProviderInfo } from '@shared/types'
import { getVisibleProviders } from '../../../../src/renderer/pages/Models/lib/providers-filter'

function provider(p: Partial<ProviderInfo> & { id: string; name: string }): ProviderInfo {
  return { supportsOAuth: false, hasApiKey: false, modelCount: 1, ...p }
}

const FIXTURE: ProviderInfo[] = [
  provider({ id: 'openai', name: 'OpenAI' }),
  provider({ id: 'zai', name: '智谱 Z.AI（国际）' }),
  provider({ id: 'zai-coding-cn', name: '智谱（中国）' }),
  provider({ id: 'minimax-cn', name: 'MiniMax（中国）' }),
  provider({ id: 'qwen-token-plan-cn', name: '通义千问 Token Plan（中国）' }),
  provider({ id: 'hidden-one', name: 'Hidden', hidden: true }),
]

describe('getVisibleProviders 国内厂商别名', () => {
  it('空搜索只排除隐藏项', () => {
    const visible = getVisibleProviders(FIXTURE, '')
    expect(visible.map((p) => p.id)).toEqual([
      'openai',
      'zai',
      'zai-coding-cn',
      'minimax-cn',
      'qwen-token-plan-cn',
    ])
  })

  it('搜「智谱」命中 pi 的 zai / zai-coding-cn', () => {
    expect(getVisibleProviders(FIXTURE, '智谱').map((p) => p.id)).toEqual(['zai', 'zai-coding-cn'])
  })

  it('搜「智谱中国版」命中 zai-coding-cn', () => {
    const ids = getVisibleProviders(FIXTURE, '智谱中国版').map((p) => p.id)
    expect(ids).toContain('zai-coding-cn')
    expect(ids).not.toContain('openai')
  })

  it('搜「中国版」命中所有 CN 厂商', () => {
    const ids = getVisibleProviders(FIXTURE, '中国版').map((p) => p.id)
    expect(ids).toEqual(['zai-coding-cn', 'minimax-cn', 'qwen-token-plan-cn'])
  })

  it('搜 千问 / zhipu / glm 能命中', () => {
    expect(getVisibleProviders(FIXTURE, '千问').map((p) => p.id)).toEqual(['qwen-token-plan-cn'])
    expect(getVisibleProviders(FIXTURE, 'zhipu').map((p) => p.id)).toContain('zai-coding-cn')
    expect(getVisibleProviders(FIXTURE, 'glm').map((p) => p.id)).toContain('zai')
  })
})
