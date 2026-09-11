// =============================================================
// 花名册表头别名 / 行→档案 / 隐私实体收集
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  collectPrivacyTexts,
  fieldsToProfilePatch,
  findRosterHeaderRow,
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

  it('识别学校核定表列名: 姓名/就读班级/身份证号码/家长姓名', () => {
    const h = resolveRosterHeaders([
      '序号',
      '姓名',
      '性别',
      '就读学校',
      '就读班级',
      '身份证号码',
      '家庭住址',
      '家长姓名',
      '联系电话',
    ])
    expect(h).not.toBeNull()
    expect(h?.name).toBe(1)
    expect(h?.className).toBe(4)
    expect(h?.idCard).toBe(5)
    expect(h?.address).toBe(6)
    expect(h?.fatherName).toBe(7)
    expect(h?.phone).toBe(8)
  })

  it('家长姓名不会被当成学生姓名列', () => {
    const h = resolveRosterHeaders(['学号', '家长姓名', '学生姓名'])
    expect(h?.name).toBe(2)
    expect(h?.fatherName).toBe(1)
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

describe('findRosterHeaderRow', () => {
  it('跳过合并标题行，定位真正的姓名表头', () => {
    const found = findRosterHeaderRow([
      ['九龙县2026年春季学期寄宿制学生核定表'],
      ['序号', '姓名', '就读班级'],
      ['1', '罗尧骋', '高2024级5班'],
    ])
    expect(found?.rowIndex).toBe(1)
    expect(found?.indexes.name).toBe(1)
    expect(found?.indexes.className).toBe(2)
  })
})

describe('rowToProfilePatch', () => {
  it('学号与考号分列写入档案', () => {
    const h = resolveRosterHeaders(['姓名', '学号', '考号'])!
    const patch = rowToProfilePatch(['罗尧骋', '20240005', '20261001'], h)
    expect(patch.studentNumber).toBe('20240005')
    expect(patch.examNumber).toBe('20261001')
  })

  it('合法身份证覆盖性别与出生日期', () => {
    const h = resolveRosterHeaders(['姓名', '身份证号', '性别'])!
    const patch = rowToProfilePatch(['伍思情', '110101200801011230', '女'], h, 'G10-4')
    expect(patch).toMatchObject({
      idCard: '110101200801011230',
      gender: '男',
      birthDate: '2008-01-01',
      classId: 'G10-4',
    })
  })
})

describe('fieldsToProfilePatch', () => {
  it('从扁平字段解析身份证', () => {
    const patch = fieldsToProfilePatch({ idCard: '110101200802022222', phone: '13800001111' })
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
    const items = collectPrivacyTexts('伍思情', {
      idCard: '110101200801011230',
      phone: '13800001111',
      address: '某路1号',
    })
    expect(items.map((i) => i.entityType).sort()).toEqual(['id_card', 'person', 'phone', 'place'])
  })
})
