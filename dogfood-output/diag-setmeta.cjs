// 诊断: 测试 setStudentMeta 参数传递
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
  const cdp = { id: 0, pending: new Map(), ws }
  ws.on('message', (data) => {
    try { const m = JSON.parse(data.toString()); if (m.id && cdp.pending.has(m.id)) { const { resolve, reject } = cdp.pending.get(m.id); cdp.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {}
  })
  cdp.send = (method, params = {}) => new Promise((r, j) => { const id = ++cdp.id; cdp.pending.set(id, { resolve: r, reject: j }); cdp.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (cdp.pending.has(id)) { cdp.pending.delete(id); j(new Error('timeout: ' + method)) } }, 30000) })
  cdp.eval = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  cdp.api = async (code) => { const expr = "(async()=>{try{const r=" + code + ";return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()"; const v = await cdp.eval(expr); if (typeof v === 'string' && v.startsWith('ERR:')) throw new Error(v.slice(4)); try { return v ? JSON.parse(v) : null } catch (e) { return v } }

  // 1. 创建一个测试学生
  const testName = 'DiagTest_' + Date.now()
  console.log('1. 创建学生:', testName)
  const addRes = await cdp.api("await window.api.eaa.addStudent('" + testName + "')")
  console.log('   addStudent 返回:', JSON.stringify(addRes))

  // 2. 测试 setStudentMeta (name 参数)
  console.log('2. 调用 setStudentMeta({name:..., classId:...})')
  try {
    const metaRes = await cdp.api("await window.api.eaa.setStudentMeta({name:'" + testName + "',classId:'DIAG-CLS'})")
    console.log('   setStudentMeta 返回:', JSON.stringify(metaRes))
  } catch (e) {
    console.log('   setStudentMeta 失败:', e.message)
  }

  // 3. 验证 class_id
  const listRes = await cdp.api('await window.api.eaa.listStudents()')
  const stu = (listRes?.data?.students ?? []).find(s => s.name === testName)
  console.log('3. 验证:', testName, 'class_id=', stu?.class_id)

  // 4. 测试 clearClassId
  console.log('4. 调用 setStudentMeta({name:..., clearClassId:true})')
  try {
    const clearRes = await cdp.api("await window.api.eaa.setStudentMeta({name:'" + testName + "',clearClassId:true})")
    console.log('   setStudentMeta clear 返回:', JSON.stringify(clearRes))
  } catch (e) {
    console.log('   setStudentMeta clear 失败:', e.message)
  }

  // 5. 验证清除
  const listRes2 = await cdp.api('await window.api.eaa.listStudents()')
  const stu2 = (listRes2?.data?.students ?? []).find(s => s.name === testName)
  console.log('5. 验证清除:', testName, 'class_id=', stu2?.class_id)

  // 6. 清理
  await cdp.api("await window.api.eaa.deleteStudent('" + testName + "','diag清理')")
  console.log('6. 清理完成')

  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
