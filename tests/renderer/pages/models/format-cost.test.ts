import { describe, expect, it } from 'vitest'
import { formatCost, modelCostEditFields, modelCostUpdatesFromEdit } from '../../../../src/renderer/pages/Models/lib/format'

describe('formatCost', () => {
  it('标价 0 的 Highspeed 显示按套餐，真正的 0 价仍显示免费', () => {
    expect(formatCost(0, { id: 'glm-5.3-highspeed', name: 'GLM-5.3 Highspeed' })).toBe('按套餐')
    expect(formatCost(0, { id: 'qwen3:1.7b', name: 'Qwen3 1.7B' })).not.toBe('按套餐')
    expect(formatCost(0.3 / 1_000_000, { id: 'glm-4.6v', name: 'GLM-4.6V' })).toBe('$0.30/M')
  })

  it('编辑框用美元/百万，保存时再换回每 token', () => {
    const model = { costPerInputToken: 0.07 / 1_000_000, costPerOutputToken: 0.25 / 1_000_000 }
    expect(modelCostEditFields(model)).toEqual({
      costPerInputToken: '0.07',
      costPerOutputToken: '0.25',
    })
    expect(modelCostUpdatesFromEdit(model, modelCostEditFields(model))).toEqual({})
    expect(
      modelCostUpdatesFromEdit(model, { costPerInputToken: '0.30', costPerOutputToken: '0.25' }),
    ).toEqual({ costPerInputToken: 0.3 / 1_000_000 })
  })
})
