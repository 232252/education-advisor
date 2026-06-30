// 探查 R17 主题和语言切换机制
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
  console.log('=== R17 主题和语言切换探查 ===\n')

  // 1. 检查主题切换机制
  console.log('[1] 主题切换机制:')
  await c.eval(`window.location.hash = '#/dashboard'`)
  await sleep(800)

  // 当前主题
  const settingsBefore = await c.callApi('settings.get')
  console.log(`Current theme: ${settingsBefore?.general?.theme}`)

  const themeInfo1 = await c.eval(`JSON.stringify({
    htmlClass: document.documentElement?.className || '',
    bodyClass: document.body?.className || '',
    htmlDataAttrs: Object.keys(document.documentElement?.dataset || {}),
    bodyDataAttrs: Object.keys(document.body?.dataset || {}),
    bodyBgColor: window.getComputedStyle(document.body)?.backgroundColor,
    bodyColor: window.getComputedStyle(document.body)?.color,
    htmlAttrs: Array.from(document.documentElement.attributes).map(a => ({ name: a.name, value: a.value.slice(0, 50) })),
    cssVars: (() => {
      const style = window.getComputedStyle(document.documentElement)
      return {
        bg: style.getPropertyValue('--background') || style.getPropertyValue('--bg') || 'none',
        fg: style.getPropertyValue('--foreground') || style.getPropertyValue('--fg') || 'none'
      }
    })()
  })`)
  console.log(`Theme info: ${themeInfo1}`)

  // 切换到 light
  await c.callApi('settings.set', 'general.theme', 'light')
  await sleep(1000)
  await c.eval(`window.location.hash = '#/dashboard'`)
  await sleep(1000)

  const themeInfo2 = await c.eval(`JSON.stringify({
    htmlClass: document.documentElement?.className || '',
    bodyClass: document.body?.className || '',
    bodyBgColor: window.getComputedStyle(document.body)?.backgroundColor,
    htmlDataTheme: document.documentElement?.getAttribute('data-theme') || document.documentElement?.dataset?.theme || 'none'
  })`)
  console.log(`After light: ${themeInfo2}`)

  // 切换到 dark
  await c.callApi('settings.set', 'general.theme', 'dark')
  await sleep(1000)
  await c.eval(`window.location.hash = '#/dashboard'`)
  await sleep(1000)

  const themeInfo3 = await c.eval(`JSON.stringify({
    htmlClass: document.documentElement?.className || '',
    bodyClass: document.body?.className || '',
    bodyBgColor: window.getComputedStyle(document.body)?.backgroundColor,
    htmlDataTheme: document.documentElement?.getAttribute('data-theme') || document.documentElement?.dataset?.theme || 'none'
  })`)
  console.log(`After dark: ${themeInfo3}`)

  // 2. 检查语言切换机制
  console.log('\n[2] 语言切换机制:')

  // 当前语言
  console.log(`Current language: ${settingsBefore?.general?.language}`)

  // 切换到 zh-CN
  await c.callApi('settings.set', 'general.language', 'zh-CN')
  await sleep(1000)
  await c.eval(`window.location.hash = '#/dashboard'`)
  await sleep(1500)

  const zhText = await c.eval(`document.body?.innerText?.slice(0, 300) || ''`)
  console.log(`ZH text (first 300): ${zhText}`)

  // 切换到 en-US
  await c.callApi('settings.set', 'general.language', 'en-US')
  await sleep(1000)
  await c.eval(`window.location.hash = '#/dashboard'`)
  await sleep(1500)

  const enText = await c.eval(`document.body?.innerText?.slice(0, 300) || ''`)
  console.log(`EN text (first 300): ${enText}`)

  console.log(`\nText different: ${zhText !== enText}`)
  console.log(`ZH length: ${zhText.length}, EN length: ${enText.length}`)

  // 恢复
  await c.callApi('settings.set', 'general.language', settingsBefore?.general?.language || 'zh-CN')

  c.close()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
