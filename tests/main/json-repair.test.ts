import { describe, expect, it } from 'vitest'
import { parseJsonObject } from '../../src/main/utils/json-repair'

describe('parseJsonObject', () => {
  it('直接解析', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 })
  })

  it('剥掉 markdown 围栏', () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('从前后解释文字中截取对象', () => {
    expect(parseJsonObject('结果如下: {"a":1} 以上')).toEqual({ a: 1 })
  })

  it('修复尾逗号', () => {
    expect(parseJsonObject('{"a":1,}')).toEqual({ a: 1 })
  })

  it('非对象抛错,默认消息可分类', () => {
    expect(() => parseJsonObject('[1,2]')).toThrow('输出不是 JSON 对象')
  })

  it('无法修复时用调用方消息', () => {
    expect(() => parseJsonObject('不是 json', '身份识别输出不是对象')).toThrow(
      '身份识别输出不是对象',
    )
  })
})
