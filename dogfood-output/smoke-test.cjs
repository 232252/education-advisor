// Smoke test: 确认应用响应、window.api 可用、页面可加载
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    if (!page) throw new Error('no page target')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r, rej) => {
      this.ws.on('open', r)
      this.ws.on('error', rej)
    })
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout: ' + method)) } }, 30000)
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
  console.log('=== Smoke Test ===')

  // 1. 当前 URL
  const url = await c.eval('location.href')
  console.log('URL:', url)

  // 2. window.api 是否存在
  const apiKeys = await c.eval('window.api ? Object.keys(window.api).join(",") : "NO_API"')
  console.log('window.api keys:', apiKeys)

  // 3. 标题
  const title = await c.eval('document.title')
  console.log('title:', title)

  // 4. body 长度
  const bodyLen = await c.eval('document.body ? document.body.innerHTML.length : 0')
  console.log('body length:', bodyLen)

  // 5. 测试几个核心 API
  const eaaInfo = await c.eval('(async () => { try { return await window.api.eaa.info() } catch(e) { return "ERR:" + e.message } })()')
  console.log('eaa.info:', JSON.stringify(eaaInfo).slice(0, 200))

  const settings = await c.eval('(async () => { try { return await window.api.settings.get() } catch(e) { return "ERR:" + e.message } })()')
  console.log('settings.get keys:', settings && typeof settings === 'object' ? Object.keys(settings).join(',') : settings)

  const agents = await c.eval('(async () => { try { return await window.api.agent.list() } catch(e) { return "ERR:" + e.message } })()')
  console.log('agent.list:', Array.isArray(agents) ? `${agents.length} agents` : agents)

  const skills = await c.eval('(async () => { try { return await window.api.skill.list() } catch(e) { return "ERR:" + e.message } })()')
  console.log('skill.list:', Array.isArray(skills) ? `${skills.length} skills` : skills)

  const crons = await c.eval('(async () => { try { return await window.api.cron.list() } catch(e) { return "ERR:" + e.message } })()')
  console.log('cron.list:', Array.isArray(crons) ? `${crons.length} crons` : crons)

  const classes = await c.eval('(async () => { try { return await window.api.class.list() } catch(e) { return "ERR:" + e.message } })()')
  console.log('class.list:', Array.isArray(classes) ? `${classes.length} classes` : classes)

  const logs = await c.eval('(async () => { try { return await window.api.log.list() } catch(e) { return "ERR:" + e.message } })()')
  console.log('log.list:', Array.isArray(logs) ? `${logs.length} logs` : logs)

  // 6. 内存
  const mem = await c.eval('JSON.stringify(performance.memory ? {used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize} : {})')
  console.log('memory:', mem)

  // 7. 当前路由
  const hash = await c.eval('location.hash')
  console.log('hash:', hash)

  // 8. Console 错误计数(通过注入监听)
  const errs = await c.eval('(function(){ if(!window.__errCount){window.__errCount=0;window.__errs=[];window.addEventListener("error",e=>{window.__errCount++;if(window.__errs.length<20)window.__errs.push(e.message)})} return window.__errCount })()')
  console.log('error count so far:', errs)

  c.close()
  console.log('=== Smoke Test OK ===')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
