// =============================================================
// dashboard-lens — 视图镜头解析
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  isDashboardLens,
  parseDashboardLens,
} from '../../../../src/renderer/pages/Dashboard/dashboard-lens'

describe('parseDashboardLens', () => {
  it('grades 原样返回', () => {
    expect(parseDashboardLens('grades')).toBe('grades')
  })

  it('其余值回退 conduct', () => {
    expect(parseDashboardLens('conduct')).toBe('conduct')
    expect(parseDashboardLens('班主任')).toBe('conduct')
    expect(parseDashboardLens(null)).toBe('conduct')
    expect(parseDashboardLens(undefined)).toBe('conduct')
  })
})

describe('isDashboardLens', () => {
  it('只接受 conduct / grades', () => {
    expect(isDashboardLens('conduct')).toBe(true)
    expect(isDashboardLens('grades')).toBe(true)
    expect(isDashboardLens('')).toBe(false)
  })
})
