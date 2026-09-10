// =============================================================
// WebUI 网关 — HTTP 或 HTTPS，按绑定范围监听
// 静态页 + 同源 WS RPC；每条请求都要 256-bit 令牌
// 局域网模式拒绝公网来源；TLS 最低 1.2
// =============================================================

import fs from 'node:fs'
import type { IncomingMessage } from 'node:http'
import http from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import path from 'node:path'
import { resolveWithinRoot } from '../../bootstrap/app-protocol'
import { addWebUiFanoutListener } from '../../ipc/broadcast'
import {
  createWebInvokeEvent,
  dispatchSendHandler,
  hasInvokeHandler,
  invokeRegisteredHandler,
} from '../../ipc/handle'
import { log } from '../../utils/logger'
import {
  createAuthGuard,
  localIpv6Prefix64s,
  originAllowed,
  remoteAllowed,
  securityHeaders,
  sessionCookie,
  tokenFromRequest,
  tokensMatch,
  type WebUiBind,
  type WebUiProtocol,
} from './security'
import type { TlsMaterial } from './tls'

const requireWs = createRequire(import.meta.url)
const { WebSocketServer } = requireWs('ws') as {
  WebSocketServer: new (opts: {
    noServer: boolean
  }) => {
    handleUpgrade: (
      req: IncomingMessage,
      socket: import('node:stream').Duplex,
      head: Buffer,
      cb: (ws: WsClient) => void,
    ) => void
    emit: (ev: string, ...args: unknown[]) => boolean
    on: (ev: string, cb: (...args: unknown[]) => void) => void
    close: () => void
  }
}

type WsClient = {
  readyState: number
  send: (data: string) => void
  close: () => void
  on: (ev: string, cb: (...args: unknown[]) => void) => void
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
}

export interface GatewayOptions {
  port: number
  token: string
  protocol: WebUiProtocol
  bind: WebUiBind
  ipv6: boolean
  tls?: TlsMaterial
  rendererRoot: string
  devProxyUrl?: string
}

export interface GatewayHandle {
  port: number
  close: () => Promise<void>
}

interface RpcRequest {
  id?: string
  type?: string
  channel?: string
  args?: unknown[]
}

export { originAllowed, remoteAllowed } from './security'

function write(
  res: http.ServerResponse,
  status: number,
  body: string,
  type: string,
  extra?: Record<string, string>,
): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    ...securityHeaders(),
    ...extra,
  })
  res.end(body)
}

async function proxyDev(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  devProxyUrl: string,
): Promise<void> {
  const target = new URL(req.url || '/', devProxyUrl)
  await new Promise<void>((resolve) => {
    const p = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: req.method,
        headers: { ...req.headers, host: target.host },
      },
      (up) => {
        const headers = { ...up.headers, ...securityHeaders() }
        res.writeHead(up.statusCode || 502, headers)
        up.pipe(res)
        up.on('end', resolve)
      },
    )
    p.on('error', () => {
      write(
        res,
        502,
        '<!doctype html><meta charset="utf-8"><title>WebUI</title><p>开发服务器未启动，请先运行 npm run dev。</p>',
        'text/html; charset=utf-8',
      )
      resolve()
    })
    req.pipe(p)
  })
}

function serveStatic(res: http.ServerResponse, rendererRoot: string, urlPath: string): void {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0])
  } catch {
    write(res, 400, 'bad path', 'text/plain; charset=utf-8')
    return
  }
  if (decoded === '/' || decoded === '') decoded = '/index.html'
  const filePath = resolveWithinRoot(rendererRoot, decoded)
  if (!filePath) {
    write(res, 403, 'forbidden', 'text/plain; charset=utf-8')
    return
  }
  let resolved = filePath
  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    const fallback = resolveWithinRoot(rendererRoot, '/index.html')
    if (!fallback || !fs.existsSync(fallback)) {
      write(res, 404, 'not found', 'text/plain; charset=utf-8')
      return
    }
    resolved = fallback
  }
  const ext = path.extname(resolved).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, ...securityHeaders() })
  fs.createReadStream(resolved).pipe(res)
}

async function handleWsMessage(ws: WsClient, raw: string): Promise<void> {
  let msg: RpcRequest
  try {
    msg = JSON.parse(raw) as RpcRequest
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'invalid json' }))
    return
  }
  const channel = typeof msg.channel === 'string' ? msg.channel : ''
  const args = Array.isArray(msg.args) ? msg.args : []
  const send = (ch: string, payload: unknown) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'event', channel: ch, data: payload }))
    }
  }
  const event = createWebInvokeEvent(send)

  if (msg.type === 'send') {
    dispatchSendHandler(channel, event, args)
    return
  }
  if (msg.type !== 'invoke' || !msg.id) {
    ws.send(JSON.stringify({ id: msg.id, type: 'error', message: 'invalid request' }))
    return
  }
  if (!hasInvokeHandler(channel)) {
    ws.send(
      JSON.stringify({ id: msg.id, type: 'error', message: `Unknown IPC channel: ${channel}` }),
    )
    return
  }
  try {
    const data = await invokeRegisteredHandler(channel, event, args)
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ id: msg.id, type: 'result', data }))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ id: msg.id, type: 'error', message }))
    }
  }
}

