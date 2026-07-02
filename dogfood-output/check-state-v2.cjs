// 验证 EAA + class 当前数据状态
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = { ws, id: 0, pending: new Map() }
  ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && cdp.pending.has(m.id)) { const { resolve, reject } = cdp.pending.get(m.id); cdp.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} })
  cdp.send = (method, params = {}) => new Promise((r, j) => { const id = ++cdp.id; cdp.pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (cdp.pending.has(id)) { cdp.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 30000) })
  cdp.eval = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  cdp.api = async (code) => { const v = await cdp.eval("(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"); if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4)); try { return v ? JSON.parse(v) : null } catch (e) { return v } }

  console.log('=== 当前数据状态 ===')
  const students = await cdp.api('await window.api.eaa.listStudents()')
  const activeStudents = (students?.data?.students ?? []).filter(s => s.status !== 'Deleted')
  const deletedStudents = (students?.data?.students ?? []).filter(s => s.status === 'Deleted')
  console.log('EAA 学生总数:', students?.data?.total ?? 0)
  console.log('  Active:', activeStudents.length)
  console.log('  Deleted:', deletedStudents.length)
  if (activeStudents.length > 0) {
    console.log('  样例:', activeStudents.slice(0, 5).map(s => s.name + '(class=' + s.class_id + ')').join(', '))
  }

  const classes = await cdp.api('await window.api.class.list()')
  const classList = classes?.data ?? []
  console.log('\n班级总数:', classList.length)
  if (classList.length > 0) {
    classList.forEach((c, i) => console.log('  #' + i, c.name, 'class_id=' + c.class_id, 'students=' + (c.student_count ?? '?'), 'archived=' + c.archived))
  }

  const stats = await cdp.api('await window.api.eaa.stats()')
  console.log('\nEAA stats:', JSON.stringify(stats?.data ?? stats).slice(0, 200))

  // 读取 events.json
  const eventsFile = await cdp.eval("(async()=>{try{const fs=require('fs');const p=require('path');const dataDir=window.api?.system?.getDataDir?window.api.system.getDataDir():null;if(!dataDir)return 'NO_DATADIR';const evPath=p.join(dataDir,'eaa-data','events','events.json');const c=fs.readFileSync(evPath,'utf-8');return c.slice(0,500);}catch(e){return 'ERR:'+e.message}})()")
  console.log('\nevents.json 前500字符:', eventsFile)

  ws.close()
  process.exit(0)
}
main().catch(e => { console.log('ERR:', e.message); process.exit(1) })
