// 诊断 R55 事件数为 0 的问题
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 8000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { const arr = JSON.parse(d); const p = arr.find(x => x.type === 'page'); resolve(p?.webSocketDebuggerUrl) })
    })
    req.on('error', reject)
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = { id: 0, pending: new Map() }
  ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && cdp.pending.has(m.id)) { const { resolve, reject } = cdp.pending.get(m.id); cdp.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } })
  cdp.send = (method, params = {}) => new Promise((r, j) => { const id = ++cdp.id; cdp.pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify({ id, method, params })) })
  cdp.eval = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result.value }
  cdp.api = async (code) => { const v = await cdp.eval(`(async()=>{try{const r=${code};return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`); if (typeof v === 'string' && v.startsWith('ERR:')) return { __error: v.slice(4) }; try { return v ? JSON.parse(v) : null } catch (e) { return v } }

  console.log('=== 诊断 R55 事件数为 0 ===\n')

  // 1. 创建测试学生和事件
  const ts = 'DIAG' + Date.now().toString().slice(-6)
  console.log('测试学生:', 'DIAGstu_' + ts)
  const addR = await cdp.api(`await window.api.eaa.addStudent('DIAGstu_${ts}')`)
  console.log('1. 创建学生:', addR?.success, addR?.data?.slice(0, 50))

  const evR = await cdp.api(`await window.api.eaa.addEvent({studentName:'DIAGstu_${ts}',reasonCode:'LATE'})`)
  console.log('2. 添加事件:', evR?.success, evR?.data?.slice(0, 100) || evR?.stderr?.slice(0, 100))

  // 3. 查询历史
  const histR = await cdp.api(`await window.api.eaa.history('DIAGstu_${ts}')`)
  const histData = histR?.data
  const histArr = Array.isArray(histData) ? histData : (histData?.events || histData?.timeline || [])
  console.log('3. 历史事件数:', histArr.length)
  if (histArr.length > 0) {
    console.log('   第一个事件:', JSON.stringify(histArr[0]).slice(0, 200))
  }

  // 4. range 查询
  const today = new Date().toISOString().slice(0, 10)
  const rangeR = await cdp.api(`await window.api.eaa.range('${today}','${today}',100)`)
  const rangeData = rangeR?.data
  const rangeEvents = rangeData?.events || rangeData
  const rangeArr = Array.isArray(rangeEvents) ? rangeEvents : []
  console.log('4. range 今日事件数:', rangeArr.length)

  // 5. range 全部
  const rangeAllR = await cdp.api(`await window.api.eaa.range('2020-01-01','2030-12-31',1000)`)
  const rangeAllData = rangeAllR?.data
  const rangeAllEvents = rangeAllData?.events || rangeAllData
  const rangeAllArr = Array.isArray(rangeAllEvents) ? rangeAllEvents : []
  console.log('5. range 全部事件数:', rangeAllArr.length)
  if (rangeAllArr.length > 0) {
    console.log('   第一个事件 entity_id:', rangeAllArr[0].entity_id?.slice(0, 20))
    console.log('   第一个事件 reason_code:', rangeAllArr[0].reason_code)
  }

  // 6. listStudents
  const listR = await cdp.api(`await window.api.eaa.listStudents()`)
  const students = listR?.data?.students || []
  const activeStudents = students.filter(s => s.status !== 'Deleted')
  console.log('6. 活跃学生数:', activeStudents.length)
  const diagStu = activeStudents.find(s => s.name === 'DIAGstu_' + ts)
  if (diagStu) {
    console.log('   DIAG 学生:', JSON.stringify(diagStu).slice(0, 200))
  }

  // 7. score
  const scR = await cdp.api(`await window.api.eaa.score('DIAGstu_${ts}')`)
  console.log('7. score:', scR?.success, JSON.stringify(scR?.data)?.slice(0, 100))

  // 8. stats
  const statsR = await cdp.api(`await window.api.eaa.stats()`)
  console.log('8. stats:', JSON.stringify(statsR?.data)?.slice(0, 300))

  // 9. doctor
  const docR = await cdp.api(`await window.api.eaa.doctor()`)
  console.log('9. doctor healthy:', docR?.data?.healthy)
  if (docR?.data?.issues?.length > 0) {
    console.log('   issues:', JSON.stringify(docR.data.issues).slice(0, 200))
  }

  // 清理
  await cdp.api(`await window.api.eaa.deleteStudent('DIAGstu_${ts}','诊断清理')`)
  console.log('\n清理完成')

  ws.close()
}
main().catch(console.error)
