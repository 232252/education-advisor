// 清理 R7 残留测试学生
const http = require('http')
const WebSocket = require('ws')
function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}
async function main() {
  const targets = await getTargets()
  const page = targets.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise(r => ws.on('open', r))
  let id = 0; const pending = new Map()
  ws.on('message', msg => {
    const obj = JSON.parse(msg)
    if (obj.id && pending.has(obj.id)) {
      const { resolve, reject } = pending.get(obj.id)
      pending.delete(obj.id)
      if (obj.error) reject(new Error(JSON.stringify(obj.error)))
      else resolve(obj.result)
    }
  })
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const i = ++id
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method, params }))
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout')) } }, 15000)
    })
  }
  async function eval_(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description }
    return r.result.value
  }
  // 列出所有 R7Test / R6TestStu 学生
  const list = await eval_(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return r.data.students.filter(s => s.name.startsWith('R7Test_') || s.name === 'R6TestStu').map(s => s.name);
  })()`)
  console.log('Test students to clean:', list)
  for (const name of (list || [])) {
    const r = await eval_(`(async()=>{
      try { return await window.api.eaa.deleteStudent(${JSON.stringify(name)}, 'cleanup');
      } catch(e) { return { __error: e.message }; }
    })()`)
    console.log('  delete', name, ':', JSON.stringify(r).slice(0, 120))
  }
  // 列出所有 R4- 班级 (R4 残留)
  const cls = await eval_(`(async()=>{
    const r = await window.api.class.list();
    return r.data.filter(c => c.class_id && c.class_id.startsWith('R4-')).map(c => ({id: c.id, class_id: c.class_id}));
  })()`)
  console.log('R4 classes to clean:', cls?.length || 0)
  for (const c of (cls || [])) {
    const r = await eval_(`(async()=>{
      try { return await window.api.class.delete(${JSON.stringify(c.id)});
      } catch(e) { return { __error: e.message }; }
    })()`)
    console.log('  delete class', c.class_id, ':', JSON.stringify(r).slice(0, 80))
  }
  ws.close()
}
main().catch(e => { console.log('err:', e.message); process.exit(1) })
