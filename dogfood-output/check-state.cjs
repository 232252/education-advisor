// 检查当前数据状态: 班级 + 学生 class_id 分布
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
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  async function call(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      const p='${apiPath}'.split('.');
      let o=window.api;
      for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}
      if(typeof o!=='function')return{__error:'not a function'};
      const a=${JSON.stringify(args)};
      try{const r=await o(...a);return r}catch(e){return{__error:e.message}}
    })()`)
  }

  console.log('=== 当前数据状态检查 ===\n')

  // 1. 班级列表
  const classes = await call('class.list')
  console.log('班级列表:', JSON.stringify(classes, null, 2))

  // 2. 学生列表(只看 class_id 分布)
  const students = await call('eaa.listStudents')
  const stuList = students?.data?.students ?? []
  console.log(`\n学生总数: ${stuList.length}`)
  const classIdMap = {}
  let nullCount = 0
  for (const s of stuList) {
    const cid = s.class_id || '(null)'
    classIdMap[cid] = (classIdMap[cid] || 0) + 1
    if (!s.class_id) nullCount++
  }
  console.log('class_id 分布:', JSON.stringify(classIdMap, null, 2))
  console.log(`未分班学生: ${nullCount}/${stuList.length}`)

  // 3. EAA info
  const info = await call('eaa.info')
  console.log('\nEAA info:', JSON.stringify(info?.data ?? info, null, 2))

  await cdp.close()
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
