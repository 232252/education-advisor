// 验证 ranking 是否包含已删除学生
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })

  const id = 1
  const expr = '(async()=>{' +
    'const r=await window.api.eaa.ranking(500);' +
    'const list=r.data?.ranking||r.data||[];' +
    'const r31=list.filter(x=>x.name.includes("R31Consistency"));' +
    'const stu=await window.api.eaa.listStudents();' +
    'const ds=(stu.data?.students||[]).filter(x=>x.name.includes("R31Consistency"));' +
    'return JSON.stringify({rankingCount:r31.length,rankingItems:r31.map(x=>({name:x.name,score:x.score})),studentCount:ds.length,students:ds.map(x=>({name:x.name,status:x.status,class_id:x.class_id}))});' +
    '})()'

  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))

  ws.on('message', (data) => {
    const m = JSON.parse(data.toString())
    if (m.id === id) {
      const val = m.result?.result?.value
      console.log(val || JSON.stringify(m).slice(0, 500))
      ws.close()
      process.exit(0)
    }
  })
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
