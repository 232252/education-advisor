// =============================================================
// 自定义模型的视觉能力声明
//
// DSH 的 llm-pi-ai 模型条目用 input: ['text','image'] 声明视觉能力；
// 教师端自定义模型此前恒为 text，导致自建网关上的视觉模型无法用于
// 批改作业 / read_image。这里验证「教师声明 supportsImage → 全链路透传」。
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  customModels: {} as Record<string, Record<string, unknown>[]>,
}))

vi.mock('../../settings-service', () => ({
  settingsService: {
    getSettings: () => ({ models: { customModels: state.customModels } }),
    setCustomModels: (providerId: string, models: Record<string, unknown>[]) => {
      state.customModels[providerId] = models
    },
  },
}))

import { addCustomModelEntry, updateCustomModelEntry } from '../custom-models'
import { buildCustomModelInfos, resolveModel } from '../model-utils'

beforeEach(() => {
  state.customModels = {}
})

describe('自定义模型视觉能力', () => {
  it('addCustomModelEntry 保存教师声明的 supportsImage', () => {
    const info = addCustomModelEntry('my-gateway', { id: 'vl-model', supportsImage: true })
    expect(info.supportsImage).toBe(true)
    expect(state.customModels['my-gateway']?.[0]?.supportsImage).toBe(true)
  })

  it('未声明时按纯文本处理（不猜视觉能力）', () => {
    const info = addCustomModelEntry('my-gateway', { id: 'plain-model' })
    expect(info.supportsImage).toBe(false)
  })

  it('updateCustomModelEntry 可以后补视觉能力', () => {
    addCustomModelEntry('my-gateway', { id: 'vl-model' })
    expect(updateCustomModelEntry('my-gateway', 'vl-model', { supportsImage: true })).toBe(true)
    expect(state.customModels['my-gateway']?.[0]?.supportsImage).toBe(true)
  })

  it('resolveModel 把视觉能力带进 pi 兼容对象的 input', () => {
    addCustomModelEntry('my-gateway', { id: 'vl-model', supportsImage: true })
    const model = resolveModel('my-gateway', 'vl-model')
    expect(model?.input).toContain('image')
    const plain = resolveModel('my-gateway', 'plain-model')
    expect(plain).toBeUndefined()
  })

  it('buildCustomModelInfos 映射 supportsImage 供模型页与批改过滤', () => {
    const infos = buildCustomModelInfos('my-gateway', [
      {
        id: 'vl-model',
        name: 'VL',
        contextWindow: 32768,
        maxOutputTokens: 4096,
        supportsReasoning: false,
        costPerInputToken: 0,
        costPerOutputToken: 0,
        supportsImage: true,
      },
    ])
    expect(infos[0]?.supportsImage).toBe(true)
  })
})
