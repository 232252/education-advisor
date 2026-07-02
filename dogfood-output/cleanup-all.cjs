// 清理所有学生和班级
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== 清理所有数据 ===')

  // 清理班级 (快)
  const clsRes = await cdp.eval(`(async()=>{ const r=await window.api.class.list(); return r; })()`)
  const clsCount = clsRes?.data?.length || 0
  let clsDel = 0
  for (const c of clsRes?.data ?? []) {
    const r = await cdp.eval(`(async()=>{ const r=await window.api.class.delete('${c.id}'); return r; })()`)
    if (r?.success) clsDel++
  }
  console.log(`班级: 删除 ${clsDel}/${clsCount}`)

  // 清理学生 (慢, 每个约1.4s)
  const stuRes = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return r; })()`)
  const stuCount = stuRes?.data?.students?.length || 0
  console.log(`学生: 开始删除 ${stuCount} 个 (预计 ${Math.round(stuCount * 1.5)}s)`)
  let stuDel = 0
  for (let i = 0; i < (stuRes?.data?.students ?? []).length; i++) {
    const s = stuRes.data.students[i]
    const r = await cdp.eval(`(async()=>{ const r=await window.api.eaa.deleteStudent(${JSON.stringify(s.name)}, '清理'); return r; })()`)
    if (r?.success) stuDel++
    if ((i + 1) % 10 === 0) console.log(`  进度: ${i + 1}/${stuCount}`)
  }
  console.log(`学生: 删除 ${stuDel}/${stuCount}`)

  // 验证
  const verifyStu = await cdp.eval(`(async()=>{ const r=await window.api.eaa.listStudents(); return r; })()`)
  const verifyCount = verifyStu?.data?.students?.length ?? 0
  console.log(`\n验证: 剩余 ${verifyCount} 个学生`)

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
