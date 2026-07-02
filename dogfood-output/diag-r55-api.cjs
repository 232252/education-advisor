// 诊断 R55 API 调用返回 undefined 的原因
const http = require('http')
const WebSocket = require('ws')

function getCDPTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: 9222, path: '/json', timeout: 8000 },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          const arr = JSON.parse(d)
          const page = arr.find((p) => p.type === 'page')
          resolve(page ? page.webSocketDebuggerUrl : null)
        })
      },
    )
    req.on('error', reject)
  })
}

async function main() {
  const url = await getCDPTarget()
  const ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 })
  await new Promise((r, e) => {
    ws.on('open', r)
    ws.on('error', e)
  })
  let id = 0
  const pending = new Map()
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  })
  function send(method, params = {}) {
    const i = ++id
    return new Promise((resolve, reject) => {
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  }
  async function evalRaw(expr) {
    return await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })
  }

  console.log('=== 诊断 window.api 调用 ===\n')

  // 1. window.api 是否存在
  let r = await evalRaw(`typeof window.api`)
  console.log('1. typeof window.api:', r.result.value)

  // 2. window.api.class 是否存在
  r = await evalRaw(`typeof window.api.class`)
  console.log('2. typeof window.api.class:', r.result.value)

  // 3. window.api.class.create 是否是 function
  r = await evalRaw(`typeof window.api.class.create`)
  console.log('3. typeof window.api.class.create:', r.result.value)

  // 4. 直接调用 class.list (简单调用)
  r = await evalRaw(`window.api.class.list()`)
  console.log('4. class.list() raw result:')
  console.log('   type:', r.result.type)
  console.log('   value:', JSON.stringify(r.result.value)?.slice(0, 200))

  // 5. await class.list()
  r = await evalRaw(`(async()=>{const r=await window.api.class.list();return r})()`)
  console.log('5. await class.list() in async IIFE:')
  console.log('   type:', r.result.type)
  console.log('   value:', JSON.stringify(r.result.value)?.slice(0, 200))

  // 6. 模拟 R55 的 cdp.api 模式
  r = await evalRaw(`(async()=>{try{const r=await window.api.class.list();return r}catch(e){return {__error:e.message}}})()`)
  console.log('6. R55 api() pattern:')
  console.log('   type:', r.result.type)
  console.log('   value:', JSON.stringify(r.result.value)?.slice(0, 200))
  console.log('   exceptionDetails:', r.exceptionDetails)

  // 7. 测试 class.create (会真正创建)
  const ts = Date.now().toString().slice(-6)
  r = await evalRaw(`(async()=>{try{const r=await window.api.class.create({class_id:'DIAG-${ts}',name:'诊断班',grade:'高一'});return r}catch(e){return {__error:e.message}}})()`)
  console.log('7. class.create() result:')
  console.log('   type:', r.result.type)
  console.log('   value:', JSON.stringify(r.result.value)?.slice(0, 300))
  console.log('   exceptionDetails:', r.exceptionDetails)

  ws.close()
}
main().catch(console.error)
