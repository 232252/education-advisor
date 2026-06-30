// 探查 skill 和 class 实际返回
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
      const { resolve, reject } = pending.get(obj.id)
      pending.delete(obj.id)
      if (obj.error) reject(new Error(JSON.stringify(obj.error)))
      else resolve(obj.result)
    }
  })
  async function evalJs(expr) {
    const i = ++id
    return new Promise((resolve, reject) => {
      pending.set(i, { resolve, reject })
      ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
      setTimeout(() => { if (pending.has(i)) { pending.delete(i); reject(new Error('timeout')) } }, 60000)
    })
  }
  function extract(r) {
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }

  // 探查 skill
  const skillName = `probe-skill-${Date.now()}`
  console.log('=== Skill probe ===')
  const saveR = extract(await evalJs(`(async () => await window.api.skill.save(${JSON.stringify(skillName)}, 'test content'))()`))
  console.log('skill.save:', JSON.stringify(saveR))
  const getR = extract(await evalJs(`(async () => await window.api.skill.get(${JSON.stringify(skillName)}))()`))
  console.log('skill.get:', JSON.stringify(getR).slice(0, 200))
  const listR = extract(await evalJs(`(async () => await window.api.skill.list())()`))
  console.log('skill.list:', JSON.stringify(listR).slice(0, 300))
  await evalJs(`(async () => await window.api.skill.delete(${JSON.stringify(skillName)}))()`)

  // 探查 class
  console.log('\n=== Class probe ===')
  const classId = `probe-${Date.now()}`.slice(0, 15)
  const createR = extract(await evalJs(`(async () => await window.api.class.create({
    class_id: ${JSON.stringify(classId)},
    name: 'Probe Class',
    grade: '高一',
    note: 'probe'
  }))()`))
  console.log('class.create:', JSON.stringify(createR).slice(0, 200))

  const listR2 = extract(await evalJs(`(async () => await window.api.class.list())()`))
  console.log('class.list type:', typeof listR2, 'isArray:', Array.isArray(listR2))
  console.log('class.list:', JSON.stringify(listR2).slice(0, 400))

  // 探查 cron
  console.log('\n=== Cron probe ===')
  const cronListR = extract(await evalJs(`(async () => await window.api.cron.list())()`))
  console.log('cron.list type:', typeof cronListR)
  if (Array.isArray(cronListR) && cronListR.length > 0) {
    console.log('cron[0]:', JSON.stringify(cronListR[0]).slice(0, 400))
  }

  // 清理
  await evalJs(`(async () => await window.api.class.delete(${JSON.stringify(classId)}))()`)

  ws.close()
}
main().catch(e => { console.error(e); process.exit(1) })
