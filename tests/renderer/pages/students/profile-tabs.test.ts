import { describe, expect, it } from 'vitest'
import { parseStudentProfileTab } from '../../../../src/renderer/pages/Students/lib/profile-tabs'
import { parseAcademicsTab } from '../../../../src/renderer/pages/Academics/academics-tabs'

describe('parseStudentProfileTab', () => {
  it('合法 tab 原样返回', () => {
    expect(parseStudentProfileTab('ai')).toBe('ai')
    expect(parseStudentProfileTab('academics')).toBe('academics')
  })

  it('非法 / 空 返回 null', () => {
    expect(parseStudentProfileTab(null)).toBeNull()
    expect(parseStudentProfileTab('')).toBeNull()
    expect(parseStudentProfileTab('nope')).toBeNull()
  })
})

describe('parseAcademicsTab', () => {
  it('合法 tab 原样返回', () => {
    expect(parseAcademicsTab('entry')).toBe('entry')
    expect(parseAcademicsTab('compare')).toBe('compare')
  })

  it('非法 / 空 返回 null', () => {
    expect(parseAcademicsTab(undefined)).toBeNull()
    expect(parseAcademicsTab('ai')).toBeNull()
  })
})
