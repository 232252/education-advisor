// =============================================================
// dashboard-lens — 视图镜头解析
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  EXAM_FILTER_ALL,
  SUBJECT_FILTER_ALL,
  isDashboardLens,
  parseDashboardLens,
} from '../../../../src/renderer/pages/Dashboard/dashboard-lens'

describe('筛选哨兵值', () => {
  it('科目/考试的「全部」哨兵互不相同,且不会撞上真实 id 形态', () => {
    expect(SUBJECT_FILTER_ALL).toBe('__ALL__')
    expect(EXAM_FILTER_ALL).toBe('__ALL_EXAMS__')
    expect(EXAM_FILTER_ALL).not.toBe(SUBJECT_FILTER_ALL)
    expect(EXAM_FILTER_ALL.startsWith('__')).toBe(true)
  })
})

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
