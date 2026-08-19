// =============================================================
// utils/sanitize.ts 测试 — sanitizeName / sanitizeFreeText /
//                        sanitizeClassId / tokenizeQuery
// 安全关键纯函数,覆盖各校验分支
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  sanitizeName,
  sanitizeFreeText,
  sanitizeClassId,
  tokenizeQuery,
} from '../../src/main/utils/sanitize'

describe('sanitizeName', () => {
  it('接受中文名与常见姓名符号并 trim', () => {
    expect(sanitizeName('  小明 ', 'name')).toBe('小明')
    expect(sanitizeName('欧阳娜娜(三年级)', 'name')).toBe('欧阳娜娜(三年级)')
    expect(sanitizeName('马·云', 'name')).toBe('马·云')
    expect(sanitizeName('A-z_0', 'name')).toBe('A-z_0')
  })

  it('非字符串输入报错', () => {
    expect(() => sanitizeName(123, 'name')).toThrow('name must be a string')
    expect(() => sanitizeName(null, 'name')).toThrow('name must be a string')
    expect(() => sanitizeName(undefined, 'name')).toThrow('name must be a string')
  })

  it('剥离不可见 Unicode 字符后为空则报错', () => {
    expect(() => sanitizeName('\u200B\uFEFF  ', 'name')).toThrow('cannot be empty')
    expect(sanitizeName('\u200B小明\uFEFF', 'name')).toBe('小明')
  })

  it('超过 64 字符报错', () => {
    expect(() => sanitizeName('a'.repeat(65), 'name')).toThrow('too long')
    expect(sanitizeName('a'.repeat(64), 'name')).toBe('a'.repeat(64))
  })

  it('拒绝控制字符', () => {
    expect(() => sanitizeName('小\n明', 'name')).toThrow('control characters')
    expect(() => sanitizeName('小\t明', 'name')).toThrow('control characters')
    expect(() => sanitizeName('小\u0000明', 'name')).toThrow('control characters')
    expect(() => sanitizeName('小明', 'name')).toThrow('control characters')
  })

  it('拒绝路径分隔符与路径遍历(P5)', () => {
    expect(() => sanitizeName('张/三', 'name')).toThrow('path separators')
    expect(() => sanitizeName('张\\三', 'name')).toThrow('path separators')
    expect(() => sanitizeName('../etc/passwd', 'name')).toThrow('path separators')
    expect(() => sanitizeName('a..b', 'name')).toThrow('path traversal')
  })

  it('拒绝 shell 元字符', () => {
    expect(() => sanitizeName('x`y', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('x$y', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('x;y', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('x|y', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('x&y', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('x<y', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('x>y', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('x{y}', 'name')).toThrow('illegal characters')
  })

  it('拒绝 -- 前缀(参数注入防护)', () => {
    expect(() => sanitizeName('--evil', 'name')).toThrow('cannot start with --')
  })
})

describe('sanitizeFreeText', () => {
  it('接受含斜杠/省略号/括号的正常文本', () => {
    expect(sanitizeFreeText('迟到/早退', 'note')).toBe('迟到/早退')
    expect(sanitizeFreeText('继续努力...', 'note')).toBe('继续努力...')
    expect(sanitizeFreeText('小明(三年级)表现\\不错', 'note')).toBe('小明(三年级)表现\\不错')
  })

  it('非字符串/空/超长报错', () => {
    expect(() => sanitizeFreeText(42, 'note')).toThrow('note must be a string')
    expect(() => sanitizeFreeText('  ', 'note')).toThrow('cannot be empty')
    expect(() => sanitizeFreeText('x'.repeat(501), 'note')).toThrow('too long (max 500 chars)')
    // 自定义 maxLength
    expect(() => sanitizeFreeText('x'.repeat(11), 'note', 10)).toThrow('too long (max 10 chars)')
    expect(sanitizeFreeText('x'.repeat(10), 'note', 10)).toBe('x'.repeat(10))
  })

  it('剥离不可见 Unicode 字符', () => {
    expect(sanitizeFreeText('\u200B请假\u2060', 'note')).toBe('请假')
  })

  it('拒绝控制字符', () => {
    expect(() => sanitizeFreeText('line1\nline2', 'note')).toThrow('control characters')
    expect(() => sanitizeFreeText('tab\there', 'note')).toThrow('control characters')
  })

  it('拒绝真正的 shell 元字符但允许括号', () => {
    expect(() => sanitizeFreeText('a;b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a&b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a|b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a`b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a$b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a<b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a>b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a{b}', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a*b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a[b]', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a#b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a~b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a!b', 'note')).toThrow('illegal characters')
    // () 在 free text 中合法
    expect(sanitizeFreeText('附注(重要)', 'note')).toBe('附注(重要)')
  })

  it('拒绝 -- 前缀', () => {
    expect(() => sanitizeFreeText('--flag', 'note')).toThrow('cannot start with --')
  })
})

describe('sanitizeClassId', () => {
  it('接受字母数字点连字符并 trim', () => {
    expect(sanitizeClassId(' G7-3 ')).toBe('G7-3')
    expect(sanitizeClassId('A1.2')).toBe('A1.2')
  })

  it('非字符串/空/超长报错', () => {
    expect(() => sanitizeClassId(7)).toThrow('must be a string')
    expect(() => sanitizeClassId('   ')).toThrow('cannot be empty')
    expect(() => sanitizeClassId('A'.repeat(33))).toThrow('too long (max 32 chars)')
    expect(sanitizeClassId('A'.repeat(32))).toBe('A'.repeat(32))
  })

  it('拒绝非法字符(空格/下划线/中文/斜杠)', () => {
    expect(() => sanitizeClassId('G 7')).toThrow('alphanumeric, dot or hyphen only')
    expect(() => sanitizeClassId('G_7')).toThrow('alphanumeric, dot or hyphen only')
    expect(() => sanitizeClassId('七一班')).toThrow('alphanumeric, dot or hyphen only')
    expect(() => sanitizeClassId('G7/1')).toThrow('alphanumeric, dot or hyphen only')
  })
})

describe('tokenizeQuery', () => {
  it('按任意空白分词', () => {
    expect(tokenizeQuery('a b  c')).toEqual(['a', 'b', 'c'])
    expect(tokenizeQuery('a\tb\nc')).toEqual(['a', 'b', 'c'])
  })

  it('双引号包裹的含空格参数不拆分', () => {
    expect(tokenizeQuery('score "张 三" --limit 10')).toEqual(['score', '张 三', '--limit', '10'])
  })

  it('引号跨多个空白持续生效', () => {
    expect(tokenizeQuery('"a b"  c')).toEqual(['a b', 'c'])
  })

  it('空串与纯空白返回空数组', () => {
    expect(tokenizeQuery('')).toEqual([])
    expect(tokenizeQuery('   ')).toEqual([])
  })

  it('未闭合引号不影响其余分词', () => {
    expect(tokenizeQuery('"unclosed word')).toEqual(['unclosed word'])
  })

  it('tab/换行注入会被分割为独立 token', () => {
    expect(tokenizeQuery('a"b c"\t--x')).toEqual(['ab c', '--x'])
  })
})