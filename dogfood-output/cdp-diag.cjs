// CDP 诊断脚本 — 通过 renderer IPC 检查主进程状态
const http = require('node:http')
const WebSocket = require('ws')

const CDP_HTTP = 'http://127.0.0.1:9222'

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.id = 0; this.cbs = new Map() }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false })
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.id != null) { const cb = this.cbs.get(msg.id); if (cb) { this.cbs.delete(msg.id); msg.error ? cb.reject(new Error(JSON.stringify(msg.error))) : cb.resolve(msg.result) } }
      })
    })
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { if (this.cbs.has(id)) { this.cbs.delete(id); reject(new Error(`timeout: ${method}`)) } }, timeoutMs)
      this.cbs.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr, timeoutMs = 15000) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, timeoutMs)
    if (r.exceptionDetails) throw new Error('Eval: ' + JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { this.ws?.close() }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject)
  })
}

async function main() {
  const targets = await httpGet(`${CDP_HTTP}/json`)
  const page = targets.find((t) => t.type === 'page')
  const cdp = new CDP(page.webSocketDebuggerUrl)
  await cdp.connect()
  await cdp.send('Runtime.enable')

  console.log('=== IPC Diagnostics ===\n')

  // 1. agent.list()
  console.log('--- agent.list() ---')
  try {
    const agents = await cdp.eval(`window.api.agent.list()`)
    console.log('Agents:', JSON.stringify(agents, null, 2))
  } catch (e) { console.log('ERROR:', e.message) }

  // 2. sys.getPath
  console.log('\n--- sys.getPath ---')
  try {
    const userData = await cdp.eval(`window.api.sys.getPath('userData')`)
    console.log('userData:', userData)
  } catch (e) { console.log('ERROR:', e.message) }

  // 3. settings get
  console.log('\n--- settings.getAll ---')
  try {
    const settings = await cdp.eval(`window.api.settings.getAll()`)
    console.log('Settings:', JSON.stringify(settings, null, 2).substring(0, 2000))
  } catch (e) { console.log('ERROR:', e.message) }

  // 4. EAA doctor
  console.log('\n--- eaa.doctor ---')
  try {
    const doctor = await cdp.eval(`window.api.eaa.doctor()`)
    console.log('EAA doctor:', JSON.stringify(doctor, null, 2))
  } catch (e) { console.log('ERROR:', e.message) }

  // 5. eaa.systemInfo
  console.log('\n--- eaa.systemInfo ---')
  try {
    const info = await cdp.eval(`window.api.eaa.systemInfo()`)
    console.log('EAA systemInfo:', JSON.stringify(info, null, 2))
  } catch (e) { console.log('ERROR:', e.message) }

  // 6. eaa.listStudents
  console.log('\n--- eaa.listStudents ---')
  try {
    const students = await cdp.eval(`window.api.eaa.listStudents()`)
    console.log('Students:', JSON.stringify(students, null, 2).substring(0, 1000))
  } catch (e) { console.log('ERROR:', e.message) }

  // 7. eaa.listEvents
  console.log('\n--- eaa.listEvents ---')
  try {
    const events = await cdp.eval(`window.api.eaa.listEvents()`)
    console.log('Events:', JSON.stringify(events, null, 2).substring(0, 1000))
  } catch (e) { console.log('ERROR:', e.message) }

  // 8. privacy.status
  console.log('\n--- privacy.status ---')
  try {
    const status = await cdp.eval(`window.api.privacy.status()`)
    console.log('Privacy status:', JSON.stringify(status, null, 2))
  } catch (e) { console.log('ERROR:', e.message) }

  // 9. cron.list
  console.log('\n--- cron.list ---')
  try {
    const crons = await cdp.eval(`window.api.cron.list()`)
    console.log('Cron list:', JSON.stringify(crons, null, 2).substring(0, 2000))
  } catch (e) { console.log('ERROR:', e.message) }

  // 10. skill.list
  console.log('\n--- skill.list ---')
  try {
    const skills = await cdp.eval(`window.api.skill.list()`)
    console.log('Skills:', JSON.stringify(skills, null, 2).substring(0, 2000))
  } catch (e) { console.log('ERROR:', e.message) }

  // 11. class.list
  console.log('\n--- class.list ---')
  try {
    const classes = await cdp.eval(`window.api.class.list()`)
    console.log('Classes:', JSON.stringify(classes, null, 2).substring(0, 1000))
  } catch (e) { console.log('ERROR:', e.message) }

  // 12. log.list
  console.log('\n--- log.list ---')
  try {
    const logs = await cdp.eval(`window.api.log.list()`)
    console.log('Log files:', JSON.stringify(logs, null, 2).substring(0, 1000))
  } catch (e) { console.log('ERROR:', e.message) }

  cdp.close()
  console.log('\n=== Done ===')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
