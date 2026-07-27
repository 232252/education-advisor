// =============================================================
// ipc-client 测试 — getAPI / getErrorMessage
// 此前零覆盖。getErrorMessage 是纯函数,getAPI 验证 window.api 缺失抛错
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import { getAPI, getErrorMessage } from '../ipc-client'

describe('getErrorMessage — 优先级', () => {
  it('data 为非空字符串时优先返回 data', () => {
    expect(getErrorMessage({ data: 'data error msg', stderr: 'stderr msg' })).toBe('data error msg')
  })

  it('data 为空字符串时回退到 stderr', () => {
    expect(getErrorMessage({ data: '', stderr: 'stderr msg' })).toBe('stderr msg')
  })

  it('data 为 null 时回退到 stderr', () => {
    expect(getErrorMessage({ data: null, stderr: 'stderr msg' })).toBe('stderr msg')
  })

  it('data 非 string 类型(对象)时回退到 stderr', () => {
    expect(getErrorMessage({ data: { code: 1 }, stderr: 'stderr msg' })).toBe('stderr msg')
  })

  it('data 和 stderr 都空时返回 fallback', () => {
    expect(getErrorMessage({ data: '', stderr: '' })).toBe('未知错误')
  })

  it('data 和 stderr 都 null/undefined 时返回自定义 fallback', () => {
    expect(getErrorMessage({ data: null, stderr: '' }, 'my fallback')).toBe('my fallback')
  })

  it('data 和 stderr 都缺失(空对象)时返回 fallback', () => {
    expect(getErrorMessage({}, 'none')).toBe('none')
  })

  it('data 为长字符串时完整返回', () => {
    const long = 'x'.repeat(1000)
    expect(getErrorMessage({ data: long, stderr: 'short' })).toBe(long)
  })
})

describe('getAPI — window.api 可用性', () => {
  it('window.api 存在时返回它', () => {
    const fakeApi = { eaa: {}, chat: {}, ai: {} }
    vi.stubGlobal('api', fakeApi)
    // jsdom 的 window.api 需要直接设置
    ;(window as unknown as { api: unknown }).api = fakeApi
    expect(getAPI()).toBe(fakeApi)
    delete (window as unknown as { api: unknown }).api
  })

  it('window.api 缺失时抛错', () => {
    delete (window as unknown as { api: unknown }).api
    expect(() => getAPI()).toThrow(/window\.api/)
  })

  it('抛出的错误是描述性消息', () => {
    delete (window as unknown as { api: unknown }).api
    try {
      getAPI()
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).toContain('not available')
    }
  })
})
