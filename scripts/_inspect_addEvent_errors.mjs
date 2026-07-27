// 调试 R126 addEvent 失败原因
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

const STAMP = `dbg-${Date.now()}`
const stu = `${STAMP}-stu`
await evalInPage(ws, `(async () => { try { await window.api.eaa.addStudent(${JSON.stringify(stu)}); } catch {} return true; })()`)

// 单次 addEvent
const single = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addEvent({
      studentName: ${JSON.stringify(stu)},
      reasonCode: 'SPEAK_IN_CLASS',
      note: 'dbg single',
      operator: 'dbg',
      tags: ['dbg'],
    });
    return { ok: r?.success !== false, result: r };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
console.log('单次 addEvent:', JSON.stringify(single, null, 2).slice(0, 800))

// 并发 5 次
const concurrent = await evalInPage(ws, `(async () => {
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(window.api.eaa.addEvent({
      studentName: ${JSON.stringify(stu)},
      reasonCode: 'SPEAK_IN_CLASS',
      note: 'dbg concurrent ' + i,
      operator: 'dbg',
      tags: ['dbg'],
    }).then(r => ({ ok: r?.success !== false, error: r?.error }))
    .catch(e => ({ ok: false, error: e.message })));
  }
  return await Promise.all(promises);
})()`)
console.log('\n并发 5 次 addEvent:', JSON.stringify(concurrent, null, 2).slice(0, 1500))

// 串行 20 次
const sequential = await evalInPage(ws, `(async () => {
  const results = [];
  for (let i = 0; i < 20; i++) {
    try {
      const r = await window.api.eaa.addEvent({
        studentName: ${JSON.stringify(stu)},
        reasonCode: 'SPEAK_IN_CLASS',
        note: 'dbg seq ' + i,
        operator: 'dbg',
        tags: ['dbg'],
      });
      results.push({ ok: r?.success !== false, error: r?.error });
    } catch (e) { results.push({ ok: false, error: e.message }); }
  }
  return results;
})()`)
const seqOk = sequential.filter(r => r.ok).length
console.log(`\n串行 20 次: ${seqOk}/20 ok`)
console.log('前 3 个结果:', JSON.stringify(sequential.slice(0, 3), null, 2))
console.log('后 3 个结果:', JSON.stringify(sequential.slice(-3), null, 2))

// 清理
await evalInPage(ws, `(async () => { try { await window.api.eaa.deleteStudent(${JSON.stringify(stu)}); } catch {} return true; })()`)

ws.close()
process.exit(0)
