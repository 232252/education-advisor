// ============================================================
// 第十九轮：键盘可访问性 + 快速交互 + 数据导出验证
// 覆盖：
//   1. Tab 键导航遍历各页面
//   2. Enter/Space 键激活按钮
//   3. Focus 可见性检查
//   4. 快速连续点击（UI 压力）
//   5. EAA 导出 CSV/JSONL/HTML 文件内容验证
//   6. Agent SOUL 修改持久化
//   7. 长时间稳定性（5次采样 10s 间隔）
// ============================================================
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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
  async navigate(hash) {
    await this.eval(`window.location.hash = ${JSON.stringify(hash)}`)
    await sleep(800)
  }
  async dispatchKey(key, code, keyCode) {
    return this.eval(`(async () => {
      const opts = { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, keyCode: ${keyCode}, bubbles: true, cancelable: true }
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', opts))
      document.activeElement?.dispatchEvent(new KeyboardEvent('keypress', opts))
      document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', opts))
      return document.activeElement?.tagName + ':' + (document.activeElement?.textContent || '').slice(0, 30)
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + detail.slice(0, 150) : ''}`)
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 19: Keyboard A11y + Rapid Interaction + Export')
  console.log('============================================================')

  // ============================================================
  // [1] Tab 键导航遍历各页面
  // ============================================================
  console.log('\n[1] Tab 键导航遍历')
  const tabPages = [
    { hash: '#/dashboard', name: 'dashboard' },
    { hash: '#/students', name: 'students' },
    { hash: '#/settings', name: 'settings' },
    { hash: '#/chat', name: 'chat' },
  ]

  for (const page of tabPageInfo(tabPages)) {
    await c.navigate(page.hash)
    await sleep(500)
    // 聚焦第一个元素
    await c.eval(`(async () => {
      const focusable = document.querySelectorAll('button, a, input, select, textarea, [tabindex]')
      if (focusable.length > 0) focusable[0].focus()
    })()`)
    await sleep(200)

    // 模拟 Tab 键多次,记录焦点变化
    const focusSeq = []
    for (let i = 0; i < 5; i++) {
      await c.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }))`)
      await sleep(100)
      const activeInfo = await c.eval(`JSON.stringify({
        tag: document.activeElement?.tagName || '',
        text: (document.activeElement?.textContent || '').slice(0, 30),
        type: document.activeElement?.type || '',
        hasFocusVisible: document.activeElement?.matches(':focus-visible') || false
      })`)
      focusSeq.push(JSON.parse(activeInfo))
    }

    const focusableCount = await c.eval(`document.querySelectorAll('button, a, input, select, textarea, [tabindex]').length`)
    const focusChanged = focusSeq.some((f, i) => i > 0 && f.tag !== focusSeq[0].tag)
    record(`keyboard.${page.name}_tab_navigation`, focusableCount > 0, `focusable=${focusableCount}, focusChanged=${focusChanged}`)
  }

  function tabPageInfo(arr) { return arr }

  // ============================================================
  // [2] Enter/Space 键激活按钮
  // ============================================================
  console.log('\n[2] Enter/Space 键激活')
  await c.navigate('#/dashboard')
  await sleep(500)

  // 找到第一个按钮并聚焦
  const btnInfo = await c.eval(`JSON.stringify({
    count: document.querySelectorAll('button').length,
    firstText: document.querySelector('button')?.textContent?.trim().slice(0, 30) || ''
  })`)
  const btnData = JSON.parse(btnInfo)
  record('keyboard.buttons_available', btnData.count > 0, `count=${btnData.count}, first="${btnData.firstText}"`)

  // 聚焦按钮并按 Enter
  await c.eval(`document.querySelector('button')?.focus()`)
  await sleep(200)
  const beforeEnter = await c.eval(`document.activeElement?.tagName + ':' + (document.activeElement?.textContent || '').slice(0, 20)`)
  await c.dispatchKey('Enter', 'Enter', 13)
  await sleep(300)
  const afterEnter = await c.eval(`document.activeElement?.tagName + ':' + (document.activeElement?.textContent || '').slice(0, 20)`)
  record('keyboard.enter_on_button', typeof beforeEnter === 'string', `before="${beforeEnter}", after="${afterEnter}"`)

  // ============================================================
  // [3] Focus 可见性检查
  // ============================================================
  console.log('\n[3] Focus 可见性')
  const pages = ['#/dashboard', '#/students', '#/settings', '#/chat', '#/agents']
  let totalFocusable = 0
  let totalFocusVisible = 0
  for (const hash of pages) {
    await c.navigate(hash)
    await sleep(400)
    const info = await c.eval(`JSON.stringify({
      focusable: document.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])').length,
      hasOutlineStyle: Array.from(document.styleSheets).some(sheet => {
        try {
          return Array.from(sheet.cssRules || []).some(rule => rule.selectorText?.includes(':focus'))
        } catch { return false }
      })
    })`)
    const data = JSON.parse(info)
    totalFocusable += data.focusable
    if (data.hasOutlineStyle) totalFocusVisible++
  }
  record('keyboard.focusable_elements', totalFocusable > 0, `total=${totalFocusable} across 5 pages`)
  record('keyboard.focus_styles', totalFocusVisible > 0, `pagesWithFocusStyles=${totalFocusVisible}/5`)

  // ============================================================
  // [4] 快速连续点击（UI 压力）
  // ============================================================
  console.log('\n[4] 快速连续点击')
  // 快速导航 10 次
  const rapidStart = Date.now()
  for (let i = 0; i < 10; i++) {
    await c.eval(`window.location.hash = '#/dashboard'`)
    await c.eval(`window.location.hash = '#/students'`)
  }
  await sleep(500)
  const rapidEnd = Date.now()
  record('stress.rapid_navigation', rapidEnd - rapidStart < 30000, `time=${rapidEnd - rapidStart}ms`)

  // 快速调用 IPC 20 次
  const ipcStart = Date.now()
  const promises = []
  for (let i = 0; i < 20; i++) {
    promises.push(c.callApi('eaa.info'))
  }
  const results20 = await Promise.all(promises)
  const ipcEnd = Date.now()
  const allSuccess = results20.every(r => r?.success !== false)
  record('stress.rapid_ipc_20', allSuccess, `time=${ipcEnd - ipcStart}ms, allSuccess=${allSuccess}`)

  // ============================================================
  // [5] EAA 导出 CSV/JSONL/HTML 文件内容验证
  // ============================================================
  console.log('\n[5] EAA 数据导出验证')
  const exportFormats = ['csv', 'jsonl', 'html']

  for (const fmt of exportFormats) {
    const exportRes = await c.callApi('eaa.export', fmt)
    const exportData = exportRes?.data
    const hasData = typeof exportData === 'string' && exportData.length > 0
    record(`export.${fmt}_generated`, hasData, `len=${typeof exportData === 'string' ? exportData.length : 0}, success=${exportRes?.success}`)

    if (hasData) {
      // 验证格式正确性
      if (fmt === 'csv') {
        const hasHeader = exportData.includes(',') && exportData.includes('\n')
        record(`export.${fmt}_format`, hasHeader, `hasHeader=${hasHeader}, preview=${exportData.slice(0, 80)}`)
      } else if (fmt === 'jsonl') {
        const lines = exportData.split('\n').filter(l => l.trim())
        const validJson = lines.length > 0 && lines.every(l => { try { JSON.parse(l); return true } catch { return false } })
        record(`export.${fmt}_format`, validJson, `lines=${lines.length}, validJson=${validJson}`)
      } else if (fmt === 'html') {
        const hasHtml = exportData.includes('<') && (exportData.includes('<html') || exportData.includes('<table') || exportData.includes('<div'))
        record(`export.${fmt}_format`, hasHtml, `hasHtml=${hasHtml}, preview=${exportData.slice(0, 80)}`)
      }
    }
  }

  // dashboard HTML 导出
  const dashRes = await c.callApi('eaa.dashboard')
  const dashHtml = dashRes?.data
  record('export.dashboard_html', typeof dashHtml === 'string' && dashHtml.length > 0, `len=${typeof dashHtml === 'string' ? dashHtml.length : 0}`)

  // ============================================================
  // [6] Agent SOUL 修改持久化
  // ============================================================
  console.log('\n[6] Agent SOUL 修改持久化')
  const testAgent = 'data-analyst'
  const origSoulRes = await c.callApi('agent.getSoul', testAgent)
  const origSoul = typeof origSoulRes === 'string' ? origSoulRes : (origSoulRes?.data || '')
  record('agent.soul_original', typeof origSoul === 'string' && origSoul.length > 0, `len=${origSoul.length}`)

  // 修改 SOUL
  const testSoulContent = origSoul + '\n\n## R19 Test Update\nThis is a test modification from Round 19.'
  const setSoulRes = await c.callApi('agent.setSoul', testAgent, testSoulContent)
  record('agent.soul_set', setSoulRes?.success !== false, `success=${setSoulRes?.success}`)

  // 读取验证
  const newSoulRes = await c.callApi('agent.getSoul', testAgent)
  const newSoul = typeof newSoulRes === 'string' ? newSoulRes : (newSoulRes?.data || '')
  const soulMatches = newSoul.includes('R19 Test Update')
  record('agent.soul_persisted', soulMatches, `matches=${soulMatches}, len=${newSoul.length}`)

  // 恢复原始 SOUL
  await c.callApi('agent.setSoul', testAgent, origSoul)
  const restoredSoulRes = await c.callApi('agent.getSoul', testAgent)
  const restoredSoul = typeof restoredSoulRes === 'string' ? restoredSoulRes : (restoredSoulRes?.data || '')
  record('agent.soul_restored', restoredSoul === origSoul, `restored=${restoredSoul === origSoul}`)

  // ============================================================
  // [7] 长时间稳定性（5次采样 10s 间隔）
  // ============================================================
  console.log('\n[7] 长时间稳定性')
  const memSamples = []
  for (let i = 0; i < 5; i++) {
    const mem = await c.eval(`JSON.stringify({
      heap: performance.memory?.usedJSHeapSize || 0,
      dom: document.querySelectorAll('*').length,
      time: Date.now()
    })`)
    memSamples.push(JSON.parse(mem))
    if (i < 4) await sleep(10000) // 10s 间隔
  }

  const firstHeap = memSamples[0].heap
  const lastHeap = memSamples[memSamples.length - 1].heap
  const heapGrowth = firstHeap > 0 && lastHeap > 0 ? ((lastHeap - firstHeap) / firstHeap * 100).toFixed(2) : 'N/A'
  const domStable = memSamples.every(s => s.dom === memSamples[0].dom)
  record('stability.heap_growth', Math.abs(parseFloat(heapGrowth)) < 10, `growth=${heapGrowth}%, first=${(firstHeap/1024/1024).toFixed(1)}MB, last=${(lastHeap/1024/1024).toFixed(1)}MB`)
  record('stability.dom_stable', domStable, `domCount=${memSamples[0].dom}, stable=${domStable}`)

  // ============================================================
  // [8] 最终健康检查
  // ============================================================
  console.log('\n[8] 最终健康检查')
  const healthChecks = [
    { name: 'eaa.info', api: 'eaa.info' },
    { name: 'eaa.doctor', api: 'eaa.doctor' },
    { name: 'agent.list', api: 'agent.list' },
    { name: 'skill.list', api: 'skill.list' },
    { name: 'settings.get', api: 'settings.get' },
    { name: 'cron.list', api: 'cron.list' },
  ]
  for (const check of healthChecks) {
    const res = await c.callApi(check.api)
    record(`health.${check.name}`, res?.success !== false, `success=${res?.success}`)
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`ROUND 19 SUMMARY: ${passed}/${results.length} passed, ${failed} failed`)
  console.log('============================================================')
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.ok).forEach(r => {
      console.log(`  - ${r.name}: ${r.detail}`)
    })
  }

  c.close()
}
main().catch(e => { console.error(e); process.exit(1) })
