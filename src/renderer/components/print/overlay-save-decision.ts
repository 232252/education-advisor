// =============================================================
// overlay-save-decision — 套打设置防抖落盘的纯决策函数
// 从 OverlayPrintDocument 的 500ms 防抖 effect 中抽出:
// 给定当前 (specId, calibration, deviceName) 与上次已落盘快照,
// 判定哪几项需要写盘。抽出的动机: 这段逻辑守护着冗余 IPC 写
// (三值都未变则完全不发 saveOverlayPrint),是回归敏感点,
// 内联在 1079 行组件里不可单测。
// =============================================================

import type { OverlayCalibration } from '@shared/overlay-layout'

/** 上次成功落盘的快照(组件内以 ref 持有) */
export interface OverlaySavedSnapshot {
  spec?: string
  calib?: OverlayCalibration
  device?: string
}

export interface OverlaySaveDecisionInput {
  specId: string
  calibration: OverlayCalibration
  deviceName: string
  saved: OverlaySavedSnapshot
}

export interface OverlaySaveDecision {
  spec: boolean
  calib: boolean
  device: boolean
}

/** 三项中任一为 true 才应发起 saveOverlayPrint */
export function decideOverlaySave(input: OverlaySaveDecisionInput): OverlaySaveDecision {
  const { specId, calibration: c, deviceName, saved } = input
  // specId 为空串表示"未选择"(跟随建议规格),不落盘
  const spec = specId !== '' && specId !== saved.spec
  const prev = saved.calib
  const calib =
    !prev || prev.dxMm !== c.dxMm || prev.dyMm !== c.dyMm || prev.scalePct !== c.scalePct
  const device = deviceName !== saved.device
  return { spec, calib, device }
}
