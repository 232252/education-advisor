// R7b: 验证 listStudents 返回的学生是否包含 is_valid 字段
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
  // 列出所有学生,检查字段
  const list = await eval_(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return r.data.students;
  })()`)
  console.log('Total students returned:', list.length)
  // 看第一个学生的字段
  if (list.length > 0) {
    console.log('First student fields:', Object.keys(list[0]))
    console.log('First student:', JSON.stringify(list[0], null, 2))
  }
  // 找到 R7Test 学生 (软删除的)
  const r7 = list.filter(s => s.name && s.name.startsWith('R7Test_'))
  console.log('R7Test students (should be soft-deleted):', r7.length)
  for (const s of r7) {
    console.log(' ', s.name, '->', JSON.stringify(s))
  }
  // 找 R6TestStu
  const r6 = list.filter(s => s.name === 'R6TestStu')
  console.log('R6TestStu (should be soft-deleted):', r6.length)
  for (const s of r6) {
    console.log(' ', s.name, '->', JSON.stringify(s))
  }
  // 找 is_valid=false 的学生
  const invalid = list.filter(s => s.is_valid === false || s.isValid === false || s.status === 'deleted' || s.status === 'invalid')
  console.log('Students with is_valid=false:', invalid.length)
  for (const s of invalid.slice(0, 5)) {
    console.log(' ', s.name, '->', JSON.stringify(s))
  }
  // 看 info 命令的完整返回
  const info = await eval_(`(async()=>{ return await window.api.eaa.info(); })()`)
  console.log('\nEAA info full response:')
  console.log(JSON.stringify(info, null, 2).slice(0, 1500))
  ws.close()
}
main().catch(e => { console.log('err:', e.message); process.exit(1) })
