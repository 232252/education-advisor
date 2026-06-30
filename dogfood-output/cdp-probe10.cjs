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

  // 1. 检查当前 settings
  const settings = await c.callApi('settings.get')
  console.log('1. Current language setting:', settings?.general?.language)

  // 2. 导航到 settings 页面
  await c.eval(`window.location.hash = '#/settings'`)
  await sleep(1000)

  // 3. 列出所有 select 及其选项
  const selectsInfo = await c.eval(`JSON.stringify({
    selects: Array.from(document.querySelectorAll('select')).map((s, i) => ({
      index: i,
      id: s.id || '(no id)',
      value: s.value,
      options: Array.from(s.options).map(o => ({ value: o.value, text: o.textContent?.trim().slice(0, 20) }))
    }))
  })`)
  const selects = JSON.parse(selectsInfo)
  console.log('\n2. All selects on settings page:')
  selects.selects.forEach(s => {
    console.log(`  [${s.index}] id=${s.id}, value=${s.value}, options=${JSON.stringify(s.options.map(o => o.value))}`)
  })

  // 4. 找到 language select 并尝试切换
  const switchResult = await c.eval(`(async () => {
    const selects = Array.from(document.querySelectorAll('select'))
    const langSelect = selects.find(s => {
      const opts = Array.from(s.options).map(o => o.value)
      return opts.includes('zh-CN') || opts.includes('zh') || opts.includes('en-US') || opts.includes('en')
    })
    if (!langSelect) return { error: 'language select not found', totalSelects: selects.length }
    
    // 检查 React props
    const reactKey = Object.keys(langSelect).find(k => k.startsWith('__reactProps'))
    const props = reactKey ? langSelect[reactKey] : null
    const hasOnChange = props && typeof props.onChange === 'function'
    
    return {
      found: true,
      currentValue: langSelect.value,
      options: Array.from(langSelect.options).map(o => o.value),
      hasReactProps: !!props,
      hasOnChange: hasOnChange,
      reactPropsKeys: props ? Object.keys(props).slice(0, 10) : []
    }
  })()`)
  console.log('\n3. Language select info:', JSON.stringify(switchResult, null, 2))

  // 5. 尝试 native setter + change 事件
  const trySwitch = await c.eval(`(async () => {
    const selects = Array.from(document.querySelectorAll('select'))
    const langSelect = selects.find(s => {
      const opts = Array.from(s.options).map(o => o.value)
      return opts.includes('en-US') || opts.includes('en')
    })
    if (!langSelect) return { error: 'not found' }
    
    const before = langSelect.value
    const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    ns.call(langSelect, 'en-US')
    langSelect.dispatchEvent(new Event('change', { bubbles: true }))
    
    // 等待 React 处理
    await new Promise(r => setTimeout(r, 500))
    
    const after = langSelect.value
    return { before, after, changed: before !== after }
  })()`)
  console.log('\n4. Switch attempt:', JSON.stringify(trySwitch, null, 2))

  // 6. 检查 localStorage 和 currentLang
  const afterSwitch = await c.eval(`JSON.stringify({
    localStorageLang: window.localStorage.getItem('education-advisor.lang'),
    bodyText100: document.body?.innerText?.slice(0, 100) || ''
  })`)
  console.log('\n5. After switch:', afterSwitch)

  // 7. 导航到 dashboard 检查文本
  await c.eval(`window.location.hash = '#/dashboard'`)
  await sleep(1000)
  const dashText = await c.eval(`document.body?.innerText?.slice(0, 200) || ''`)
  console.log('\n6. Dashboard text (first 200):', dashText)

  // 8. 恢复中文
  await c.eval(`window.location.hash = '#/settings'`)
  await sleep(500)
  await c.eval(`(async () => {
    const selects = Array.from(document.querySelectorAll('select'))
    const langSelect = selects.find(s => {
      const opts = Array.from(s.options).map(o => o.value)
      return opts.includes('zh-CN') || opts.includes('zh')
    })
    if (!langSelect) return
    const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    ns.call(langSelect, 'zh-CN')
    langSelect.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(500)

  c.close()
}
main().catch(e => { console.error(e); process.exit(1) })
