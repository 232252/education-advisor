// 批量清理学生 (分批避免超时)
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d).find((x) => x.type === 'page').webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r) => ws.on('open', r))
  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const m = JSON.parse(data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
  })
  const send = (method, params = {}) => new Promise((r, j) => {
    const i = ++id; pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 200))
    return r.result.value
  }

  // 删除班级
  await ev(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    return true;
  })()`)
  console.log('Classes deleted')

  // 分批删除学生
  const stuListStr = await ev(`(async()=>{
    const r = await window.api.eaa.listStudents();
    return JSON.stringify((r.data?.students || []).map(s => s.name));
  })()`)
  const names = JSON.parse(stuListStr)
  console.log('Total students to delete:', names.length)

  for (let i = 0; i < names.length; i += 10) {
    const batch = names.slice(i, i + 10)
    const batchStr = JSON.stringify(batch)
    await ev(`(async()=>{
      const names = ${batchStr};
      for(const n of names){
        try { await window.api.eaa.deleteStudent(n, '清理'); } catch(e) {}
      }
      return true;
    })()`)
    console.log(`Deleted ${Math.min(i + 10, names.length)}/${names.length}`)
  }
  console.log('All cleaned')
  ws.close()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
