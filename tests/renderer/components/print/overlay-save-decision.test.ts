// =============================================================
// overlay-save-decision — 套打设置防抖落盘决策纯函数测试
// 守护语义: 三值都未变 → 全 false 零 IPC;specId 空串(跟随
// 建议规格)永不落盘;calib 按字段级比较;首次无快照 calib 必存。
// =============================================================

import { describe, expect, it } from 'vitest'
import type { OverlayCalibration } from '@shared/overlay-layout'
import {
  decideOverlaySave,
  type OverlaySavedSnapshot,
} from '../../../../src/renderer/components/print/overlay-save-decision'

const CAL: OverlayCalibration = { dxMm: 0, dyMm: 0, scalePct: 100 }
const CAL2: OverlayCalibration = { dxMm: 1.5, dyMm: -0.5, scalePct: 98 }

function snapshot(over: Partial<OverlaySavedSnapshot> = {}): OverlaySavedSnapshot {
  return { spec: 'a4', calib: CAL, device: 'HP-1', ...over }
}

describe('decideOverlaySave', () => {
  it('三值都未变: 全 false(不发起落盘)', () => {
    const d = decideOverlaySave({
      specId: 'a4',
      calibration: CAL,
      deviceName: 'HP-1',
      saved: snapshot(),
    })
    expect(d).toEqual({ spec: false, calib: false, device: false })
  })

  it('specId 空串永不落盘,即使与快照不同', () => {
    const d = decideOverlaySave({
      specId: '',
      calibration: CAL,
      deviceName: 'HP-1',
      saved: snapshot(),
    })
    expect(d.spec).toBe(false)
  })

  it('spec/calib/device 各自独立判定', () => {
    const onlySpec = decideOverlaySave({
      specId: 'b5',
      calibration: CAL,
      deviceName: 'HP-1',
      saved: snapshot(),
    })
    expect(onlySpec).toEqual({ spec: true, calib: false, device: false })

    const onlyCalib = decideOverlaySave({
      specId: 'a4',
      calibration: CAL2,
      deviceName: 'HP-1',
      saved: snapshot(),
    })
    expect(onlyCalib).toEqual({ spec: false, calib: true, device: false })

    const onlyDevice = decideOverlaySave({
      specId: 'a4',
      calibration: CAL,
      deviceName: 'Canon-2',
      saved: snapshot(),
    })
    expect(onlyDevice).toEqual({ spec: false, calib: false, device: true })
  })

  it('calib 字段级比较: 单字段差异即触发;首次无快照必存', () => {
    for (const key of ['dxMm', 'dyMm', 'scalePct'] as const) {
      const c = { ...CAL, [key]: CAL[key] + 1 } as OverlayCalibration
      const d = decideOverlaySave({
        specId: 'a4',
        calibration: c,
        deviceName: 'HP-1',
        saved: snapshot(),
      })
      expect(d.calib).toBe(true)
    }

    const first = decideOverlaySave({
      specId: 'a4',
      calibration: CAL,
      deviceName: 'HP-1',
      saved: { spec: 'a4', device: 'HP-1' },
    })
    expect(first.calib).toBe(true)
  })

  it('数值语义相等不触发: 新对象同值 calib 仍判未变', () => {
    const d = decideOverlaySave({
      specId: 'a4',
      calibration: { ...CAL },
      deviceName: 'HP-1',
      saved: snapshot(),
    })
    expect(d.calib).toBe(false)
  })
})