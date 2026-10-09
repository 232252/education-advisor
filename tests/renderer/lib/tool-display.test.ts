import { describe, expect, it } from 'vitest'
import { displayToolMentions, displayToolName } from '../../../src/renderer/lib/tool-display'

describe('displayToolName', () => {
  it('去掉 dsh 加的 mcp 前缀，留下工具自己的名字', () => {
    expect(displayToolName('mcp__roster__eaa_list_students')).toBe('eaa_list_students')
    expect(displayToolName('mcp__eaa__read_file')).toBe('read_file')
    expect(displayToolName('mcp__grades__eaa_exam_grades')).toBe('eaa_exam_grades')
  })

  it('本来就没有前缀的名字保持原样', () => {
    expect(displayToolName('read_file')).toBe('read_file')
    expect(displayToolName('mcp__broken')).toBe('mcp__broken')
  })
})

describe('displayToolMentions', () => {
  it('正文里的全名改成短名，其余文字不动', () => {
    expect(displayToolMentions('测试甲，61 分（来源：mcp__eaa__eaa_ranking）')).toBe(
      '测试甲，61 分（来源：eaa_ranking）',
    )
    expect(displayToolMentions('先 mcp__roster__eaa_list_students 再看')).toBe(
      '先 eaa_list_students 再看',
    )
  })
})
