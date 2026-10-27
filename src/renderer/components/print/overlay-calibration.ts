// =============================================================
// overlay-calibration — 试打校准微调纯函数
// 从 OverlayPrintDocument 的 stepCalibration 抽出:
// 每字段的步进量/小数位/值域(scalePct 90~110,dx/dy ±30mm)。
// 数值钳制与浮点取整是回归敏感点(0.1 累加的浮点尾巴必须抹掉),
// 抽出为纯函数以便单测。字段表显式声明,新增校准字段时在此登记,
// 组件侧零改动。
// =============================================================

import type { OverlayCalibration } from '@shared/overlay-layout'

interface CalibrationStepSpec {
  /** 每次微调的增量(乘以方向 ±1) */
  step: number
  /** 保留小数位(抹掉浮点累加尾巴) */
  round: number
  min: number
  max: number
}

export const CALIBRATION_STEP_SPECS: Record<keyof OverlayCalibration, CalibrationStepSpec> = {
  dxMm: { step: 0.5, round: 1, min: -30, max: 30 },
  dyMm: { step: 0.5, round: 1, min: -30, max: 30 },
  scalePct: { step: 0.1, round: 2, min: 90, max: 110 },
}

/** 沿指定字段微调一步(方向 ±1),值域钳制;返回新对象,不改入参 */
export function stepOverlayCalibration(
  cal: OverlayCalibration,
  key: keyof OverlayCalibration,
  delta: number,
): OverlayCalibration {
  const spec = CALIBRATION_STEP_SPECS[key]
  const v = Number((cal[key] + delta * spec.step).toFixed(spec.round))
  const clamped = Math.min(Math.max(v, spec.min), spec.max)
  return { ...cal, [key]: clamped }
}
