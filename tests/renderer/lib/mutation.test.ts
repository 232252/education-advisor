// =============================================================
// runIpcMutation 扩展选项测试 — 函数式 failMsg / catchMsg / catchLog / failLog / setBusy
// 语义基线: 每个选项都源自真实迁移站点的原行为(见 lib/mutation.ts 头注释)
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runIpcMutation } from '../../../src/renderer/lib/mutation'
import { toast } from '../../../src/renderer/stores/toastStore'

const envelope = (success: boolean, error?: string) => ({ success, error })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runIpcMutation 扩展选项', () => {
  it('failMsg 函数: 收到整个 result,可强制固定文案(不透出 error)', async () => {
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '')
    const ok = await runIpcMutation(() => Promise.resolve(envelope(false, 'boom')), {
      failMsg: () => '固定失败',
    })
    expect(ok).toBe(false)
    expect(spy).toHaveBeenCalledWith('固定失败')
  })

  it('failMsg 字符串: error 优先,空 error 才落兜底', async () => {
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '')
    await runIpcMutation(() => Promise.resolve(envelope(false, 'boom')), { failMsg: '兜底' })
    expect(spy).toHaveBeenCalledWith('boom')
    await runIpcMutation(() => Promise.resolve(envelope(false)), { failMsg: '兜底' })
    expect(spy).toHaveBeenCalledWith('兜底')
  })

  it('catchMsg: 缺省 errText / 字符串固定 / 函数自定义', async () => {
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '')
    await runIpcMutation(() => Promise.reject(new Error('ipc down')))
    expect(spy).toHaveBeenLastCalledWith('ipc down')
    await runIpcMutation(() => Promise.reject(new Error('x')), { catchMsg: '固定异常' })
    expect(spy).toHaveBeenLastCalledWith('固定异常')
    await runIpcMutation(() => Promise.reject(new Error('x')), {
      catchMsg: (err) => `下载异常: ${String((err as Error).message)}`,
    })
    expect(spy).toHaveBeenLastCalledWith('下载异常: x')
  })

  it('catchLog/failLog: 保留原 console.error 行为与参数形态', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(toast, 'error').mockImplementation(() => '')
    await runIpcMutation(() => Promise.reject(new Error('e1')), { catchLog: '[Scope] failed:' })
    expect(errSpy).toHaveBeenCalledWith('[Scope] failed:', expect.any(Error))
    await runIpcMutation(() => Promise.resolve(envelope(false, 'why')), { failLog: '[Scope] rejected:' })
    expect(errSpy).toHaveBeenCalledWith('[Scope] rejected:', 'why')
  })

  it('setBusy: 调用前置 true,成败皆复位 false', async () => {
    vi.spyOn(toast, 'error').mockImplementation(() => '')
    const busy: boolean[] = []
    const setBusy = (v: boolean) => busy.push(v)
    await runIpcMutation(() => Promise.resolve(envelope(true)), { setBusy })
    await runIpcMutation(() => Promise.reject(new Error('x')), { setBusy })
    await runIpcMutation(() => Promise.resolve(envelope(false)), { setBusy })
    expect(busy).toEqual([true, false, true, false, true, false])
  })

  it('onOk 收到完整 result(可读取 data 等附加字段)', async () => {
    const onOk = vi.fn()
    const ok = await runIpcMutation(() => Promise.resolve({ success: true, data: 'x.wav' }), { onOk })
    expect(ok).toBe(true)
    expect(onOk).toHaveBeenCalledWith({ success: true, data: 'x.wav' })
  })
})
