import { describe, expect, it } from 'vitest'
import { currentSemester, todayIsoDate } from '../../src/shared/academic-time'

describe('currentSemester', () => {
  it('9 月新学期 → 当年起算第 1 学期', () => {
    expect(currentSemester(new Date(2026, 8, 1))).toBe('2026-2027-1')
  })

  it('1 月仍属上一年起算的第 1 学期', () => {
    expect(currentSemester(new Date(2027, 0, 15))).toBe('2026-2027-1')
  })

  it('2 月底是第 1 学期边界', () => {
    expect(currentSemester(new Date(2027, 1, 28))).toBe('2026-2027-1')
  })

  it('3 月进入第 2 学期', () => {
    expect(currentSemester(new Date(2027, 2, 1))).toBe('2026-2027-2')
  })

  it('8 月底仍是第 2 学期', () => {
    expect(currentSemester(new Date(2027, 7, 31))).toBe('2026-2027-2')
  })
})

describe('todayIsoDate', () => {
  it('凌晨按本地日期,不落到前一日', () => {
    expect(todayIsoDate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
  })

  it('月/日补零', () => {
    expect(todayIsoDate(new Date(2026, 8, 5))).toBe('2026-09-05')
  })
})
