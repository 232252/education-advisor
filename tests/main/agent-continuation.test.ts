import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => 'C:/tmp', isPackaged: false } }))

import { answerLooksUnfinished, runContinuationLoop } from '../../src/main/services/agent/continuation'

describe('短回答不再被续跑改写', () => {
  it('正常 stop 的一个字是完成', () => {
    expect(answerLooksUnfinished({ outputLength: 1, turnCount: 1, stopReason: 'stop' })).toBe(false)
  })

  it('pi 的 endTurn 同样视为完成', () => {
    expect(answerLooksUnfinished({ outputLength: 12, turnCount: 1, stopReason: 'endTurn' })).toBe(
      false,
    )
  })

  it('空回复仍要续跑', () => {
    expect(answerLooksUnfinished({ outputLength: 0, turnCount: 1, stopReason: 'stop' })).toBe(true)
  })

  it('触顶截断的短输出仍要续跑', () => {
    expect(answerLooksUnfinished({ outputLength: 8, turnCount: 1, stopReason: 'length' })).toBe(true)
  })

  it('教师停止后不追问', () => {
    expect(answerLooksUnfinished({ outputLength: 4, turnCount: 1, stopReason: 'aborted' })).toBe(
      false,
    )
  })

  it('续跑循环不会再给已完成的短回答发系统检查', async () => {
    let prompts = 0
    const count = await runContinuationLoop({
      id: 'main',
      prompt: async () => {
        prompts += 1
      },
      waitIdle: async () => {},
      getOutputLength: () => 1,
      getTurnCount: () => 1,
      getLastErrorMessage: () => '',
      getStopReason: () => 'stop',
      isAborted: () => false,
    })
    expect(count).toBe(0)
    expect(prompts).toBe(0)
  })
})
