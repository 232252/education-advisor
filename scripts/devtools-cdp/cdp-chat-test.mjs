// CDP 聊天端到端测试: 发送消息 → 等待 Agent 回复 → 验证状态恢复
import { connectCdp, sleep } from '../lib/cdp-client.mjs'

const { evl, close } = await connectCdp({
  pageFilter: (t) => t.type === 'page' && !t.url.startsWith('devtools'),
})

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

close()
process.exit(0)
