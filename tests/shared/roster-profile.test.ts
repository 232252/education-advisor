// =============================================================
// 花名册表头别名 / 行→档案 / 隐私实体收集
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  collectPrivacyTexts,
  fieldsToProfilePatch,
  isPiiRosterHeader,
  resolveRosterHeaders,
  rowToProfilePatch,
} from '../../src/shared/roster-profile'

describe('resolveRosterHeaders', () => {
  it('识别中文花名册表头', () => {
    const h = resolveRosterHeaders(['姓名', '身份证号', '电话', '家庭住址', '学号'])
    expect(h).not.toBeNull()
    expect(h?.name).toBe(0)
    expect(h?.idCard).toBe(1)
    expect(h?.phone).toBe(2)
    expect(h?.address).toBe(3)
    expect(h?.studentId).toBe(4)
  })

  it('英文表头仍可用', () => {
    const h = resolveRosterHeaders(['name', 'student_id', 'class_name'])
    expect(h?.name).toBe(0)
    expect(h?.studentId).toBe(1)
    expect(h?.className).toBe(2)
  })

  it('无姓名列返回 null', () => {
    expect(resolveRosterHeaders(['学号', '班级'])).toBeNull()
  })
})

describe('rowToProfilePatch', () => {
  it('合法身份证覆盖性别与出生日期', () => {
    const h = resolveRosterHeaders(['姓名', '身份证号', '性别'])!
    const patch = rowToProfilePatch(['测试戊', '990000200801011232', '女'], h, 'G10-4')
    expect(patch).toMatchObject({
      idCard: '990000200801011232',
      gender: '男',
      birthDate: '2008-01-01',
      classId: 'G10-4',
    })
  })
})

describe('fieldsToProfilePatch', () => {
  it('从扁平字段解析身份证', () => {
    const patch = fieldsToProfilePatch({ idCard: '990000200802022224', phone: '13800001111' })
    expect(patch.gender).toBe('女')
    expect(patch.birthDate).toBe('2008-02-02')
    expect(patch.phone).toBe('13800001111')
  })
})

describe('isPiiRosterHeader', () => {
  it('身份证/电话/住址列为敏感', () => {
    expect(isPiiRosterHeader('身份证号')).toBe(true)
    expect(isPiiRosterHeader('电话')).toBe(true)
    expect(isPiiRosterHeader('联系电话')).toBe(true)
    expect(isPiiRosterHeader('家庭住址')).toBe(true)
    expect(isPiiRosterHeader('姓名')).toBe(false)
    expect(isPiiRosterHeader('城市')).toBe(false)
  })
})

describe('collectPrivacyTexts', () => {
  it('登记姓名、身份证、电话、住址', () => {
    const items = collectPrivacyTexts('测试戊', {
      idCard: '990000200801011232',
      phone: '13800001111',
      address: '某路1号',
    })
    expect(items.map((i) => i.entityType).sort()).toEqual(['id_card', 'person', 'phone', 'place'])
  })
})
