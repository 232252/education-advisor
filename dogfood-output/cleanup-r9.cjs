// 清理 R9 第一次失败运行残留的 3 个班级
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 5000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)
  const callApi = (path, ...args) => cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p)o=o[x];const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)

  console.log('=== 清理 R9 残留班级 ===')
  const list = await callApi('class.list')
  const classes = Array.isArray(list) ? list : (list?.data || [])
  console.log(`当前班级数: ${classes.length}`)
  for (const c of classes) {
    console.log(`  - id=${c.id}, class_id=${c.class_id}, name=${c.name}`)
    // 只删除 R9 开头的 class_id (第一次失败运行残留)
    if (c.class_id && c.class_id.startsWith('R9')) {
      const r = await callApi('class.delete', c.id)
      console.log(`    删除: ${r.success ? '成功' : '失败'} ${r.error || ''}`)
    } else {
      console.log(`    跳过 (非 R9 残留)`)
    }
  }
  const list2 = await callApi('class.list')
  const classes2 = Array.isArray(list2) ? list2 : (list2?.data || [])
  console.log(`\n清理后班级数: ${classes2.length}`)

  ws.close()
  process.exit(0)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
