// =============================================================
// 浏览器 WebUI — WS/WSS 传输,组装与 Electron 相同的 window.api
// 令牌来自 ?k= 或 sessionStorage
// =============================================================

import { setIpcRuntime } from '@shared/ipc-runtime'

interface RpcResult {
  id?: string
  type?: string
  channel?: string
  data?: unknown
  message?: string
}

function readToken(): string {
  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get('k')
  if (fromQuery) {
    try {
      sessionStorage.setItem('ea-webui-k', fromQuery)
      params.delete('k')
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', next)
    } catch {
      /* sessionStorage 可能不可用 */
    }
    return fromQuery
  }
  try {
    return sessionStorage.getItem('ea-webui-k') || ''
  } catch {
    return ''
  }
}

export function installWebBridge(): Promise<boolean> {
  const https = window.location.protocol === 'https:'
  const http = window.location.protocol === 'http:'
  if (!https && !http) {
    return Promise.resolve(false)
  }
  const token = readToken()
  if (!token) return Promise.resolve(false)

  const wsUrl = `${https ? 'wss' : 'ws'}://${window.location.host}/ws?k=${encodeURIComponent(token)}`

  return new Promise((resolve) => {
    let settled = false
    const ws = new WebSocket(wsUrl)
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    const listeners = new Map<string, Set<(data: unknown) => void>>()
    let nextId = 1
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(false)
      }
    }, 8000)

    ws.addEventListener('open', () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      setIpcRuntime({
        invoke(channel, ...args) {
          const id = String(nextId++)
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej })
            ws.send(JSON.stringify({ id, type: 'invoke', channel, args }))
          })
        },
        on(channel, listener) {
          let set = listeners.get(channel)
          if (!set) {
            set = new Set()
            listeners.set(channel, set)
          }
          set.add(listener)
          return () => {
            set?.delete(listener)
          }
        },
        send(channel, ...args) {
          ws.send(JSON.stringify({ type: 'send', channel, args }))
        },
      })
      resolve(true)
    })

    ws.addEventListener('message', (ev) => {
      let msg: RpcResult
      try {
        msg = JSON.parse(String(ev.data)) as RpcResult
      } catch {
        return
      }
      if (msg.type === 'event' && msg.channel) {
        const set = listeners.get(msg.channel)
        if (set) {
          for (const cb of set) cb(msg.data)
        }
        return
      }
      if (!msg.id) return
      const waiter = pending.get(msg.id)
      if (!waiter) return
      pending.delete(msg.id)
      if (msg.type === 'error') waiter.reject(new Error(msg.message || 'WebUI RPC error'))
      else waiter.resolve(msg.data)
    })

    ws.addEventListener('error', () => {
      if (!settled) {
        settled = true
        window.clearTimeout(timer)
        resolve(false)
      }
    })
    ws.addEventListener('close', () => {
      for (const waiter of pending.values()) {
        waiter.reject(new Error('WebUI connection closed'))
      }
      pending.clear()
    })
  })
}
