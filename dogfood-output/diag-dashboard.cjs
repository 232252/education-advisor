// 诊断仪表盘渲染问题
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 8000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { const arr = JSON.parse(d); const p = arr.find(x => x.type === 'page'); resolve(p?.webSocketDebuggerUrl) })
    })
    req.on('error', reject)
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = { id: 0, pending: new Map() }
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && cdp.pending.has(m.id)) { const { resolve, reject } = cdp.pending.get(m.id); cdp.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } })
  cdp.send = (method, params = {}) => new Promise((r, j) => { const id = ++cdp.id; cdp.pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify({ id, method, params })) })
  cdp.eval = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result.value }

  console.log('=== 诊断仪表盘渲染 ===\n')

  // 当前 hash
  let hash = await cdp.eval(`window.location.hash`)
  console.log('1. 当前 hash:', hash)

  // 当前 URL
  let url = await cdp.eval(`window.location.href`)
  console.log('2. 当前 URL:', url)

  // body 文本长度
  let bodyLen = await cdp.eval(`document.body.innerText.length`)
  console.log('3. body 文本长度:', bodyLen)

  // h1 标题
  let h1 = await cdp.eval(`document.querySelector('h1')?.textContent || 'NULL'`)
  console.log('4. h1:', h1)

  // 尝试导航到 dashboard
  console.log('\n--- 导航到 dashboard ---')
  await cdp.eval(`window.location.hash = '/dashboard'`)
  await new Promise(r => setTimeout(r, 2000))

  hash = await cdp.eval(`window.location.hash`)
  console.log('导航后 hash:', hash)
  bodyLen = await cdp.eval(`document.body.innerText.length`)
  console.log('body 文本长度:', bodyLen)
  h1 = await cdp.eval(`document.querySelector('h1')?.textContent || 'NULL'`)
  console.log('h1:', h1)

  // 检查 React 根
  const rootEl = await cdp.eval(`!!document.getElementById('root')`)
  console.log('root 元素存在:', rootEl)

  // 检查是否有错误
  const errorMsg = await cdp.eval(`(()=>{try{return window.__ERROR__||'none'}catch(e){return 'err:'+e.message}})()`)
  console.log('错误:', errorMsg)

  // 检查 console 错误 (通过 Performance/Log)
  console.log('\n--- 检查页面状态 ---')
  const readyState = await cdp.eval(`document.readyState`)
  console.log('readyState:', readyState)

  // 刷新页面
  console.log('\n--- 刷新页面 ---')
  await cdp.eval(`window.location.reload()`)
  await new Promise(r => setTimeout(r, 3000))

  bodyLen = await cdp.eval(`document.body.innerText.length`)
  console.log('刷新后 body 文本长度:', bodyLen)
  h1 = await cdp.eval(`document.querySelector('h1')?.textContent || 'NULL'`)
  console.log('刷新后 h1:', h1)

  // 导航到 dashboard
  await cdp.eval(`window.location.hash = '/dashboard'`)
  await new Promise(r => setTimeout(r, 2000))
  bodyLen = await cdp.eval(`document.body.innerText.length`)
  h1 = await cdp.eval(`document.querySelector('h1')?.textContent || 'NULL'`)
  console.log('刷新+导航后 body:', bodyLen, 'h1:', h1)

  ws.close()
}
main().catch(console.error)
