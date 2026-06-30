// 清理 R9 测试遗留的脏数据
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
      const { resolve, reject } = pending.get(obj.id)
      pending.delete(obj.id)
      if (obj.error) reject(new Error(JSON.stringify(obj.error)))
      else resolve(obj.result)
    }
  })
  async function evalJs(expr) {
    const i = ++id
    return new Promise((resolve, reject) => {
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout')) } }, 60000)
    })
  }

  // 列出所有班级
  const listR = await evalJs(`(async () => await window.api.class.list())()`)
  const list = listR.result.value
  console.log('当前班级:', JSON.stringify(list, null, 2).slice(0, 800))

  // 删除所有 R9- 开头和 probe- 开头的
  if (list?.data) {
    for (const cls of list.data) {
      if (cls.class_id?.startsWith('R9-') || cls.class_id?.startsWith('probe-')) {
        console.log(`删除: ${cls.class_id} (${cls.id})`)
        await evalJs(`(async () => await window.api.class.delete(${JSON.stringify(cls.id)}))()`)
      }
    }
  }

  // 验证
  const listR2 = await evalJs(`(async () => await window.api.class.list())()`)
  console.log('\n清理后:', JSON.stringify(listR2.result.value, null, 2).slice(0, 400))

  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
