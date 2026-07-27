// =============================================================
// eaa-sanitize 测试 — 参数注入防护 / 路径遍历 / 控制字符 / 零宽字符
// 这些是安全关键代码,逐用例覆盖。逻辑来自 eaa-handlers.ts L77-160
// =============================================================

import { describe, expect, it } from 'vitest'
import { sanitizeClassId, sanitizeFreeText, sanitizeName, tokenizeQuery } from '../eaa-sanitize'

describe('sanitizeName - 正常用例', () => {
  it('保留中文名', () => {
    expect(sanitizeName('张三', 'name')).toBe('张三')
  })
  it('保留英文名和常见符号', () => {
    expect(sanitizeName("O'Brien", 'name')).toBe("O'Brien")
  })
  it('trim 前后空格', () => {
    expect(sanitizeName('  李四  ', 'name')).toBe('李四')
  })
  it('field 参数出现在错误消息中', () => {
    expect(() => sanitizeName('', 'studentName')).toThrow('studentName cannot be empty')
  })
})

describe('sanitizeName - 拒绝用例', () => {
  it('拒非字符串', () => {
    expect(() => sanitizeName(123, 'name')).toThrow('name must be a string')
    expect(() => sanitizeName(null, 'name')).toThrow('name must be a string')
    expect(() => sanitizeName(undefined, 'name')).toThrow('name must be a string')
  })
  it('拒空串(剥离零宽后)', () => {
    expect(() => sanitizeName('', 'name')).toThrow('cannot be empty')
    expect(() => sanitizeName('\u200B', 'name')).toThrow('cannot be empty') // 零宽空格剥离后为空
  })
  it('拒超长(>64)', () => {
    expect(() => sanitizeName('a'.repeat(65), 'name')).toThrow('too long')
    expect(sanitizeName('a'.repeat(64), 'name')).toBe('a'.repeat(64)) // 边界:恰好 64 允许
  })
  it('拒控制字符(NUL/换行/tab)', () => {
    expect(() => sanitizeName('a\x00b', 'name')).toThrow('control characters')
    expect(() => sanitizeName('a\nb', 'name')).toThrow('control characters')
    expect(() => sanitizeName('a\tb', 'name')).toThrow('control characters')
    expect(() => sanitizeName('a\x7Fb', 'name')).toThrow('control characters') // DEL
  })
  it('拒路径分隔符', () => {
    expect(() => sanitizeName('a/b', 'name')).toThrow('path separators')
    expect(() => sanitizeName('a\\b', 'name')).toThrow('path separators')
  })
  it('拒路径遍历序列 ..', () => {
    expect(() => sanitizeName('..', 'name')).toThrow('path traversal')
    expect(() => sanitizeName('a..b', 'name')).toThrow('path traversal')
  })
  it('拒 shell 特殊字符', () => {
    expect(() => sanitizeName('a`b', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('a$b', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('a;b', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('a|b', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('a&b', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('a<b', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('a>b', 'name')).toThrow('illegal characters')
    expect(() => sanitizeName('a{b', 'name')).toThrow('illegal characters')
  })
  it('拒 -- 前缀(参数注入防护)', () => {
    expect(() => sanitizeName('--verbose', 'name')).toThrow('cannot start with --')
  })
  it('剥离零宽 Unicode 字符后放行', () => {
    // 零宽空格 \u200B 被剥离,'张三' 本身合法
    expect(sanitizeName('张\u200B三', 'name')).toBe('张三')
    // BOM \uFEFF 同理
    expect(sanitizeName('\uFEFF张三', 'name')).toBe('张三')
  })
})

describe('sanitizeFreeText - 自由文本字段(note/reason)', () => {
  it('保留含 / 的文本(迟到/早退)', () => {
    expect(sanitizeFreeText('迟到/早退', 'note')).toBe('迟到/早退')
  })
  it('保留含 \\ 的文本', () => {
    expect(sanitizeFreeText('a\\b', 'note')).toBe('a\\b')
  })
  it('保留含 .. 的文本(省略号)', () => {
    expect(sanitizeFreeText('继续努力...', 'note')).toBe('继续努力...')
  })
  it('保留含 . 和 () 的文本', () => {
    expect(sanitizeFreeText('小明(三年级).表现', 'note')).toBe('小明(三年级).表现')
  })
  it('保留中英文混合', () => {
    expect(sanitizeFreeText('student 张三 late', 'note')).toBe('student 张三 late')
  })
  it('trim 前后空格', () => {
    expect(sanitizeFreeText('  备注  ', 'note')).toBe('备注')
  })
  it('field 参数出现在错误消息中', () => {
    expect(() => sanitizeFreeText('', 'note')).toThrow('note cannot be empty')
  })
  it('自定义 maxLength 生效', () => {
    expect(() => sanitizeFreeText('a'.repeat(201), 'reason', 200)).toThrow('too long')
    expect(sanitizeFreeText('a'.repeat(200), 'reason', 200)).toBe('a'.repeat(200))
  })
  it('默认 maxLength=500', () => {
    expect(() => sanitizeFreeText('a'.repeat(501), 'note')).toThrow('too long')
    expect(sanitizeFreeText('a'.repeat(500), 'note')).toBe('a'.repeat(500))
  })
})

describe('sanitizeFreeText - 拒绝用例', () => {
  it('拒非字符串', () => {
    expect(() => sanitizeFreeText(123, 'note')).toThrow('note must be a string')
    expect(() => sanitizeFreeText(null, 'note')).toThrow('note must be a string')
    expect(() => sanitizeFreeText(undefined, 'note')).toThrow('note must be a string')
  })
  it('拒空串(剥离零宽后)', () => {
    expect(() => sanitizeFreeText('', 'note')).toThrow('cannot be empty')
    expect(() => sanitizeFreeText('\u200B', 'note')).toThrow('cannot be empty')
  })
  it('拒控制字符(NUL/换行/tab)', () => {
    expect(() => sanitizeFreeText('a\x00b', 'note')).toThrow('control characters')
    expect(() => sanitizeFreeText('a\nb', 'note')).toThrow('control characters')
    expect(() => sanitizeFreeText('a\tb', 'note')).toThrow('control characters')
    expect(() => sanitizeFreeText('a\x7Fb', 'note')).toThrow('control characters')
  })
  it('拒 shell 元字符(防御纵深)', () => {
    expect(() => sanitizeFreeText('a;b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a&b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a|b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a`b', 'note')).toThrow('illegal characters')
    expect(() => sanitizeFreeText('a$b', 'note')).toThrow('illegal characters')
  })
  it('拒 -- 前缀(参数注入防护)', () => {
    expect(() => sanitizeFreeText('--verbose', 'note')).toThrow('cannot start with --')
  })
  it('剥离零宽 Unicode 字符后放行', () => {
    expect(sanitizeFreeText('张\u200B三', 'note')).toBe('张三')
    expect(sanitizeFreeText('\uFEFF张三', 'note')).toBe('张三')
  })
})

describe('sanitizeClassId', () => {
  it('保留字母数字连字符点', () => {
    expect(sanitizeClassId('G7-3')).toBe('G7-3')
    expect(sanitizeClassId('Class.A')).toBe('Class.A')
  })
  it('trim 前后空格', () => {
    expect(sanitizeClassId('  G7-3  ')).toBe('G7-3')
  })
  it('拒空', () => {
    expect(() => sanitizeClassId('')).toThrow('cannot be empty')
    expect(() => sanitizeClassId('   ')).toThrow('cannot be empty')
  })
  it('拒超长(>32)', () => {
    expect(() => sanitizeClassId('a'.repeat(33))).toThrow('too long')
  })
  it('拒非字符串', () => {
    expect(() => sanitizeClassId(123)).toThrow('must be a string')
  })
  it('拒非法字符(只允许字母数字.-)', () => {
    expect(() => sanitizeClassId('G7 3')).toThrow('alphanumeric') // 空格
    expect(() => sanitizeClassId('G7_3')).toThrow('alphanumeric') // 下划线
    expect(() => sanitizeClassId('G7/3')).toThrow('alphanumeric') // 斜杠
    expect(() => sanitizeClassId('三年级')).toThrow('alphanumeric') // 中文
  })
})

describe('tokenizeQuery', () => {
  it('空串返回空数组', () => {
    expect(tokenizeQuery('')).toEqual([])
  })
  it('单 token', () => {
    expect(tokenizeQuery('hello')).toEqual(['hello'])
  })
  it('多空格分隔', () => {
    expect(tokenizeQuery('a b  c')).toEqual(['a', 'b', 'c'])
  })
  it('双引号包裹含空格的复合词', () => {
    expect(tokenizeQuery('"张 三" score')).toEqual(['张 三', 'score'])
  })
  it('tab 也是分隔符(使用 /\\s/ 而非仅空格)', () => {
    // 注意:这是与 eaa-tools.ts 当前 ' ' 版本的差异点,P2 接入时统一为 /\s/
    expect(tokenizeQuery('a\tb')).toEqual(['a', 'b'])
  })
  it('换行也是分隔符', () => {
    expect(tokenizeQuery('a\nb')).toEqual(['a', 'b'])
  })
  it('首尾空格不产生空 token', () => {
    expect(tokenizeQuery('  a b  ')).toEqual(['a', 'b'])
  })
  it('未闭合引号:剩余全部归入最后一个 token', () => {
    expect(tokenizeQuery('"ab cd')).toEqual(['ab cd'])
  })
})
