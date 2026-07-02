// 快速状态检查 — 看有多少班级和学生
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 8000 }, (res) => {
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

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try { const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== 状态检查 ===')
  const t1 = Date.now()
  const cls = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return r; })()`)
  console.log(`class.list: ${Date.now() - t1}ms, success=${cls?.success}, count=${cls?.data?.length}`)
  if (cls?.data?.length > 0) {
    console.log('班级列表:')
    cls.data.forEach((c) => console.log(`  - ${c.class_id}: ${c.name} (archived=${c.archived})`))
  }

  const t2 = Date.now()
  const stu = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return r; })()`)
  console.log(`\neaa.listStudents: ${Date.now() - t2}ms, success=${stu?.success}, count=${stu?.data?.students?.length}`)
  if (stu?.data?.students?.length > 0) {
    console.log('学生列表 (前20):')
    stu.data.students.slice(0, 20).forEach((s) => console.log(`  - ${s.name} (class_id=${s.class_id || '-'}, score=${s.score})`))
    if (stu.data.students.length > 20) console.log(`  ... 共 ${stu.data.students.length} 个学生`)
  }

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