function bindOnce(
  server: http.Server | https.Server,
  options: { port: number; host: string; ipv6Only?: boolean },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      const addr = server.address()
      resolve(typeof addr === 'object' && addr ? addr.port : options.port)
    }
    server.once('error', onError)
    server.listen(options, onListening)
  })
}

function closeServer(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
}

function createAppServer(
  opts: GatewayOptions,
  onRequest: http.RequestListener,
): http.Server | https.Server {
  if (opts.protocol === 'https') {
    if (!opts.tls) throw new Error('HTTPS 需要证书')
    return https.createServer(
      {
        key: opts.tls.key,
        cert: opts.tls.cert,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.3',
      },
      onRequest,
    )
  }
  return http.createServer(onRequest)
}

export function startWebUiGateway(opts: GatewayOptions): Promise<GatewayHandle> {
  const clients = new Set<WsClient>()
  const guard = createAuthGuard()
  const prefixes = localIpv6Prefix64s()
  const unsubFanout = addWebUiFanoutListener((channel, payload) => {
    const frame = JSON.stringify({ type: 'event', channel, data: payload })
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(frame)
    }
  })

  const clientIp = (req: IncomingMessage) => req.socket.remoteAddress || ''

  const admit = (req: IncomingMessage, res?: http.ServerResponse): boolean => {
    const ip = clientIp(req)
    if (!remoteAllowed(ip, opts.bind, prefixes)) {
      if (res) write(res, 403, 'source denied', 'text/plain; charset=utf-8')
      return false
    }
    if (!originAllowed(req, opts.protocol) && req.headers.origin) {
      if (res) write(res, 403, 'origin denied', 'text/plain; charset=utf-8')
      return false
    }
    if (guard.blocked(ip)) {
      if (res) write(res, 429, 'too many attempts', 'text/plain; charset=utf-8')
      return false
    }
    if (!tokensMatch(tokenFromRequest(req), opts.token)) {
      guard.fail(ip)
      if (res) {
        write(
          res,
          401,
          '<!doctype html><meta charset="utf-8"><title>WebUI</title><p>需要访问令牌。请从应用设置页复制带令牌的地址。</p>',
          'text/html; charset=utf-8',
        )
      }
      return false
    }
    guard.ok(ip)
    return true
  }

  const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (!admit(req, res)) return
    const fromQuery = new URL(req.url || '/', 'https://webui.local').searchParams.get('k')
    if (fromQuery && tokensMatch(fromQuery, opts.token)) {
      res.setHeader('Set-Cookie', sessionCookie(opts.token, opts.protocol === 'https'))
    }
    const url = new URL(req.url || '/', 'https://webui.local')
    if (url.pathname === '/ws') {
      write(res, 426, 'upgrade required', 'text/plain; charset=utf-8')
      return
    }
    if (opts.devProxyUrl) {
      void proxyDev(req, res, opts.devProxyUrl)
      return
    }
    serveStatic(res, opts.rendererRoot, url.pathname)
  }

  const servers: Array<http.Server | https.Server> = []
  const wss = new WebSocketServer({ noServer: true })

  const onUpgrade = (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    const url = new URL(req.url || '/', 'https://webui.local')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    if (!admit(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  }

  const attach = (server: http.Server | https.Server) => {
    server.on('upgrade', onUpgrade)
    servers.push(server)
  }

  wss.on('connection', (...args: unknown[]) => {
    const ws = args[0] as WsClient
    clients.add(ws)
    ws.on('message', (...msg: unknown[]) => {
      void handleWsMessage(ws, String(msg[0]))
    })
    ws.on('close', () => {
      clients.delete(ws)
    })
  })

  const close = () =>
    new Promise<void>((resClose) => {
      unsubFanout()
      for (const ws of clients) {
        try {
          ws.close()
        } catch {
          /* ignore */
        }
      }
      clients.clear()
      wss.close()
      void Promise.all(servers.map(closeServer)).then(() => resClose())
    })

  return (async () => {
    try {
      const primary = createAppServer(opts, onRequest)
      attach(primary)
      let port: number
      if (opts.bind === 'loopback') {
        port = await bindOnce(primary, { port: opts.port, host: '127.0.0.1' })
        log(
          'info',
          'webui',
          `${opts.protocol.toUpperCase()} gateway listening on 127.0.0.1:${port}`,
        )
        if (opts.ipv6) {
          const v6 = createAppServer(opts, onRequest)
          attach(v6)
          try {
            await bindOnce(v6, { port, host: '::1', ipv6Only: true })
            log('info', 'webui', `${opts.protocol.toUpperCase()} also on [::1]:${port}`)
          } catch (err) {
            log(
              'warn',
              'webui',
              `IPv6 loopback bind skipped: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      } else {
        const host = opts.ipv6 ? '::' : '0.0.0.0'
        port = await bindOnce(primary, {
          port: opts.port,
          host,
          ipv6Only: false,
        })
        log(
          'info',
          'webui',
          `${opts.protocol.toUpperCase()} gateway listening on ${host}:${port} bind=${opts.bind}`,
        )
      }
      return { port, close }
    } catch (err) {
      await close()
      throw err
    }
  })()
}
