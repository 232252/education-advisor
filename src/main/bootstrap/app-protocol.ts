// =============================================================
// app:// 自定义协议 — 生产模式加载渲染进程(P0: 解决 file:// 下
// ES Module CORS 限制),带域内路径约束(防 .. 逃逸读任意文件)
// =============================================================

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { protocol } from 'electron'

const MIME_BY_EXT: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/** 按扩展名给出 Content-Type;未知类型回退 octet-stream */
export function mimeForPath(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

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

function isMissingPathError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

async function serveFile(filePath: string): Promise<Response> {
  try {
    const data = await readFile(filePath)
    return new Response(data, {
      status: 200,
      headers: { 'content-type': mimeForPath(filePath) },
    })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code
    // pathname=/ 时 resolve 得到目录本身;缺省落到 index.html。
    if (code === 'EISDIR') {
      const indexPath = path.join(filePath, 'index.html')
      if (resolveWithinRoot(filePath, 'index.html') !== indexPath) {
        return new Response('forbidden', { status: 403 })
      }
      return serveFile(indexPath)
    }
    if (isMissingPathError(err)) {
      return new Response('not found', { status: 404 })
    }
    return new Response('read error', { status: 500 })
  }
}

/** 构造 app:// 协议处理器(纯函数化便于测试);逃逸请求回 403,缺失回 404 */
export function createAppProtocolHandler(
  rendererRoot: string,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const { pathname } = new URL(request.url)
    // host = 'index' (from app://index/...), pathname = '/index.html' or '/assets/...'
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return new Response('bad path', { status: 400 })
    }
    const filePath = resolveWithinRoot(rendererRoot, decoded)
    if (!filePath) {
      return new Response('forbidden', { status: 403 })
    }
    // 必须走 Node/Electron fs: net.fetch(file://…app.asar…) 读不出 asar 内文件,
    // 安装包会落到 Chromium Error 页。Electron 给 fs 打了 asar 补丁,readFile 可以。
    return serveFile(filePath)
  }
}

/** 注册 app:// 协议(生产渲染层加载入口;app-lifecycle 启动时调用一次) */
export function registerAppProtocol(): void {
  protocol.handle('app', createAppProtocolHandler(path.join(__dirname, '..', 'renderer')))
}
