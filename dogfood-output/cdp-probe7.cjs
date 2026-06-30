// 探查 R15 失败项的实际返回结构
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  async callApi(path, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('=== R15 失败项探查 ===\n')

  // 1. settings.get 完整结构
  console.log('[1] settings.get 完整结构:')
  const settings = await c.callApi('settings.get')
  console.log(JSON.stringify(settings, null, 2).slice(0, 1500))

  // 2. settings.set('theme', 'light') 后再 get
  console.log('\n[2] settings.set theme=light 后 get:')
  await c.callApi('settings.set', 'theme', 'light')
  await sleep(300)
  const settingsAfter = await c.callApi('settings.get')
  console.log('theme field:', settingsAfter?.theme)
  console.log('appearance.theme:', settingsAfter?.appearance?.theme)
  console.log('general.theme:', settingsAfter?.general?.theme)
  console.log('Top-level keys:', Object.keys(settingsAfter || {}))

  // 恢复
  await c.callApi('settings.set', 'theme', 'dark')

  // 3. privacy.status 完整结构
  console.log('\n[3] privacy.status 完整结构:')
  const status = await c.callApi('privacy.status')
  console.log(JSON.stringify(status, null, 2))

  // 4. privacy.init + enable + anonymize 完整返回
  console.log('\n[4] privacy 完整流程返回:')
  const initRes = await c.callApi('privacy.init', 'ProbePass123', false)
  console.log('init:', JSON.stringify(initRes, null, 2))

  const enableRes = await c.callApi('privacy.enable')
  console.log('enable:', JSON.stringify(enableRes, null, 2))

  const addRes = await c.callApi('privacy.add', 'person', '张三')
  console.log('add:', JSON.stringify(addRes, null, 2))

  const anonRes = await c.callApi('privacy.anonymize', '张三今天迟到了')
  console.log('anonymize:', JSON.stringify(anonRes, null, 2))

  const listRes = await c.callApi('privacy.list')
  console.log('list:', JSON.stringify(listRes, null, 2).slice(0, 800))

  // 5. 检查 dashboard 页面的 aria 属性
  console.log('\n[5] dashboard 页面 aria 属性检查:')
  await c.eval(`window.location.hash = '#/dashboard'`)
  await sleep(800)
  const ariaInfo = await c.eval(`JSON.stringify({
    ariaLabel: document.querySelectorAll('[aria-label]').length,
    ariaLabelledby: document.querySelectorAll('[aria-labelledby]').length,
    role: document.querySelectorAll('[role]').length,
    allAria: document.querySelectorAll('[aria-*]').length,
    sampleRoles: Array.from(document.querySelectorAll('[role]')).slice(0, 5).map(el => ({ role: el.getAttribute('role'), tag: el.tagName })),
    sampleAriaLabels: Array.from(document.querySelectorAll('[aria-label]')).slice(0, 5).map(el => ({ label: el.getAttribute('aria-label'), tag: el.tagName }))
  })`)
  console.log(JSON.stringify(JSON.parse(ariaInfo), null, 2))

  // 6. Students 页面 — 添加学生后等待更长时间再检查
  console.log('\n[6] Students 页面添加后可见性:')
  const testStu = `ProbeStu_${Date.now().toString().slice(-6)}`
  await c.callApi('eaa.addStudent', testStu)
  console.log(`Added: ${testStu}`)
  
  // 等待 2 秒后导航
  await sleep(2000)
  await c.eval(`window.location.hash = '#/students'`)
  await sleep(1500)
  
  const pageText = await c.eval(`document.body?.innerText || ''`)
  console.log(`In page text: ${pageText.includes(testStu)}`)
  console.log(`Page text length: ${pageText.length}`)
  console.log(`First 500 chars: ${pageText.slice(0, 500)}`)
  
  // 检查是否有表格行
  const tableInfo = await c.eval(`JSON.stringify({
    rows: document.querySelectorAll('tr').length,
    tableText: document.querySelector('table')?.innerText?.slice(0, 300) || 'no table',
    listItems: document.querySelectorAll('li').length
  })`)
  console.log('Table info:', tableInfo)
  
  // 清理
  await c.callApi('eaa.deleteStudent', testStu, 'probe cleanup')
  
  // 恢复 privacy 状态
  await c.callApi('privacy.disable', 'ProbePass123')
  await c.callApi('privacy.lock')

  c.close()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
