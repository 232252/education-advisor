// =============================================================
// stream-batcher 测试 — delta 攒批合并/flush 语义
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeltaBatcher } from '../../src/main/services/stream-batcher'

describe('createDeltaBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('窗口内的多个 delta 合并成一次发送', () => {
    const sends: string[] = []
    const b = createDeltaBatcher((d) => sends.push(d))
    b.push('你')
    b.push('好')
    b.push('，世界')
    vi.advanceTimersByTime(40)
    expect(sends).toEqual(['你好，世界'])
  })

  it('flush 立即刷出缓冲且不重复', () => {
    const sends: string[] = []
    const b = createDeltaBatcher((d) => sends.push(d))
    b.push('甲')
    b.push('乙')
    b.flush()
    b.flush()
    expect(sends).toEqual(['甲乙'])
  })

  it('flush 后计时器被清理(空缓冲不触发空 send)', () => {
    const sends: string[] = []
    const b = createDeltaBatcher((d) => sends.push(d))
    b.push('数据')
    b.flush()
    vi.advanceTimersByTime(100)
    expect(sends).toEqual(['数据'])
  })

  it('跨窗口的多批按时序分多次发送', () => {
    const sends: string[] = []
    const b = createDeltaBatcher((d) => sends.push(d))
    b.push('第一段')
    vi.advanceTimersByTime(35)
    b.push('第二段')
    vi.advanceTimersByTime(35)
    expect(sends).toEqual(['第一段', '第二段'])
  })

  it('空 delta 不产生 send', () => {
    const sends: string[] = []
    const b = createDeltaBatcher((d) => sends.push(d))
    b.push('')
    vi.advanceTimersByTime(40)
    expect(sends).toEqual([])
  })
})
