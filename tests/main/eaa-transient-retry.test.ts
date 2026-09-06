// =============================================================
// eaa/execution-policy — 瞬态重试规则表测试
// 覆盖: os error 5(清理锁+重试)、EAA_EMPTY_STDOUT(退避重试)、
//       非瞬态失败不重试、成功直通、规则间顺序应用
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import { applyTransientRetries, TRANSIENT_RETRY_RULES } from '../../src/main/services/eaa/execution-policy'
import type { EAAResult } from '../../src/main/services/eaa/types'

function fail(stderr: string): EAAResult<unknown> {
  return { success: false, data: null, stderr, stdout: '' }
}
const ok: EAAResult<unknown> = { success: true, data: null, stderr: '', stdout: '' }

describe('applyTransientRetries', () => {
  it('os error 5 命中时先清理锁再重试,重试成功即返回', async () => {
    const cleanLock = vi.fn()
    let calls = 0
    const run = vi.fn(async () => {
      calls++
      return calls === 1 ? fail('CreateProcess: os error 5 (access denied)') : ok
    })
    const result = await applyTransientRetries(run, fail('os error 5'), 'read "entities"', cleanLock)
    expect(result.success).toBe(true)
    expect(cleanLock).toHaveBeenCalledTimes(1)
    // retryOnTransientFailure 契约: 先重跑一次(拿新结果)再按需重试
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('EAA_EMPTY_STDOUT 命中时重试且不清理锁(无 preClean)', async () => {
    const cleanLock = vi.fn()
    let calls = 0
    const run = vi.fn(async () => {
      calls++
      return calls <= 2 ? fail('[EAA_EMPTY_STDOUT] json command produced no output') : ok
    })
    // 首次 run 由调用方完成,这里传入首败结果
    const result = await applyTransientRetries(
      run,
      fail('[EAA_EMPTY_STDOUT] json command produced no output'),
      'read "students"',
      cleanLock,
    )
    expect(result.success).toBe(true)
    // 内部首跑 + 两次重试
    expect(run).toHaveBeenCalledTimes(3)
    expect(cleanLock).not.toHaveBeenCalled()
  })

  it('非瞬态失败不重试', async () => {
    const run = vi.fn(async () => fail('some permanent error'))
    const result = await applyTransientRetries(run, fail('some permanent error'), 'read "x"')
    expect(result.success).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('成功结果直通', async () => {
    const run = vi.fn(async () => ok)
    const result = await applyTransientRetries(run, ok, 'read "x"')
    expect(result.success).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it('规则表覆盖两类瞬态错误且顺序稳定', () => {
    expect(TRANSIENT_RETRY_RULES.map((r) => r.match)).toEqual(['os error 5', '[EAA_EMPTY_STDOUT]'])
    expect(TRANSIENT_RETRY_RULES[0].preClean).toBe(true)
    expect(TRANSIENT_RETRY_RULES[1].preClean).toBeUndefined()
  })
})
