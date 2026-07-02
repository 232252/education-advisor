const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 8000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try {
          const j = JSON.parse(d)
          const p = j.find((x) => x.type === 'page')
          resolve(p?.webSocketDebuggerUrl)
        } catch (e) {
          reject(e)
        }
      })
    })
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
        const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id)
          this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id
      this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          j(new Error('CDP timeout: ' + method))
        }
      }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async api(code) {
    const v = await this.eval(
      `(async()=>{try{const r=${code};return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`,
    )
    if (typeof v === 'string' && v.startsWith('ERR:')) return { __error: v.slice(4) }
    try {
      return v ? JSON.parse(v) : null
    } catch (e) {
      return v
    }
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })
  const cdp = new CdpClient(ws)

  const stats = await cdp.api(`await window.api.eaa.stats()`)
  console.log('=== EAA Stats ===')
  console.log(JSON.stringify(stats?.data, null, 2))

  const listR = await cdp.api(`await window.api.eaa.listStudents()`)
  const students = listR?.data?.students || []
  const active = students.filter((s) => s.status !== 'Deleted')
  console.log('\n=== Students ===')
  console.log('Total students:', students.length)
  console.log('Active students:', active.length)

  const classListR = await cdp.api(`await window.api.class.list()`)
  const classes = classListR?.data || []
  console.log('\n=== Classes ===')
  console.log('Total classes:', classes.length)
  for (const c of classes.slice(0, 10)) {
    const cnt = active.filter((s) => s.class_id === c.class_id).length
    console.log(`  ${c.class_id} | ${c.name} | ${cnt} students`)
  }

  ws.close()
  process.exit(0)
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
