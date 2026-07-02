// 诊断快速导航失败的页面
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try { const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          j(new Error(`CDP timeout: ${method}`))
        }
      }, 20000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 15000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const pages = ['/dashboard', '/classes', '/students', '/chat', '/agents', '/models', '/skills', '/scheduler', '/privacy', '/settings']
  console.log('=== 单次导航测试 (检查每页加载耗时 + 是否有 h1/h2/h3) ===\n')

  for (const page of pages) {
    const t0 = Date.now()
    await cdp.eval(`window.location.hash='${page}'`)
    await new Promise((r) => setTimeout(r, 1500))
    // 多次探测: 500ms / 1500ms / 3000ms / 5000ms
    const probes = []
    for (const wait of [0, 500, 1500, 3000]) {
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      const hasContent = await cdp.eval(`document.querySelector('h1, h2, h3, [class*="title"]') !== null`)
      const loadingEl = await cdp.eval(`document.querySelector('[class*="loading"], [class*="spinner"]') !== null`)
      const bodyText = await cdp.eval(`document.body.textContent?.slice(0, 80)`)
      probes.push({ wait: wait + 1500, hasContent, loadingEl, bodyText })
    }
    const totalTime = Date.now() - t0
    const finalOk = probes[probes.length - 1].hasContent
    console.log(`${page}: ${finalOk ? 'OK' : 'FAIL'} (${totalTime}ms)`)
    probes.forEach((p, i) => {
      console.log(`  @${p.wait}ms: content=${p.hasContent}, loading=${p.loadingEl}, text="${p.bodyText?.replace(/\s+/g, ' ')}"`)
    })
  }

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
