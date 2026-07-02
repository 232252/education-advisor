// R9b 诊断: 检查 eaa.info / eaa.doctor / eaa.listStudents 实际返回
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: 9222, path: '/json', timeout: 5000 },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          try {
            const j = JSON.parse(d)
            const page = j.find((p) => p.type === 'page')
            if (!page) return reject(new Error('No page target'))
            resolve(page.webSocketDebuggerUrl)
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) reject(new Error(msg.error.message))
          else resolve(msg.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      timeout: 30000,
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
}

async function main() {
  const target = await getWsTarget()
  const ws = new WebSocket(target)
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })
  const cdp = new CdpClient(ws)

  async function callApi(path, ...args) {
    return cdp.eval(
      `(async () => {
        const parts = ${JSON.stringify(path)}.split('.')
        let obj = window.api
        for (const x of parts) { obj = obj[x] }
        const a = ${JSON.stringify(args)}
        try { return await obj(...a) } catch(e) { return { __error: e.message, __stack: e.stack } }
      })()`,
    )
  }

  console.log('=== R9b 诊断 ===\n')

  console.log('--- eaa.info ---')
  const info = await callApi('eaa.info')
  console.log(JSON.stringify(info, null, 2).slice(0, 500))

  console.log('\n--- eaa.doctor ---')
  const doc = await callApi('eaa.doctor')
  console.log(JSON.stringify(doc, null, 2).slice(0, 800))

  console.log('\n--- eaa.listStudents (前 3) ---')
  const list = await callApi('eaa.listStudents')
  const arr = Array.isArray(list) ? list : (list?.data || [])
  console.log('总数:', arr.length)
  console.log('前 3 个:', JSON.stringify(arr.slice(0, 3), null, 2))

  console.log('\n--- class.list ---')
  const cls = await callApi('class.list')
  console.log(JSON.stringify(cls, null, 2).slice(0, 500))

  console.log('\n--- 测试一个 addStudent (短名) ---')
  const t = await callApi('eaa.addStudent', 'R9Diag001')
  console.log(JSON.stringify(t, null, 2).slice(0, 300))

  console.log('\n--- 再次 eaa.info ---')
  const info2 = await callApi('eaa.info')
  console.log(JSON.stringify(info2, null, 2).slice(0, 500))

  console.log('\n--- 清理: deleteStudent R9Diag001 ---')
  const d = await callApi('eaa.deleteStudent', 'R9Diag001', 'diag')
  console.log(JSON.stringify(d, null, 2).slice(0, 300))

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
