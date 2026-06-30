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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => this.ws.on('open', r))
    this.id = 0; this.pending = new Map()
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.id && this.pending.has(obj.id)) {
        const { resolve, reject } = this.pending.get(obj.id)
        this.pending.delete(obj.id)
        if (obj.error) reject(new Error(JSON.stringify(obj.error)))
        else resolve(obj.result)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  close() { if (this.ws) this.ws.close() }
}

async function main() {
  const c = new CDPClient()
  await c.connect()

  await c.eval(`window.location.hash = '#/settings'`)
  await sleep(1000)

  // 检查所有 select 的 React onChange 源码
  const info = await c.eval(`JSON.stringify({
    selects: Array.from(document.querySelectorAll('select')).map((s, i) => {
      const reactKey = Object.keys(s).find(k => k.startsWith('__reactProps'))
      const props = reactKey ? s[reactKey] : null
      const onChangeStr = props?.onChange ? props.onChange.toString().slice(0, 300) : null
      return {
        index: i,
        value: s.value,
        options: Array.from(s.options).map(o => o.value),
        onChangePreview: onChangeStr
      }
    })
  })`)
  const data = JSON.parse(info)
  data.selects.forEach(s => {
    console.log(`\n[Select ${s.index}] value=${s.value}, options=${JSON.stringify(s.options)}`)
    if (s.onChangePreview) {
      console.log(`  onChange: ${s.onChangePreview}`)
    }
  })

  // 尝试用 select[0] (zh/en) 切换到 en
  console.log('\n--- Testing select[0] (zh/en) -> en ---')
  const r1 = await c.eval(`(async () => {
    const s = document.querySelectorAll('select')[0]
    if (!s) return { error: 'no select' }
    const before = s.value
    const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    ns.call(s, 'en')
    s.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 1000))
    return { before, after: s.value, localStorage: window.localStorage.getItem('education-advisor.lang') }
  })()`)
  console.log('Result:', JSON.stringify(r1))

  await c.eval(`window.location.hash = '#/dashboard'`)
  await sleep(800)
  const enDash = await c.eval(`document.body?.innerText?.slice(0, 100) || ''`)
  console.log('Dashboard (en):', enDash)

  // 恢复
  await c.eval(`window.location.hash = '#/settings'`)
  await sleep(500)
  await c.eval(`(async () => {
    const s = document.querySelectorAll('select')[0]
    const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    ns.call(s, 'zh')
    s.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(500)

  c.close()
}
main().catch(e => { console.error(e); process.exit(1) })
