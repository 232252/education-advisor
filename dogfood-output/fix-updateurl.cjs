// 修复 R15 测试副作用：updateUrl 被写成了 "R15_TEST_INPUT_VALUE"
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}

async function main() {
  const targets = await getTargets()
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.on('open', r))
  
  let id = 0
  const pending = new Map()
  ws.on('message', msg => {
    const obj = JSON.parse(msg)
    if (obj.id && pending.has(obj.id)) {
      const { resolve } = pending.get(obj.id)
      pending.delete(obj.id)
      resolve(obj.result)
    }
  })
  
  const eval = async (expr) => {
    const r = await new Promise((resolve, reject) => {
      const curId = ++id
      pending.set(curId, { resolve, reject })
      ws.send(JSON.stringify({ id: curId, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
      setTimeout(() => { if (pending.has(curId)) { pending.delete(curId); reject(new Error('timeout')) } }, 30000)
    })
    return r.result?.value
  }
  
  // 检查当前 updateUrl
  const before = await eval(`(async () => {
    const s = await window.api.settings.get()
    return s.general.updateUrl
  })()`)
  console.log('Before fix - updateUrl:', JSON.stringify(before))
  
  // 修复：清空 updateUrl
  await eval(`(async () => {
    await window.api.settings.set('general.updateUrl', '')
    const s = await window.api.settings.get()
    return s.general.updateUrl
  })()`)
  
  // 验证
  const after = await eval(`(async () => {
    const s = await window.api.settings.get()
    return s.general.updateUrl
  })()`)
  console.log('After fix - updateUrl:', JSON.stringify(after))
  
  // 顺便恢复 theme 和 logLevel
  await eval(`(async () => {
    await window.api.settings.set('general.theme', 'dark')
    await window.api.settings.set('general.logLevel', 'info')
    const s = await window.api.settings.get()
    return { theme: s.general.theme, logLevel: s.general.logLevel }
  })()`)
  
  const finalCheck = await eval(`(async () => {
    const s = await window.api.settings.get()
    return { theme: s.general.theme, logLevel: s.general.logLevel, updateUrl: s.general.updateUrl }
  })()`)
  console.log('Final settings:', JSON.stringify(finalCheck))
  
  ws.close()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
