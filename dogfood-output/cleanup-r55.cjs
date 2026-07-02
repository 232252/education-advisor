// 清理 R55 测试残留 + 诊断残留
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
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString())
    if (m.id && cdp.pending.has(m.id)) { const { resolve, reject } = cdp.pending.get(m.id); cdp.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) }
  })
  cdp.send = (method, params = {}) => new Promise((r, j) => { const id = ++cdp.id; cdp.pending.set(id, { resolve: r, reject: j }); ws.send(JSON.stringify({ id, method, params })) })
  cdp.eval = async (expr) => { const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200)); return r.result.value }
  cdp.api = async (code) => { const v = await cdp.eval(`(async()=>{try{const r=${code};return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`); if (typeof v === 'string' && v.startsWith('ERR:')) return { __error: v.slice(4) }; try { return v ? JSON.parse(v) : null } catch (e) { return v } }

  console.log('=== 清理 R55 + DIAG 残留 ===\n')

  // 1. 列出所有学生
  const listR = await cdp.api(`await window.api.eaa.listStudents()`)
  const allStudents = listR?.data?.students || []
  console.log('总学生数:', allStudents.length)

  // 2. 删除所有 R55/诊断 学生
  let delCount = 0
  for (const s of allStudents) {
    if (s.name.startsWith('R55s') || s.name.startsWith('R55') || s.name.includes('诊断') || s.name.startsWith('DIAG')) {
      const r = await cdp.api(`await window.api.eaa.deleteStudent('${s.name}','清理残留')`)
      if (r?.success) { delCount++; console.log('  删除学生:', s.name) }
    }
  }
  console.log('删除学生:', delCount)

  // 3. 列出所有班级
  const classListR = await cdp.api(`await window.api.class.list()`)
  const classes = classListR?.data || []
  console.log('\n总班级数:', classes.length)

  // 4. 删除所有 R55/诊断 班级
  let delClassCount = 0
  for (const c of classes) {
    if (c.class_id.startsWith('R55') || c.name.includes('R55') || c.name.includes('诊断') || c.class_id.startsWith('DIAG')) {
      const r = await cdp.api(`await window.api.class.delete('${c.id}')`)
      if (r?.success) { delClassCount++; console.log('  删除班级:', c.class_id, c.name) }
    }
  }
  console.log('删除班级:', delClassCount)

  // 5. 验证
  const afterList = await cdp.api(`await window.api.eaa.listStudents()`)
  const afterActive = (afterList?.data?.students || []).filter(s => s.status !== 'Deleted')
  const afterClass = await cdp.api(`await window.api.class.list()`)
  const afterClasses = afterClass?.data || []
  const r55Left = afterActive.filter(s => s.name.startsWith('R55'))
  const r55ClassLeft = afterClasses.filter(c => c.class_id.startsWith('R55') || c.name.includes('R55'))

  console.log('\n清理后:')
  console.log('  剩余学生:', afterActive.length, '(R55残留:', r55Left.length + ')')
  console.log('  剩余班级:', afterClasses.length, '(R55残留:', r55ClassLeft.length + ')')

  ws.close()
}
main().catch(console.error)
