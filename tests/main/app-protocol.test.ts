// =============================================================
// app:// 协议处理器测试 — 域内路径放行 / 逃逸拒绝 / 注册接线
// 说明: WHATWG URL 解析会在 handler 之前归一化 `..` 段,故经真实
// Request.url 构造不出逃逸样本(Windows 反斜杠形态除外,平台相关);
// 逃逸守卫的语义由纯函数 resolveWithinRoot 直接覆盖。
// 安装包内渲染文件在 app.asar 里:处理器必须用 fs.readFile,不能
// net.fetch(file://),后者读 asar 会失败并变成 Chromium Error 页。
// =============================================================

import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { protocol } from 'electron'
import {
  createAppProtocolHandler,
  mimeForPath,
  registerAppProtocol,
  resolveWithinRoot,
} from '../../src/main/bootstrap/app-protocol'

vi.mock('electron', () => ({
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

describe('mimeForPath', () => {
  it('按扩展名返回 Content-Type', () => {
    expect(mimeForPath('index.html')).toBe('text/html; charset=utf-8')
    expect(mimeForPath('assets/app.js')).toBe('text/javascript; charset=utf-8')
    expect(mimeForPath('assets/app.css')).toBe('text/css; charset=utf-8')
    expect(mimeForPath('unknown.bin')).toBe('application/octet-stream')
  })
})

describe('createAppProtocolHandler', () => {
  it('用 fs 读域内文件并带上 Content-Type,不走 net.fetch', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ea-app-protocol-'))
    await writeFile(path.join(root, 'index.html'), '<!doctype html><title>ok</title>', 'utf8')
    const handler = createAppProtocolHandler(root)
    const res = await handler(new Request('app://index/index.html'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toBe('<!doctype html><title>ok</title>')
  })

  it('pathname=/ 时回落到目录内 index.html', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ea-app-protocol-root-'))
    await writeFile(path.join(root, 'index.html'), 'root-index', 'utf8')
    const handler = createAppProtocolHandler(root)
    const res = await handler(new Request('app://index/'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('root-index')
  })

  it('缺失文件回 404', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ea-app-protocol-miss-'))
    const handler = createAppProtocolHandler(root)
    const res = await handler(new Request('app://index/missing.js'))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('not found')
  })
})

describe('registerAppProtocol', () => {
  it('以 app 协议注册处理器', () => {
    registerAppProtocol()
    expect(vi.mocked(protocol.handle).mock.calls[0]?.[0]).toBe('app')
    expect(typeof vi.mocked(protocol.handle).mock.calls[0]?.[1]).toBe('function')
  })
})
