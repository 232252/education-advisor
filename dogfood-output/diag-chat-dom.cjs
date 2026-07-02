// 检查 Chat 页面 DOM 结构,看为什么没有 h1/h2/h3
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
        if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) }
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

  await cdp.eval(`window.location.hash='/chat'`)
  await new Promise((r) => setTimeout(r, 3000))

  console.log('=== Chat 页面 DOM 检查 ===\n')
  const html = await cdp.eval(`document.querySelector('#root')?.innerHTML?.slice(0, 2500) || 'NO #root'`)
  console.log('ROOT innerHTML (first 2500):')
  console.log(html)

  console.log('\n--- 关键元素检查 ---')
  const checks = await cdp.eval(`(function(){
    const r = {};
    r.h1Count = document.querySelectorAll('h1').length;
    r.h2Count = document.querySelectorAll('h2').length;
    r.h3Count = document.querySelectorAll('h3').length;
    r.h4Count = document.querySelectorAll('h4').length;
    r.allHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => h.tagName + ':' + h.textContent?.slice(0,40));
    r.titleClass = document.querySelectorAll('[class*="title"]').length;
    r.headerClass = document.querySelectorAll('[class*="header"]').length;
    r.mainCount = document.querySelectorAll('main').length;
    r.divCount = document.querySelectorAll('div').length;
    r.buttonCount = document.querySelectorAll('button').length;
    r.inputCount = document.querySelectorAll('input,textarea').length;
    r.bodyLen = document.body.textContent?.length || 0;
    // chat-specific selectors
    r.chatClass = document.querySelectorAll('[class*="chat"],[class*="Chat"]').length;
    r.msgClass = document.querySelectorAll('[class*="message"],[class*="message"]').length;
    return r;
  })()`)
  console.log(JSON.stringify(checks, null, 2))

  console.log('\n--- 路径检查 (window.location) ---')
  const loc = await cdp.eval(`({hash: window.location.hash, pathname: window.location.pathname, href: window.location.href})`)
  console.log(JSON.stringify(loc, null, 2))

  ws.close(1000)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
