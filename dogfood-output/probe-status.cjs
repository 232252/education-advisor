// Quick probe: check student status values and counts
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
  const cdp = { id: 0, pending: new Map() }
  ws.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString())
      if (m.id && cdp.pending.has(m.id)) {
        const { resolve, reject } = cdp.pending.get(m.id)
        cdp.pending.delete(m.id)
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      }
    } catch (e) {}
  })
  const send = (method, params = {}) => new Promise((r, j) => {
    const id = ++cdp.id
    cdp.pending.set(id, { resolve: r, reject: j })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (cdp.pending.has(id)) { cdp.pending.delete(id); j(new Error('timeout')) } }, 30000)
  })
  const eval_ = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200))
    return r.result.value
  }

  // Get student list
  const result = await eval_("(async()=>{try{const r=await window.api.eaa.listStudents();return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  const parsed = JSON.parse(result)
  const students = parsed?.data?.students ?? []
  console.log('Total students:', students.length)

  // Count by status
  const statusCounts = {}
  for (const s of students) {
    const st = s.status || 'undefined'
    statusCounts[st] = (statusCounts[st] || 0) + 1
  }
  console.log('Status distribution:', JSON.stringify(statusCounts))

  // Show first 3 students
  console.log('First 3 students:')
  students.slice(0, 3).forEach(s => {
    console.log('  name:', s.name, 'status:', s.status, 'class_id:', s.class_id, 'score:', s.score)
  })

  // Count by class_id
  const classCounts = {}
  for (const s of students) {
    const cid = s.class_id || 'null'
    classCounts[cid] = (classCounts[cid] || 0) + 1
  }
  console.log('Class_id distribution:', JSON.stringify(classCounts))

  // Get class list
  const classResult = await eval_("(async()=>{try{const r=await window.api.class.list();return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()")
  const classParsed = JSON.parse(classResult)
  console.log('Classes:', classParsed?.data?.length || 0)

  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
