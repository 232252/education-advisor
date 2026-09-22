import { describe, expect, it } from 'vitest'

import { mcpToolNameMap, rewriteToolNames } from '../tool-names'

const map = {
  class_list: 'mcp__eaa__class_list',
  class_create: 'mcp__eaa__class_create',
  student_add: 'mcp__eaa__student_add',
}

describe('rewriteToolNames', () => {
  it('替换提示词里的裸工具名', () => {
    expect(rewriteToolNames('先 class_list 再 class_create', map)).toBe(
      '先 mcp__eaa__class_list 再 mcp__eaa__class_create',
    )
  })

  it('前缀/后缀相连的更长标识符不动', () => {
    expect(rewriteToolNames('my_class_list 与 class_list_all', map)).toBe(
      'my_class_list 与 class_list_all',
    )
    expect(rewriteToolNames('class_listed', map)).toBe('class_listed')
  })

  it('长名优先：短名不会吃掉长名的前缀', () => {
    const withPrefixPair = {
      class_list: 'mcp__eaa__class_list',
      class_list_all: 'mcp__eaa__class_list_all',
    }
    expect(rewriteToolNames('class_list_all', withPrefixPair)).toBe('mcp__eaa__class_list_all')
  })

  it('已是 mcp 前缀的名字不会被二次改写', () => {
    const text = 'mcp__eaa__class_list'
    expect(rewriteToolNames(text, map)).toBe(text)
  })

  it('下划线两侧仍算边界（不用 \b，因为工具名含下划线）', () => {
    expect(rewriteToolNames('tool: class_list, ok', map)).toBe('tool: mcp__eaa__class_list, ok')
    expect(rewriteToolNames('「class_list」', map)).toBe('「mcp__eaa__class_list」')
  })

  it('空 map / 空文本直接返回原文', () => {
    expect(rewriteToolNames('保留 class_list', {})).toBe('保留 class_list')
    expect(rewriteToolNames('', map)).toBe('')
  })

  it('mcpToolNameMap 按 profile 生成映射', () => {
    expect(mcpToolNameMap([{ name: 'a' }, { name: 'b' }], 'classes')).toEqual({
      a: 'mcp__classes__a',
      b: 'mcp__classes__b',
    })
    expect(mcpToolNameMap([], 'classes')).toEqual({})
  })
})
