// =============================================================
// scripts/lib/cdp-client — CDP WebSocket 客户端共用库
//
// 11 个脚本此前的手写副本收敛于此(ipc-contract-test 运行时模式、
// perf-baseline、devtools-cdp/ 下 9 个): fetch /json → page target →
// WS 连接 → pending Map → send()/evl()。统一 30s 默认超时保护
// (此前 cdp-eval/cdp-shot 的 send 无超时,挂起即永久悬挂)。
// =============================================================
import WebSocket from 'ws'

export const CDP_HTTP = `http://localhost:${process.env.EA_CDP_PORT || '9222'}`

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** /json target 列表;端点不可达返回 null(供 CI 无实例时优雅跳过) */
export async function fetchTargets() {
  try {
    const r = await fetch(`${CDP_HTTP}/json`)
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

/**
 * 连接页面 target,返回 { ws, send, evl, close }。
 * - send(method, params, timeout=30000): 带超时的命令应答
 * - evl(expr, timeout=25000): Runtime.evaluate + returnByValue + awaitPromise;
 *   页面侧异常返回 { __error }(description 优先,截 400 字符)
 * - onMessage: 非应答消息(事件流)回调,如 Runtime.consoleAPICalled 监听
 * - pageFilter: 自定义 target 过滤(默认 type === 'page')
 */
export async function connectCdp({ maxPayload = 256 * 1024 * 1024, onMessage, pageFilter } = {}) {
  const targets = await fetchTargets()
  if (!targets) throw new Error(`no CDP endpoint at ${CDP_HTTP} — run the app with CDP enabled`)
  const page = pageFilter ? targets.find(pageFilter) : targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No page target found. Is the app running with CDP?')
  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload })
  await new Promise((res, rej) => {
    ws.on('open', res)
    ws.on('error', rej)
  })
  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    } else if (onMessage) {
      onMessage(msg)
    }
  })
  const send = (method, params = {}, timeout = 30000) =>
    new Promise((res, rej) => {
      const mid = ++id
      const t = setTimeout(() => {
        pending.delete(mid)
        rej(new Error(`timeout ${method}`))
      }, timeout)
      pending.set(mid, (m) => {
        clearTimeout(t)
        res(m)
      })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const evl = async (expr, timeout = 25000) => {
    const r = await send(
      'Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true },
      timeout,
    )
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails
      return { __error: (d.exception?.description || d.text || '').slice(0, 400) }
    }
    return r.result?.result?.value
  }
  return { ws, send, evl, close: () => ws.close() }
}
