// 检查当前数据库中的所有班级
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString())
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  })
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result.value }

  const classes = await evalJs(`(async()=>{const r=await window.api.class.list();return r.data})()`)

  console.log(`总班级数: ${classes.length}`)
  console.log('班级列表:')
  for (const c of classes) {
    console.log(`  - id=${c.id.slice(0, 8)}... class_id=${c.class_id} name="${c.name}" grade="${c.grade}" teacher="${c.teacher}" archived=${c.archived}`)
  }

  // 查找不是 CT-* 的班级
  const nonCT = classes.filter((c) => !c.class_id?.startsWith('CT-'))
  console.log(`\n非 CT-* 班级: ${nonCT.length}`)
  for (const c of nonCT) {
    console.log(`  - ${c.class_id} "${c.name}" (archived=${c.archived})`)
  }

  ws.close(1000)
}
main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
