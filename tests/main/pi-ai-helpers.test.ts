// =============================================================
// pi-ai-helpers — 连接探测模型选择 / 套餐权限错误判定
// =============================================================

import type { Api, Model } from '@earendil-works/pi-ai/compat'
import { describe, expect, it } from 'vitest'
import {
  isAuthRejectedError,
  isModelPlanDeniedError,
  isQuotaGatedProbeModel,
  rankProbeModels,
  selectCheapestModel,
  selectProbeModel,
} from '../../src/main/services/pi-ai-helpers'

function model(id: string, input: number, output: number, name = id): Model<Api> {
  return { id, name, cost: { input, output } } as Model<Api>
}

describe('isQuotaGatedProbeModel', () => {
  it('识别智谱 Highspeed 套餐 SKU', () => {
    expect(isQuotaGatedProbeModel({ id: 'glm-5.2-highspeed' })).toBe(true)
    expect(isQuotaGatedProbeModel({ id: 'glm-5.3-highspeed', name: 'GLM-5.3 Highspeed' })).toBe(true)
    expect(isQuotaGatedProbeModel({ id: 'glm-5.2', name: 'GLM-5.2 Highspeed' })).toBe(true)
  })

  it('普通 / Flash 模型不是套餐专属', () => {
    expect(isQuotaGatedProbeModel({ id: 'glm-5.3-flash' })).toBe(false)
    expect(isQuotaGatedProbeModel({ id: 'glm-4.6v', name: 'GLM-4.6V' })).toBe(false)
    expect(isQuotaGatedProbeModel({ id: 'gpt-4o-mini' })).toBe(false)
  })
})

describe('selectProbeModel / rankProbeModels', () => {
  const zaiLike = [
    model('glm-4.6v', 0.3, 0.9),
    model('glm-5.2-highspeed', 0, 0, 'GLM-5.2 Highspeed'),
    model('glm-5.3-flash', 0.075, 0.25),
    model('glm-5.3-highspeed', 0, 0, 'GLM-5.3 Highspeed'),
    model('glm-4.7', 0.6, 2.2),
  ]

  it('selectCheapestModel 仍会选中标价 0 的 Highspeed', () => {
    expect(selectCheapestModel(zaiLike).id).toBe('glm-5.2-highspeed')
  })

  it('连接探测跳过 Highspeed,选最便宜的公开模型', () => {
    expect(selectProbeModel(zaiLike).id).toBe('glm-5.3-flash')
  })

  it('探测顺序按成本升序且不含 Highspeed', () => {
    expect(rankProbeModels(zaiLike).map((m) => m.id)).toEqual([
      'glm-5.3-flash',
      'glm-4.6v',
      'glm-4.7',
    ])
  })

  it('全部都是套餐专属时回退到全量列表', () => {
    const onlyGated = [
      model('glm-5.2-highspeed', 0, 0, 'GLM-5.2 Highspeed'),
      model('glm-5.3-highspeed', 1, 1, 'GLM-5.3 Highspeed'),
    ]
    expect(selectProbeModel(onlyGated).id).toBe('glm-5.2-highspeed')
  })

  it('空列表抛错', () => {
    expect(() => selectProbeModel([])).toThrow(/empty model list/)
  })
})

describe('isModelPlanDeniedError / isAuthRejectedError', () => {
  it('识别智谱 1311 套餐未开放', () => {
    const msg = '429: {"code":"1311","message":"当前订阅套餐暂未开放GLM-5.2-Highspeed权限"}'
    expect(isModelPlanDeniedError(msg)).toBe(true)
    expect(isAuthRejectedError(msg)).toBe(false)
  })

  it('识别英文套餐无权限', () => {
    expect(isModelPlanDeniedError('This model does not have access on your plan')).toBe(true)
  })

  it('401 / invalid key 视为密钥无效,不是套餐问题', () => {
    expect(isAuthRejectedError('401 Unauthorized')).toBe(true)
    expect(isAuthRejectedError('invalid api key')).toBe(true)
    expect(isModelPlanDeniedError('401 Unauthorized')).toBe(false)
  })
})
