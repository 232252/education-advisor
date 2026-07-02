// 详细检查 EAA 状态
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

  console.log('=== EAA 详细诊断 ===\n')

  const listStu = await cdp.eval(`(async()=>{ try { const r=await window.api.eaa.listStudents(); return JSON.parse(JSON.stringify(r)); } catch(e){ return {err:e.message}; } })()`)
  console.log('listStudents result:')
  console.log(JSON.stringify(listStu, null, 2))

  const info = await cdp.eval(`(async()=>{ try { const r=await window.api.eaa.info(); return JSON.parse(JSON.stringify(r)); } catch(e){ return {err:e.message}; } })()`)
  console.log('\ninfo result:')
  console.log(JSON.stringify(info, null, 2).slice(0, 800))

  const stats = await cdp.eval(`(async()=>{ try { const r=await window.api.eaa.stats(); return JSON.parse(JSON.stringify(r)); } catch(e){ return {err:e.message}; } })()`)
  console.log('\nstats result:')
  console.log(JSON.stringify(stats, null, 2).slice(0, 600))

  const doctor = await cdp.eval(`(async()=>{ try { const r=await window.api.eaa.doctor(); return JSON.parse(JSON.stringify(r)); } catch(e){ return {err:e.message}; } })()`)
  console.log('\ndoctor result:')
  console.log(JSON.stringify(doctor, null, 2).slice(0, 1000))

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
