// 调查已删除学生是否仍在排行榜
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

  // 创建测试学生
  const name = `删除调查_${Date.now()}`
  console.log('Creating student:', name)
  await ev(`(async()=>{ await window.api.eaa.addStudent('${name}'); })()`)

  // 添加事件 (确保在排行榜中)
  await ev(`(async()=>{ try { await window.api.eaa.addEvent({ studentName: '${name}', reasonCode: 'CLASS_MONITOR', note: '调查', operator: 'test' }); } catch(e) {} })()`)
  await new Promise((r) => setTimeout(r, 500))

  // 检查排行榜 (删除前)
  const rankBefore = await ev(`(async()=>{
    const r = await window.api.eaa.ranking(50);
    return JSON.stringify(r.data?.ranking?.find(s => s.name === '${name}') || 'not found');
  })()`)
  console.log('Before delete - in ranking:', rankBefore)

  // 删除学生
  await ev(`(async()=>{ await window.api.eaa.deleteStudent('${name}', '调查删除'); })()`)
  await new Promise((r) => setTimeout(r, 500))

  // 检查 listStudents
  const listAfter = await ev(`(async()=>{
    const r = await window.api.eaa.listStudents();
    const s = r.data?.students?.find(x => x.name === '${name}');
    return JSON.stringify(s || 'not found');
  })()`)
  console.log('After delete - in listStudents:', listAfter)

  // 检查排行榜 (删除后)
  const rankAfter = await ev(`(async()=>{
    const r = await window.api.eaa.ranking(50);
    return JSON.stringify(r.data?.ranking?.find(s => s.name === '${name}') || 'not found');
  })()`)
  console.log('After delete - in ranking:', rankAfter)

  // 检查 score
  const scoreAfter = await ev(`(async()=>{
    const r = await window.api.eaa.score('${name}');
    return JSON.stringify(r);
  })()`)
  console.log('After delete - score:', JSON.stringify(scoreAfter?.data?.slice(0, 200)))

  // 清理
  await ev(`(async()=>{ try { await window.api.eaa.deleteStudent('${name}', '清理'); } catch(e) {} })()`)

  ws.close()
}

main().catch(console.error)
