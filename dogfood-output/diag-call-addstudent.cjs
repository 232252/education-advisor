// 诊断 call 函数对 addStudent 的调用
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

  console.log('=== call 函数对 addStudent 诊断 ===\n')

  // 清理
  await cdp.eval(`(async()=>{
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)

  // 测试1: 使用 call 函数
  const name1 = 'CALL_TEST_' + Date.now()
  const r1 = await call('eaa.addStudent', name1)
  console.log(`call('eaa.addStudent', '${name1}'):`)
  console.log('  type:', typeof r1)
  console.log('  value:', JSON.stringify(r1, null, 2))
  console.log('  success:', r1?.success)
  console.log('  __error:', r1?.__error)

  // 测试2: 使用中文名字
  const name2 = '张伟_TEST_' + Date.now()
  const r2 = await call('eaa.addStudent', name2)
  console.log(`\ncall('eaa.addStudent', '${name2}'):`)
  console.log('  type:', typeof r2)
  console.log('  value:', JSON.stringify(r2, null, 2))

  // 测试3: 模拟测试脚本中的循环
  const names = ['张伟1', '王芳2', '李娜3']
  for (const name of names) {
    const r = await call('eaa.addStudent', name)
    console.log(`\n${name}:`)
    console.log('  type:', typeof r)
    console.log('  success:', r?.success)
    console.log('  value:', JSON.stringify(r, null, 2).slice(0, 200))
    if (!r?.success) {
      console.log('  ❌ FAIL branch entered')
      console.log('  __error || error:', r?.__error || r?.error)
    }
  }

  // 清理
  await cdp.eval(`(async()=>{
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
