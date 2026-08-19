// CDP 聊天端到端测试: 发送消息 → 等待 Agent 回复 → 验证状态恢复
import WebSocket from 'ws'

async function getPageTarget() {
  const res = await fetch('http://localhost:9222/json')
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  if (!page) throw new Error('no page target')
  return page
}

const page = await getPageTarget()
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const pending = new Map()
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
const send = (method, params = {}, timeoutMs = 20000) => new Promise((res, rej) => {
  const mid = ++id
  const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)) }, timeoutMs)
  pending.set(mid, (msg) => { clearTimeout(timer); res(msg) })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evl = async (expr, timeout = 20000) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeout)
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 安装错误钩子
await evl(`(() => {
  if (window.__errHookInstalled) return true
  window.__errHookInstalled = true
  window.__consoleErrors = []
  window.addEventListener('error', (e) => window.__consoleErrors.push(String(e.message).slice(0, 200)))
  window.addEventListener('unhandledrejection', (e) => window.__consoleErrors.push('rej:' + String(e.reason).slice(0, 200)))
  return true
})()`)

// 1. 进入聊天页并新建对话
await evl(`location.hash = '#/chat'`)
await sleep(1500)

// 找到"新建对话"按钮并点击
const newChat = await evl(`(() => {
  const btns = [...document.querySelectorAll('button')]
  const b = btns.find(x => x.textContent.includes('新建对话'))
  if (!b) return { err: 'no new-chat button' }
  b.click()
  return { ok: true }
})()`)
console.log('newChat:', JSON.stringify(newChat))
await sleep(800)

// 2. 输入消息并发送
const sendMsg = await evl(`(() => {
  const ta = document.querySelector('textarea') || document.querySelector('input[type="text"]')
  if (!ta) return { err: 'no input' }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(ta, '用一句话介绍你自己')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  const btns = [...document.querySelectorAll('button')]
  const sendBtn = btns.find(x => x.textContent.trim() === '发送')
  if (!sendBtn) return { err: 'no send button' }
  sendBtn.click()
  return { ok: true }
})()`)
console.log('sendMsg:', JSON.stringify(sendMsg))

// 3. 等待 Agent 回复(最多 90s),轮询消息列表
let reply = null
for (let i = 0; i < 45; i++) {
  await sleep(2000)
  const state = await evl(`(() => {
    const main = document.querySelector('main') || document.body
    const text = main.innerText
    return {
      hasRunning: /正在思考|思考中|运行中/.test(text),
      hasError: /\\*\\*错误\\*\\*/.test(text),
      tail: text.slice(-400)
    }
  })()`)
  if (state?.hasError) { reply = { error: state.tail }; break }
  if (state && !state.hasRunning && i > 2) {
    // 再确认一次没有 streaming
    await sleep(2000)
    const again = await evl(`(() => /正在思考|思考中|运行中/.test((document.querySelector('main')||document.body).innerText))()`)
    if (!again) { reply = state.tail; break }
  }
}
console.log('reply tail:', JSON.stringify(reply)?.slice(0, 500))

// 4. 验证 agent 状态恢复 idle
const agents = await evl(`(async () => {
  const api = window.eaaAPI || window.api
  const list = await api.agent.list()
  return list.filter(a => a.status === 'running').map(a => a.id)
})()`)
console.log('running agents after chat:', JSON.stringify(agents))

// 5. 控制台错误
const errs = await evl(`window.__consoleErrors || []`)
console.log('console errors:', JSON.stringify(errs).slice(0, 600))

ws.close()
process.exit(0)
