// 验证 Chat h1 修复
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 15000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 12000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== 验证 Chat h1 修复 ===\n')
  await cdp.eval(`window.location.hash='/chat'`)
  await new Promise((r) => setTimeout(r, 1500))

  const checks = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1');
    const allH1 = Array.from(document.querySelectorAll('h1'));
    return {
      h1Count: allH1.length,
      h1Text: h1 ? h1.textContent : null,
      h1Visible: h1 ? (h1.offsetWidth > 0 || h1.offsetHeight > 0 || h1.getClientRects().length > 0) : false,
      h1Style: h1 ? h1.getAttribute('style') : null,
      // 检查侧边栏不会因此改变
      navCount: document.querySelectorAll('nav a').length,
    };
  })()`)
  console.log('结果:', JSON.stringify(checks, null, 2))

  if (checks.h1Count === 1 && checks.h1Text === '对话') {
    console.log('\n✓ PASS: Chat h1 已修复')
  } else {
    console.log('\n✗ FAIL: Chat h1 修复未生效')
  }

  // 顺便测试所有页面是否有 h1
  console.log('\n=== 所有页面 h1 检查 ===')
  const pages = ['/dashboard', '/chat', '/students', '/classes', '/agents', '/models', '/skills', '/scheduler', '/privacy', '/settings']
  for (const page of pages) {
    await cdp.eval(`window.location.hash='${page}'`)
    await new Promise((r) => setTimeout(r, 1000))
    const r = await cdp.eval(`(function(){
      const h1 = document.querySelector('h1');
      return { hasH1: h1 !== null, text: h1 ? h1.textContent?.slice(0,30) : null };
    })()`)
    const status = r.hasH1 ? '✓' : '✗'
    console.log(`  ${status} ${page}: hasH1=${r.hasH1}${r.text ? ', text="' + r.text + '"' : ''}`)
  }

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
