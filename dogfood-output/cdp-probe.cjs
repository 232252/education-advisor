// 快速探查实际 IPC 返回结构
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
  let id = 0
  const pending = new Map()
  ws.on('message', msg => {
    const obj = JSON.parse(msg)
    if (obj.id && pending.has(obj.id)) {
      const { resolve } = pending.get(obj.id)
      pending.delete(obj.id)
      resolve(obj.result)
    }
  })
  async function evalJs(expr) {
    const i = ++id
    return new Promise((resolve, reject) => {
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
    })
  }

  // 探查 chat.listSessions 结构
  const r1 = await evalJs(`(async () => { return await window.api.chat.listSessions() })()`)
  console.log('chat.listSessions:', JSON.stringify(r1.result.value).slice(0, 300))

  // 探查 chat.saveMessage 结构
  const r2 = await evalJs(`(async () => {
    return await window.api.chat.saveMessage({
      sessionId: 'probe-test',
      role: 'user',
      content: 'probe',
      timestamp: Date.now()
    })
  })()`)
  console.log('chat.saveMessage:', JSON.stringify(r2.result.value))

  // 探查 chat.loadMessages 结构
  const r3 = await evalJs(`(async () => { return await window.api.chat.loadMessages('probe-test') })()`)
  console.log('chat.loadMessages:', JSON.stringify(r3.result.value).slice(0, 300))

  // 清理
  await evalJs(`(async () => { return await window.api.chat.deleteSession('probe-test') })()`)

  // 探查 EAA score 结构 (用一个已知存在的学生)
  const listRes = await evalJs(`(async () => { return await window.api.eaa.listStudents() })()`)
  console.log('eaa.listStudents:', JSON.stringify(listRes.result.value).slice(0, 500))

  // 创建测试学生并查 score
  const testStudent = `Probe-${Date.now()}`
  await evalJs(`(async () => { return await window.api.eaa.addStudent(${JSON.stringify(testStudent)}) })()`)
  const scoreRes = await evalJs(`(async () => { return await window.api.eaa.score(${JSON.stringify(testStudent)}) })()`)
  console.log('eaa.score (new student):', JSON.stringify(scoreRes.result.value).slice(0, 500))

  // 加个事件再查
  await evalJs(`(async () => {
    return await window.api.eaa.addEvent({
      studentName: ${JSON.stringify(testStudent)},
      reasonCode: 'LATE'
    })
  })()`)
  const scoreRes2 = await evalJs(`(async () => { return await window.api.eaa.score(${JSON.stringify(testStudent)}) })()`)
  console.log('eaa.score (after LATE):', JSON.stringify(scoreRes2.result.value).slice(0, 500))

  // history
  const histRes = await evalJs(`(async () => { return await window.api.eaa.history(${JSON.stringify(testStudent)}) })()`)
  console.log('eaa.history:', JSON.stringify(histRes.result.value).slice(0, 800))

  // 清理
  await evalJs(`(async () => { return await window.api.eaa.deleteStudent(${JSON.stringify(testStudent)}) })()`)

  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
