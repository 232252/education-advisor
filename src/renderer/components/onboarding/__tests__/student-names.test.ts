// =============================================================
// parseStudentNames — 学生名单解析纯函数测试
// =============================================================

import { describe, expect, it } from 'vitest'
import { parseStudentNames } from '../student-names'

describe('parseStudentNames', () => {
  it('换行分隔(\\n)', () => {
    expect(parseStudentNames('张三\n李四\n王五')).toEqual(['张三', '李四', '王五'])
  })

  it('Windows 换行(\\r\\n)', () => {
    expect(parseStudentNames('张三\r\n李四')).toEqual(['张三', '李四'])
  })

  it('混合分隔符: 逗号/顿号/分号(中英)', () => {
    expect(parseStudentNames('张三,李四、王五；赵六;Tom')).toEqual([
      '张三',
      '李四',
      '王五',
      '赵六',
      'Tom',
    ])
  })

  it('去空行与纯空白项', () => {
    expect(parseStudentNames('  \n张三\n   \n\n李四\n\t\n')).toEqual(['张三', '李四'])
  })

  it('去除首尾空格', () => {
    expect(parseStudentNames('  张三  \n 李四 ')).toEqual(['张三', '李四'])
  })

  it('去重保序(保留首次出现)', () => {
    expect(parseStudentNames('张三\n李四\n张三\n王五\n李四')).toEqual(['张三', '李四', '王五'])
  })

  it('空字符串与纯分隔符返回空数组', () => {
    expect(parseStudentNames('')).toEqual([])
    expect(parseStudentNames(',,\n、；')).toEqual([])
  })

  it('混合换行与逗号的实用场景', () => {
    expect(parseStudentNames('张三, 李四\n王五、赵六\n  钱七  ')).toEqual([
      '张三',
      '李四',
      '王五',
      '赵六',
      '钱七',
    ])
  })
})
