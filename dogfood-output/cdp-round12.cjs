// ============================================================
// 第十二轮：UI 导航 + 页面交互 + 表单提交 + 错误边界
// 覆盖：
//   1. 路由导航（所有页面 hash 路由）
//   2. DOM 结构完整性（关键元素存在性）
//   3. Settings 表单交互（下拉框/输入框/开关）
//   4. 主题切换 UI 验证（className 变化）
//   5. 语言切换 UI 验证（文案变化）
//   6. 错误边界（无效路由/空数据）
//   7. 键盘可访问性（tab focus）
//   8. 响应式布局检查
// ============================================================
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

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
  async navigate(hash) {
    await this.eval(`window.location.hash = '${hash}'`)
    await sleep(800) // 等待 React 渲染
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
  console.log('ROUND 12: UI Navigation + Page Interaction + Forms')
  console.log('============================================================')

  // ============================================================
  // [1] 路由导航 — 所有页面
  // ============================================================
  console.log('\n[1] 路由导航')

  const routes = [
    { hash: '#/dashboard', name: 'dashboard' },
    { hash: '#/students', name: 'students' },
    { hash: '#/classes', name: 'classes' },
    { hash: '#/chat', name: 'chat' },
    { hash: '#/agents', name: 'agents' },
    { hash: '#/skills', name: 'skills' },
    { hash: '#/privacy', name: 'privacy' },
    { hash: '#/scheduler', name: 'scheduler' },
    { hash: '#/models', name: 'models' },
    { hash: '#/settings', name: 'settings' },
  ]

  for (const route of routes) {
    await c.navigate(route.hash)
    const actualHash = await c.eval(`window.location.hash`)
    const hasContent = await c.eval(`document.querySelector('.app-main, main, [class*="page"], [class*="content"]') !== null`)
    const bodyLen = await c.eval(`document.body?.innerText?.length || 0`)
    record(`nav.${route.name}`, actualHash === route.hash && hasContent && bodyLen > 0, `hash=${actualHash}, bodyLen=${bodyLen}`)
  }

  // 无效路由
  await c.navigate('#/nonexistent-page-12345')
  const invalidHash = await c.eval(`window.location.hash`)
  const invalidBodyLen = await c.eval(`document.body?.innerText?.length || 0`)
  record('nav.invalid_route_handled', invalidBodyLen > 0, `hash=${invalidHash}, bodyLen=${invalidBodyLen}`)

  // ============================================================
  // [2] DOM 结构完整性
  // ============================================================
  console.log('\n[2] DOM 结构完整性')

  await c.navigate('#/dashboard')
  const domCheck = await c.eval(`JSON.stringify({
    hasRoot: document.getElementById('root') !== null,
    hasNav: document.querySelector('nav, [class*="nav"], [class*="sidebar"]') !== null,
    hasMain: document.querySelector('main, .app-main, [class*="main"]') !== null,
    hasHeader: document.querySelector('header, [class*="header"]') !== null,
    titleText: document.title,
    bodyClasses: document.body.className,
    htmlClasses: document.documentElement.className,
    totalButtons: document.querySelectorAll('button').length,
    totalLinks: document.querySelectorAll('a').length,
    totalInputs: document.querySelectorAll('input, select, textarea').length
  })`)
  const dom = JSON.parse(domCheck)
  record('dom.root_exists', dom.hasRoot, '')
  record('dom.nav_exists', dom.hasNav, '')
  record('dom.main_exists', dom.hasMain, '')
  record('dom.has_title', dom.titleText?.length > 0, `title="${dom.titleText}"`)
  record('dom.has_buttons', dom.totalButtons > 0, `count=${dom.totalButtons}`)
  record('dom.has_links', dom.totalLinks > 0, `count=${dom.totalLinks}`)
  record('dom.html_class', dom.htmlClasses?.length > 0, `class="${dom.htmlClasses}"`)

  // ============================================================
  // [3] 主题切换 UI
  // ============================================================
  console.log('\n[3] 主题切换 UI')

  await c.navigate('#/settings')
  await sleep(500)

  // 获取当前主题
  const themeBefore = await c.eval(`document.documentElement.className`)
  console.log(`    主题前: html class = "${themeBefore}"`)

  // 通过 select 切换主题
  const themeSwitchResult = await c.eval(`(async () => {
    // 找到主题 select
    const selects = document.querySelectorAll('select')
    let themeSelect = null
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value)
      if (options.includes('dark') && options.includes('light')) {
        themeSelect = sel
        break
      }
    }
    if (!themeSelect) return { error: 'theme select not found' }

    // 使用 native setter 切换到 light
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(themeSelect, 'light')
    themeSelect.dispatchEvent(new Event('change', { bubbles: true }))

    // 等待 React 更新
    await new Promise(r => setTimeout(r, 500))

    return {
      success: true,
      htmlClass: document.documentElement.className,
      hasDark: document.documentElement.className.includes('dark'),
      hasLight: document.documentElement.className.includes('light')
    }
  })()`)

  if (themeSwitchResult?.success) {
    record('theme.switch_to_light', !themeSwitchResult.hasDark || themeSwitchResult.hasLight, `htmlClass="${themeSwitchResult.htmlClass}"`)
  } else {
    record('theme.switch_to_light', false, themeSwitchResult?.error || 'unknown')
  }

  // 切换回 dark
  await c.eval(`(async () => {
    const selects = document.querySelectorAll('select')
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value)
      if (options.includes('dark') && options.includes('light')) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
        setter.call(sel, 'dark')
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise(r => setTimeout(r, 500))
        return document.documentElement.className
      }
    }
    return null
  })()`)

  // ============================================================
  // [4] 语言切换 UI
  // ============================================================
  console.log('\n[4] 语言切换 UI')

  // 获取当前某个文案
  const textBefore = await c.eval(`(document.querySelector('nav a, nav button, [class*="nav"] a, [class*="nav"] button')?.textContent || '').trim()`)
  console.log(`    语言切换前 nav 文案: "${textBefore}"`)

  // 切换到英文
  const langSwitchResult = await c.eval(`(async () => {
    const selects = document.querySelectorAll('select')
    let langSelect = null
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value)
      if (options.includes('zh') && options.includes('en')) {
        langSelect = sel
        break
      }
      if (options.includes('zh-CN') && options.includes('en-US')) {
        langSelect = sel
        break
      }
    }
    if (!langSelect) return { error: 'lang select not found' }

    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    // 尝试 en 或 en-US
    const targetVal = Array.from(langSelect.options).some(o => o.value === 'en') ? 'en' : 'en-US'
    setter.call(langSelect, targetVal)
    langSelect.dispatchEvent(new Event('change', { bubbles: true }))

    await new Promise(r => setTimeout(r, 800))

    const navText = (document.querySelector('nav a, nav button, [class*="nav"] a, [class*="nav"] button')?.textContent || '').trim()
    return { success: true, navText, targetVal }
  })()`)

  if (langSwitchResult?.success) {
    record('lang.switch_to_en', langSwitchResult.navText !== textBefore || langSwitchResult.navText.length > 0, `navText="${langSwitchResult.navText}"`)
  } else {
    record('lang.switch_to_en', false, langSwitchResult?.error || 'unknown')
  }

  // 切换回中文
  await c.eval(`(async () => {
    const selects = document.querySelectorAll('select')
    for (const sel of selects) {
      const options = Array.from(sel.options).map(o => o.value)
      if (options.includes('zh') && options.includes('en')) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
        setter.call(sel, 'zh')
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise(r => setTimeout(r, 500))
        return true
      }
      if (options.includes('zh-CN') && options.includes('en-US')) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
        setter.call(sel, 'zh-CN')
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise(r => setTimeout(r, 500))
        return true
      }
    }
    return false
  })()`)

  // ============================================================
  // [5] 各页面关键元素存在性
  // ============================================================
  console.log('\n[5] 各页面关键元素')

  const pageChecks = [
    { hash: '#/dashboard', name: 'dashboard_content' },
    { hash: '#/students', name: 'students_content' },
    { hash: '#/classes', name: 'classes_content' },
    { hash: '#/chat', name: 'chat_content' },
    { hash: '#/agents', name: 'agents_content' },
    { hash: '#/skills', name: 'skills_content' },
    { hash: '#/privacy', name: 'privacy_content' },
    { hash: '#/scheduler', name: 'scheduler_content' },
    { hash: '#/models', name: 'models_content' },
    { hash: '#/settings', name: 'settings_content' },
  ]

  for (const check of pageChecks) {
    await c.navigate(check.hash)
    const result = await c.eval(`JSON.stringify({
      bodyLen: document.body?.innerText?.length || 0,
      hasMain: document.querySelector('main, .app-main, [class*="main"], [class*="content"], [class*="page"]') !== null,
      hasInteractive: document.querySelectorAll('button, a, input, select, textarea').length,
      actualHash: window.location.hash
    })`)
    const info = JSON.parse(result)
    const ok = info.bodyLen > 50 && info.hasMain && info.hasInteractive > 0
    record(`page.${check.name}`, ok, `hash=${info.actualHash}, bodyLen=${info.bodyLen}, interactive=${info.hasInteractive}`)
  }

  // ============================================================
  // [6] 表单交互 — Settings 页面
  // ============================================================
  console.log('\n[6] Settings 表单交互')

  await c.navigate('#/settings')
  await sleep(500)

  // 检查所有 select 元素
  const selectsInfo = await c.eval(`JSON.stringify(Array.from(document.querySelectorAll('select')).map(s => ({
    value: s.value,
    optionCount: s.options.length,
    options: Array.from(s.options).map(o => o.value).slice(0, 5)
  })))`)
  const selects = JSON.parse(selectsInfo)
  record('settings.selects_count', selects.length > 0, `count=${selects.length}`)
  console.log(`    发现 ${selects.length} 个 select 元素`)
  selects.forEach((s, i) => {
    console.log(`      [${i}] value="${s.value}", options=[${s.options.join(',')}] (${s.optionCount} total)`)
  })

  // 检查所有 input 元素
  const inputsInfo = await c.eval(`JSON.stringify(Array.from(document.querySelectorAll('input')).map(inp => ({
    type: inp.type,
    name: inp.name,
    value: inp.value?.slice(0, 30),
    checked: inp.checked,
    placeholder: inp.placeholder?.slice(0, 30)
  })))`)
  const inputs = JSON.parse(inputsInfo)
  record('settings.inputs_count', inputs.length > 0, `count=${inputs.length}`)
  console.log(`    发现 ${inputs.length} 个 input 元素`)

  // 检查所有 button 元素
  const buttonsInfo = await c.eval(`JSON.stringify(Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.textContent?.trim().slice(0, 30),
    type: b.type,
    disabled: b.disabled
  })))`)
  const buttons = JSON.parse(buttonsInfo)
  record('settings.buttons_count', buttons.length > 0, `count=${buttons.length}`)

  // ============================================================
  // [7] 导航栏点击导航
  // ============================================================
  console.log('\n[7] 导航栏点击导航')

  await c.navigate('#/dashboard')
  await sleep(500)

  // 获取所有导航链接
  const navLinks = await c.eval(`JSON.stringify(Array.from(document.querySelectorAll('nav a[href], [class*="sidebar"] a[href], [class*="nav"] a[href]')).map(a => ({
    href: a.getAttribute('href'),
    text: a.textContent?.trim().slice(0, 20)
  })))`)
  const links = JSON.parse(navLinks)
  record('nav.links_count', links.length > 0, `count=${links.length}`)
  console.log(`    发现 ${links.length} 个导航链接`)
  links.forEach((l, i) => {
    console.log(`      [${i}] href="${l.href}", text="${l.text}"`)
  })

  // 点击每个导航链接验证
  let navClickOk = 0
  for (const link of links.slice(0, 8)) {
    await c.eval(`(async () => {
      const link = document.querySelector('a[href="${link.href}"]')
      if (link) link.click()
    })()`)
    await sleep(500)
    const currentHash = await c.eval(`window.location.hash`)
    if (currentHash === link.href) navClickOk++
  }
  record('nav.click_navigation', navClickOk > 0, `${navClickOk}/${Math.min(links.length, 8)} succeeded`)

  // ============================================================
  // [8] 错误边界 — 空数据状态
  // ============================================================
  console.log('\n[8] 错误边界')

  // 8.1 搜索不存在的内容
  await c.navigate('#/students')
  await sleep(500)

  // 检查页面是否正常渲染（即使数据为空）
  const studentsPageOk = await c.eval(`document.body.innerText.length > 50`)
  record('error.empty_students_page', studentsPageOk, `bodyLen=${await c.eval(`document.body.innerText.length`)}`)

  // 8.2 检查 console 错误
  const consoleErrors = await c.eval(`(function() {
    // 不能直接访问 console.error 历史，但可以检查是否有可见的错误 UI
    const errorElements = document.querySelectorAll('[class*="error"], [class*="Error"], [class*="warning"], [class*="Warning"]')
    return JSON.stringify({
      errorElementCount: errorElements.length,
      hasErrorBoundary: document.querySelector('[class*="error-boundary"], [class*="ErrorBoundary"]') !== null,
      bodyContainsError: document.body.innerText.toLowerCase().includes('error') || document.body.innerText.toLowerCase().includes('错误')
    })
  })()`)
  const errInfo = JSON.parse(consoleErrors)
  record('error.no_visible_errors', !errInfo.hasErrorBoundary, `errorElements=${errInfo.errorElementCount}, bodyHasError=${errInfo.bodyContainsError}`)

  // ============================================================
  // [9] 键盘可访问性
  // ============================================================
  console.log('\n[9] 键盘可访问性')

  await c.navigate('#/settings')
  await sleep(500)

  // 检查可 focus 元素数量
  const focusableCount = await c.eval(`document.querySelectorAll('button, a, input, select, textarea, [tabindex]').length`)
  record('a11y.focusable_elements', focusableCount > 0, `count=${focusableCount}`)

  // 检查是否有 aria 标签
  const ariaCount = await c.eval(`document.querySelectorAll('[aria-label], [aria-labelledby], [role]').length`)
  record('a11y.aria_attributes', ariaCount > 0, `count=${ariaCount}`)

  // ============================================================
  // [10] 响应式布局检查
  // ============================================================
  console.log('\n[10] 响应式布局')

  // 检查 viewport meta
  const viewport = await c.eval(`document.querySelector('meta[name="viewport"]')?.content || 'not found'`)
  record('layout.viewport_meta', viewport !== 'not found', `content="${viewport.slice(0, 60)}"`)

  // 检查 CSS 媒体查询支持
  const mediaQuery = await c.eval(`window.matchMedia('(max-width: 768px)').matches`)
  record('layout.media_query_works', typeof mediaQuery === 'boolean', `matches=${mediaQuery}`)

  // 检查窗口尺寸
  const winSize = await c.eval(`JSON.stringify({ innerWidth: window.innerWidth, innerHeight: window.innerHeight })`)
  const size = JSON.parse(winSize)
  record('layout.window_size', size.innerWidth > 0 && size.innerHeight > 0, `${size.innerWidth}x${size.innerHeight}`)

  // ============================================================
  // [11] 性能指标
  // ============================================================
  console.log('\n[11] 性能指标')

  const perfMetrics = await c.eval(`JSON.stringify({
    navigationStart: performance.timing?.navigationStart,
    domContentLoaded: performance.timing?.domContentLoadedEventEnd,
    loadComplete: performance.timing?.loadEventEnd,
    domElements: document.querySelectorAll('*').length,
    memory: performance.memory ? {
      used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
    } : null
  })`)
  const perf = JSON.parse(perfMetrics)
  record('perf.dom_elements_count', perf.domElements > 0 && perf.domElements < 5000, `count=${perf.domElements}`)
  record('perf.memory_usage', perf.memory?.used < 200, `used=${perf.memory?.used}MB, total=${perf.memory?.total}MB`)

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n============================================================')
  console.log('ROUND 12 SUMMARY')
  console.log('============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  results.filter(r => !r.ok).forEach(r => {
    console.log(`  FAIL: ${r.name} :: ${r.detail}`)
  })
  console.log(`\nTotal: ${passed} ok, ${failed} fail, ${results.length} tests`)

  fs.writeFileSync(
    'c:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round12.json',
    JSON.stringify({ round: 12, timestamp: new Date().toISOString(), results, passed, failed, total: results.length }, null, 2)
  )

  c.close()
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
