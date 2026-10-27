// =============================================================
// overlay-calibration — 试打校准微调纯函数测试
// 锁定: 每字段步进量与小数位、双向值域钳制、浮点尾巴抹除、
// delta=0 等值不动、不改入参。
// =============================================================

import { describe, expect, it } from 'vitest'
import type { OverlayCalibration } from '@shared/overlay-layout'
import {
  CALIBRATION_STEP_SPECS,
  stepOverlayCalibration,
} from '../../../../src/renderer/components/print/overlay-calibration'

const BASE: OverlayCalibration = { dxMm: 0, dyMm: 0, scalePct: 100 }

describe('stepOverlayCalibration', () => {
  it('位移字段: 0.5 步进保留 1 位小数', () => {
    expect(stepOverlayCalibration(BASE, 'dxMm', 1)).toEqual({ ...BASE, dxMm: 0.5 })
    expect(stepOverlayCalibration({ ...BASE, dxMm: 12.5 }, 'dxMm', -1)).toEqual({
      ...BASE,
      dxMm: 12,
    })
    expect(stepOverlayCalibration(BASE, 'dyMm', -1)).toEqual({ ...BASE, dyMm: -0.5 })
  })

  it('缩放字段: 0.1 步进保留 2 位小数', () => {
    expect(stepOverlayCalibration(BASE, 'scalePct', 1)).toEqual({ ...BASE, scalePct: 100.1 })
    expect(stepOverlayCalibration({ ...BASE, scalePct: 100.1 }, 'scalePct', -1)).toEqual({
      ...BASE,
      scalePct: 100,
    })
  })

  it('值域钳制: dx/dy ±30,scalePct 90~110', () => {
    expect(stepOverlayCalibration({ ...BASE, dxMm: 29.8 }, 'dxMm', 1).dxMm).toBe(30)
    expect(stepOverlayCalibration({ ...BASE, dxMm: -29.8 }, 'dxMm', -1).dxMm).toBe(-30)
    expect(stepOverlayCalibration({ ...BASE, scalePct: 90.05 }, 'scalePct', -1).scalePct).toBe(90)
    expect(stepOverlayCalibration({ ...BASE, scalePct: 109.95 }, 'scalePct', 1).scalePct).toBe(110)
    // 已在边界: 继续同向不再越界
    expect(stepOverlayCalibration({ ...BASE, dxMm: 30 }, 'dxMm', 1).dxMm).toBe(30)
    expect(stepOverlayCalibration({ ...BASE, scalePct: 110 }, 'scalePct', 1).scalePct).toBe(110)
  })

  it('浮点尾巴抹除: 100.1 + 0.1 不产生 100.20000000000002 类噪声', () => {
    let c = { ...BASE, scalePct: 100.1 }
    for (let i = 0; i < 3; i++) c = stepOverlayCalibration(c, 'scalePct', 1)
    expect(c.scalePct).toBe(100.4)
  })

  it('delta=0 与不动入参: 返回等值新对象,原对象不被修改', () => {
    const input = { ...BASE, dxMm: 5 }
    const out = stepOverlayCalibration(input, 'dxMm', 0)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(input.dxMm).toBe(5)
  })

  it('字段规格表显式声明(新增校准字段须登记)', () => {
    expect(Object.keys(CALIBRATION_STEP_SPECS).sort()).toEqual(['dxMm', 'dyMm', 'scalePct'])
    expect(CALIBRATION_STEP_SPECS.scalePct).toEqual({ step: 0.1, round: 2, min: 90, max: 110 })
  })
})