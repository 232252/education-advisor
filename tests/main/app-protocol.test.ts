// =============================================================
// app:// 协议处理器测试 — 域内路径放行 / 逃逸拒绝 / 注册接线
// 说明: WHATWG URL 解析会在 handler 之前归一化 `..` 段,故经真实
// Request.url 构造不出逃逸样本(Windows 反斜杠形态除外,平台相关);
// 逃逸守卫的语义由纯函数 resolveWithinRoot 直接覆盖。
// =============================================================

import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { protocol } from 'electron'
import {
  createAppProtocolHandler,
  registerAppProtocol,
  resolveWithinRoot,
} from '../../src/main/bootstrap/app-protocol'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(async (url: string) => new Response(`served:${url}`)),
}))

vi.mock('electron', () => ({
  net: { fetch: mocks.fetch },
  protocol: { handle: vi.fn() },
}))

describe('resolveWithinRoot', () => {
  const root = path.resolve('/tmp/ea-renderer-root')

  it('域内路径返回拼接后的绝对路径', () => {
    expect(resolveWithinRoot(root, '/index.html')).toBe(path.join(root, 'index.html'))
    expect(resolveWithinRoot(root, '/assets/app.a1b2.js')).toBe(
      path.join(root, 'assets', 'app.a1b2.js'),
    )
  })

  it('前导斜杠在 Windows 上也不跳出 root', () => {
    const inside = resolveWithinRoot(root, '/index.html')
    expect(inside).toBe(path.join(root, 'index.html'))
    expect(inside?.startsWith(root)).toBe(true)
  })

  it('.. 回溯逃逸返回 null', () => {
    expect(resolveWithinRoot(root, '/../../etc/passwd')).toBeNull()
    expect(resolveWithinRoot(root, '/assets/../../../../x')).toBeNull()
  })

  it('根自身( pathname=/ )不视为逃逸', () => {
    expect(resolveWithinRoot(root, '/')).toBe(root)
  })
})

describe('createAppProtocolHandler', () => {
  it('域内请求转 file:// fetch 并透传响应', async () => {
    const root = path.resolve('/tmp/ea-renderer-root2')
    const handler = createAppProtocolHandler(root)
    const res = await handler(new Request('app://index/index.html'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(`served:file://${path.join(root, 'index.html')}`)
  })
})

describe('registerAppProtocol', () => {
  it('以 app 协议注册处理器', () => {
    registerAppProtocol()
    expect(vi.mocked(protocol.handle).mock.calls[0]?.[0]).toBe('app')
    expect(typeof vi.mocked(protocol.handle).mock.calls[0]?.[1]).toBe('function')
  })
})
