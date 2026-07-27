// 调试 addEvent 失败 - 捕获完整返回
import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/json`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function cdpCall(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.toString())
      if (msg.id === id) {
        ws.off('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { ws.off('message', handler); reject(new Error('timeout')) }, 30000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000,
  })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  return r.result.value
}

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('timeout')), 10000) })

const STAMP = `dbg2-${Date.now()}`
const stu = `${STAMP}-stu`
await evalInPage(ws, `(async () => { try { await window.api.eaa.addStudent(${JSON.stringify(stu)}); } catch {} return true; })()`)

// 串行 5 次,捕获完整返回
const seq = await evalInPage(ws, `(async () => {
  const results = [];
  for (let i = 0; i < 5; i++) {
    try {
      const r = await window.api.eaa.addEvent({
        studentName: ${JSON.stringify(stu)},
        reasonCode: 'SPEAK_IN_CLASS',
        note: 'dbg2 seq ' + i,
        operator: 'dbg2',
        tags: ['dbg2'],
      });
      results.push({ index: i, full: r });
    } catch (e) { results.push({ index: i, threw: e.message }); }
  }
  return results;
})()`)
console.log('串行 5 次完整返回:')
for (const r of seq) {
  console.log(`  [${r.index}]`, JSON.stringify(r.full || r.threw, null, 2).slice(0, 400))
}

// 同时查看 score (是否触发了下限)
const score = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.score(${JSON.stringify(stu)});
    return r;
  } catch (e) { return { error: e.message }; }
})()`)
console.log('\n当前 score:', JSON.stringify(score, null, 2).slice(0, 600))

// 清理
await evalInPage(ws, `(async () => { try { await window.api.eaa.deleteStudent(${JSON.stringify(stu)}); } catch {} return true; })()`)

ws.close()
process.exit(0)
