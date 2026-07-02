// 诊断 addStudent 返回值结构
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 20000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 15000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== addStudent 返回值诊断 ===\n')

  // 1. 添加一个新学生 (注意:可能有残留,先用唯一的名字)
  const testName = 'DIAG_TEST_' + Date.now()
  const r1 = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.addStudent('${testName}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  console.log(`addStudent('${testName}'):`)
  console.log(JSON.stringify(r1, null, 2))

  // 2. 重复添加
  const r2 = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.addStudent('${testName}');
    return JSON.parse(JSON.stringify(r));
  })()`)
  console.log(`\naddStudent('${testName}') 重复:`)
  console.log(JSON.stringify(r2, null, 2))

  // 3. 检查 listStudents 是否包含
  const r3 = await cdp.eval(`(async()=>{
    const r = await window.api.eaa.listStudents();
    const students = r.data?.students || [];
    const found = students.find(s => s.name === '${testName}');
    return { total: students.length, found: found ? { name: found.name, score: found.score } : null };
  })()`)
  console.log(`\nlistStudents 检查:`)
  console.log(JSON.stringify(r3, null, 2))

  // 4. 清理
  await cdp.eval(`(async()=>{ await window.api.eaa.deleteStudent('${testName}', '清理'); })()`)

  // 5. 也检查 class.list 返回值
  const r4 = await cdp.eval(`(async()=>{
    const r = await window.api.class.list();
    return JSON.parse(JSON.stringify(r));
  })()`)
  console.log(`\nclass.list():`)
  console.log(JSON.stringify(r4, null, 2).slice(0, 600))

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
