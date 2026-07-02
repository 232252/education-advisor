// 清理 VF-* 测试数据
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

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const m = JSON.parse(data.toString())
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  })
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 15000 }); return r.result.value }

  // 1. 删除 VF-* 班级
  const classes = await evalJs(`(async()=>{const r=await window.api.class.list();return r.data})()`)
  let delCls = 0
  for (const c of classes) {
    if (c.class_id?.startsWith('VF-')) {
      const r = await evalJs(`(async()=>{return await window.api.class.delete(${JSON.stringify(c.id)})})()`)
      if (r?.success) delCls++
      console.log(`删除班级 ${c.class_id}: ${r?.success ? 'OK' : 'FAIL ' + JSON.stringify(r)}`)
    }
  }
  console.log(`删除班级: ${delCls}`)

  // 2. 删除 VF-* 学生
  const students = await evalJs(`(async()=>{const r=await window.api.eaa.listStudents();return r.data?.students ?? []})()`)
  let delStu = 0
  for (const s of students) {
    if (s.name?.startsWith('VF-')) {
      const r = await evalJs(`(async()=>{return await window.api.eaa.deleteStudent(${JSON.stringify(s.name)}, 'cleanup')})()`)
      if (r?.success) delStu++
      console.log(`删除学生 ${s.name}: ${r?.success ? 'OK' : 'FAIL ' + JSON.stringify(r)}`)
    }
  }
  console.log(`删除学生: ${delStu}`)

  ws.close(1000)
}
main().catch((e) => { console.error('ERROR:', e); process.exit(1) })
