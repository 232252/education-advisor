// =============================================================
// app:// 自定义协议 — 生产模式加载渲染进程(P0: 解决 file:// 下
// ES Module CORS 限制),带域内路径约束(防 .. 逃逸读任意文件)
// =============================================================

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'

/**
 * 把 URL pathname 约束在 root 内。
 * join 会归一化 `..` 段,归一化结果逃出 root(或根自身以外的等价形态)返回 null。
 * 根自身(pathname='/')视为域内,返回 root。
 */
export function resolveWithinRoot(root: string, pathname: string): string | null {
  // URL pathname 以 / 开头。Windows 上 path.join(root, '/index.html') 会把后段
  // 当成盘符根路径，拼成 C:\index.html 并误判逃逸。先剥掉前导分隔符再拼。
  const relative = pathname.replace(/^[/\\]+/, '')
  const rootNorm = path.normalize(root)
  const resolved = path.normalize(path.join(rootNorm, relative))
  if (resolved === rootNorm || resolved === rootNorm + path.sep) return rootNorm
  return resolved.startsWith(rootNorm + path.sep) ? resolved : null
}

/** 构造 app:// 协议处理器(纯函数化便于测试);逃逸请求回 404 不落盘 */
export function createAppProtocolHandler(
  rendererRoot: string,
): (request: Request) => Promise<Response> {
  return (request) => {
    const { pathname } = new URL(request.url)
    // host = 'index' (from app://index/...), pathname = '/index.html' or '/assets/...'
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return Promise.resolve(new Response('bad path', { status: 400 }))
    }
    const filePath = resolveWithinRoot(rendererRoot, decoded)
    if (!filePath) {
      return Promise.resolve(new Response('forbidden', { status: 403 }))
    }
    return net.fetch(pathToFileURL(filePath).href)
  }
}

/** 注册 app:// 协议(生产渲染层加载入口;app-lifecycle 启动时调用一次) */
export function registerAppProtocol(): void {
  protocol.handle('app', createAppProtocolHandler(path.join(__dirname, '..', 'renderer')))
}
