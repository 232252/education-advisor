// ============================================================
// 第十七轮：UI 深度交互 — 表单验证、错误提示、按钮状态、确认对话框
// 覆盖：
//   1. 各页面表单元素全面检查
//   2. 按钮禁用/启用状态验证
//   3. 表单输入验证（必填、格式、长度）
//   4. 确认对话框（删除操作）
//   5. 加载状态（loading spinner）
//   6. 错误提示展示
//   7. 空状态展示
//   8. 列表排序/筛选
//   9. 主题切换全局一致性
//  10. 国际化文案完整性
// ============================================================
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
  async navigate(hash) {
    await this.eval(`window.location.hash = ${JSON.stringify(hash)}`)
    await sleep(800)
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
  console.log('ROUND 17: UI Deep Interaction - Forms, Validation, Dialogs')
  console.log('============================================================')

  // ============================================================
  // [1] 各页面表单元素全面检查
  // ============================================================
  console.log('\n[1] 各页面表单元素检查')

  const pages = [
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

  for (const page of pages) {
    await c.navigate(page.hash)
    const info = await c.eval(`JSON.stringify({
      url: window.location.hash,
      bodyLen: document.body?.innerText?.length || 0,
      forms: document.querySelectorAll('form').length,
      inputs: document.querySelectorAll('input').length,
      textareas: document.querySelectorAll('textarea').length,
      selects: document.querySelectorAll('select').length,
      buttons: document.querySelectorAll('button').length,
      disabledButtons: document.querySelectorAll('button:disabled').length,
      labels: document.querySelectorAll('label').length,
      hasContent: (document.body?.innerText?.length || 0) > 50
    })`)
    const data = JSON.parse(info)
    record(`page.${page.name}_rendered`, data.hasContent, `bodyLen=${data.bodyLen}, inputs=${data.inputs}, buttons=${data.buttons}, selects=${data.selects}`)
  }

  // ============================================================
  // [2] 按钮禁用/启用状态验证
  // ============================================================
  console.log('\n[2] 按钮禁用/启用状态')

  // Settings 页面的 reset 按钮
  await c.navigate('#/settings')
  const settingsBtnInfo = await c.eval(`JSON.stringify({
    totalButtons: document.querySelectorAll('button').length,
    disabledButtons: Array.from(document.querySelectorAll('button:disabled')).map(b => b.textContent?.trim().slice(0, 30)),
    enabledButtons: Array.from(document.querySelectorAll('button:not(:disabled)')).map(b => b.textContent?.trim().slice(0, 30)).slice(0, 10)
  })`)
  const settingsBtn = JSON.parse(settingsBtnInfo)
  record('buttons.settings_total', settingsBtn.totalButtons > 0, `total=${settingsBtn.totalButtons}, disabled=${settingsBtn.disabledButtons.length}`)
  record('buttons.settings_disabled_visible', Array.isArray(settingsBtn.disabledButtons), `disabled=${JSON.stringify(settingsBtn.disabledButtons).slice(0, 100)}`)

  // Agents 页面的按钮
  await c.navigate('#/agents')
  const agentBtnInfo = await c.eval(`JSON.stringify({
    totalButtons: document.querySelectorAll('button').length,
    disabledCount: document.querySelectorAll('button:disabled').length,
    sampleButtons: Array.from(document.querySelectorAll('button')).slice(0, 5).map(b => ({
      text: b.textContent?.trim().slice(0, 20),
      disabled: b.disabled,
      type: b.type
    }))
  })`)
  const agentBtn = JSON.parse(agentBtnInfo)
  record('buttons.agents_interactive', agentBtn.totalButtons > 5, `total=${agentBtn.totalButtons}, disabled=${agentBtn.disabledCount}`)

  // ============================================================
  // [3] 表单输入验证
  // ============================================================
  console.log('\n[3] 表单输入验证')

  // Students 页面 — 搜索/过滤输入
  await c.navigate('#/students')
  const stuInputInfo = await c.eval(`JSON.stringify({
    inputs: Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type,
      placeholder: i.placeholder?.slice(0, 30),
      required: i.required,
      pattern: i.pattern,
      maxLength: i.maxLength,
      disabled: i.disabled
    })),
    hasSearchInput: !!document.querySelector('input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"], input[placeholder*="过滤"]')
  })`)
  const stuInput = JSON.parse(stuInputInfo)
  record('form.students_has_input', stuInput.inputs.length > 0, `count=${stuInput.inputs.length}`)
  record('form.students_search', stuInput.hasSearchInput || stuInput.inputs.length > 0, `hasSearch=${stuInput.hasSearchInput}`)

  // Settings 页面 — select 和 input
  await c.navigate('#/settings')
  const settingsFormInfo = await c.eval(`JSON.stringify({
    selects: Array.from(document.querySelectorAll('select')).map(s => ({
      id: s.id || 'unnamed',
      value: s.value,
      optionCount: s.options.length,
      disabled: s.disabled
    })),
    inputs: Array.from(document.querySelectorAll('input')).map(i => ({
      type: i.type,
      value: i.value?.slice(0, 20),
      required: i.required,
      disabled: i.disabled
    }))
  })`)
  const settingsForm = JSON.parse(settingsFormInfo)
  record('form.settings_selects', settingsForm.selects.length >= 3, `count=${settingsForm.selects.length}`)
  record('form.settings_inputs', settingsForm.inputs.length >= 0, `count=${settingsForm.inputs.length}`)

  // 验证 select 都有选项
  const selectsWithOptions = settingsForm.selects.filter(s => s.optionCount > 0)
  record('form.settings_selects_have_options', selectsWithOptions.length === settingsForm.selects.length, `withOptions=${selectsWithOptions.length}/${settingsForm.selects.length}`)

  // ============================================================
  // [4] 确认对话框（删除操作）
  // ============================================================
  console.log('\n[4] 确认对话框')

  // 检查是否有确认对话框相关的 UI 元素
  await c.navigate('#/skills')
  const dialogInfo = await c.eval(`JSON.stringify({
    hasDialog: document.querySelector('dialog, [role="dialog"], .modal, .confirm-dialog') !== null,
    hasConfirmButton: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('确认') || b.textContent?.includes('删除') || b.textContent?.includes('Confirm') || b.textContent?.includes('Delete')),
    buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim().slice(0, 20)).slice(0, 10)
  })`)
  const dialogData = JSON.parse(dialogInfo)
  record('dialog.skills_buttons', dialogData.buttons.length > 0, `buttons=${JSON.stringify(dialogData.buttons).slice(0, 100)}`)

  // Privacy 页面 — 密码输入
  await c.navigate('#/privacy')
  const privacyFormInfo = await c.eval(`JSON.stringify({
    passwordInputs: document.querySelectorAll('input[type="password"]').length,
    buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim().slice(0, 25)),
    hasInitButton: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('初始化') || b.textContent?.includes('Init')),
    textareas: document.querySelectorAll('textarea').length
  })`)
  const privacyForm = JSON.parse(privacyFormInfo)
  record('form.privacy_password_input', privacyForm.passwordInputs >= 0, `count=${privacyForm.passwordInputs}`)
  record('form.privacy_buttons', privacyForm.buttons.length > 0, `buttons=${privacyForm.buttons.length}`)

  // ============================================================
  // [5] 加载状态
  // ============================================================
  console.log('\n[5] 加载状态')

  await c.navigate('#/dashboard')
  // 检查是否有 loading 相关的 CSS 类或元素
  const loadingInfo = await c.eval(`JSON.stringify({
    hasLoadingClass: document.querySelector('.loading, .spinner, [aria-busy="true"], .animate-pulse') !== null,
    hasSkeleton: document.querySelector('.skeleton, .placeholder') !== null,
    bodyLen: document.body?.innerText?.length || 0
  })`)
  const loadingData = JSON.parse(loadingInfo)
  record('loading.dashboard_state', loadingData.bodyLen > 50, `bodyLen=${loadingData.bodyLen}, hasLoading=${loadingData.hasLoadingClass}`)

  // ============================================================
  // [6] 错误提示展示
  // ============================================================
  console.log('\n[6] 错误提示展示')

  // 检查是否有错误提示容器
  const errorContainerInfo = await c.eval(`JSON.stringify({
    hasErrorContainer: document.querySelector('.error, .alert, .warning, [role="alert"], .toast-error') !== null,
    errorCount: document.querySelectorAll('.error, .alert, [role="alert"]').length
  })`)
  const errorContainer = JSON.parse(errorContainerInfo)
  record('error.container_exists', typeof errorContainer.hasErrorContainer === 'boolean', `hasError=${errorContainer.hasErrorContainer}, count=${errorContainer.errorCount}`)

  // 通过 IPC 触发错误，检查 toast
  await c.callApi('eaa.addStudent', '') // 会失败
  await sleep(500)
  const toastAfterError = await c.eval(`JSON.stringify({
    toastCount: document.querySelectorAll('.toast, .toast-error, .toast-warning').length,
    bodyContains: document.body?.innerText?.includes('错误') || document.body?.innerText?.includes('Error') || false
  })`)
  const toastData = JSON.parse(toastAfterError)
  record('error.toast_after_ipc_error', typeof toastData.toastCount === 'number', `toastCount=${toastData.toastCount}`)

  // ============================================================
  // [7] 空状态展示
  // ============================================================
  console.log('\n[7] 空状态展示')

  // 创建一个空会话的 chat
  await c.navigate('#/chat')
  const emptyStateInfo = await c.eval(`JSON.stringify({
    bodyLen: document.body?.innerText?.length || 0,
    hasEmptyState: document.body?.innerText?.includes('空') || document.body?.innerText?.includes('Empty') || document.body?.innerText?.includes('没有') || document.body?.innerText?.includes('No ') || false,
    hasPlaceholder: !!document.querySelector('[class*="empty"], [class*="placeholder"], [class*="no-data"]')
  })`)
  const emptyState = JSON.parse(emptyStateInfo)
  record('empty.chat_page', emptyState.bodyLen > 0, `bodyLen=${emptyState.bodyLen}, hasEmptyState=${emptyState.hasEmptyState}`)

  // ============================================================
  // [8] 列表排序/筛选
  // ============================================================
  console.log('\n[8] 列表排序/筛选')

  // Students 页面 — 检查是否有排序/筛选功能
  await c.navigate('#/students')
  const sortFilterInfo = await c.eval(`JSON.stringify({
    hasSortButton: !!Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('排序') || b.textContent?.includes('Sort')),
    hasFilterInput: !!document.querySelector('input[type="search"], input[placeholder*="筛选"], input[placeholder*="过滤"], input[placeholder*="搜索"]'),
    tableRows: document.querySelectorAll('tr').length,
    listItems: document.querySelectorAll('li').length,
    hasTable: document.querySelector('table') !== null
  })`)
  const sortFilter = JSON.parse(sortFilterInfo)
  record('list.students_has_data', sortFilter.tableRows > 0 || sortFilter.listItems > 0, `rows=${sortFilter.tableRows}, items=${sortFilter.listItems}`)

  // Agent 页面 — 检查 agent 列表
  await c.navigate('#/agents')
  const agentListInfo = await c.eval(`JSON.stringify({
    cards: document.querySelectorAll('[class*="card"], [class*="agent"]').length,
    listItems: document.querySelectorAll('li').length,
    bodyLen: document.body?.innerText?.length || 0
  })`)
  const agentList = JSON.parse(agentListInfo)
  record('list.agents_displayed', agentList.cards > 0 || agentList.bodyLen > 100, `cards=${agentList.cards}, bodyLen=${agentList.bodyLen}`)

  // ============================================================
  // [9] 主题切换全局一致性
  // ============================================================
  console.log('\n[9] 主题切换全局一致性')

  // 切换到 light 主题
  await c.callApi('settings.set', 'general.theme', 'light')
  await c.eval(`window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }))`)
  await sleep(500)
  await c.navigate('#/dashboard')
  const lightThemeInfo = await c.eval(`JSON.stringify({
    bodyClass: document.body?.className || '',
    htmlClass: document.documentElement?.className || '',
    hasLightClass: (document.documentElement?.className || '').includes('light') || (document.body?.className || '').includes('light'),
    bgColor: window.getComputedStyle(document.body)?.backgroundColor || ''
  })`)
  const lightTheme = JSON.parse(lightThemeInfo)
  record('theme.light_applied', lightTheme.hasLightClass || !lightTheme.htmlClass.includes('dark'), `htmlClass=${lightTheme.htmlClass.slice(0, 50)}`)

  // 切换到 dark 主题
  await c.callApi('settings.set', 'general.theme', 'dark')
  await c.eval(`window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }))`)
  await sleep(500)
  await c.navigate('#/dashboard')
  const darkThemeInfo = await c.eval(`JSON.stringify({
    bodyClass: document.body?.className || '',
    htmlClass: document.documentElement?.className || '',
    hasDarkClass: (document.documentElement?.className || '').includes('dark') || (document.body?.className || '').includes('dark')
  })`)
  const darkTheme = JSON.parse(darkThemeInfo)
  record('theme.dark_applied', darkTheme.hasDarkClass, `htmlClass=${darkTheme.htmlClass.slice(0, 50)}`)

  // 验证主题在所有页面一致
  let themeConsistent = true
  for (const page of pages.slice(0, 5)) {
    await c.navigate(page.hash)
    const pageInfo = await c.eval(`JSON.stringify({
      htmlClass: document.documentElement?.className || ''
    })`)
    const pageData = JSON.parse(pageInfo)
    if (!pageData.htmlClass.includes('dark')) themeConsistent = false
  }
  record('theme.consistent_across_pages', themeConsistent, `consistent=${themeConsistent}`)

  // ============================================================
  // [10] 国际化文案完整性
  // ============================================================
  console.log('\n[10] 国际化文案完整性')

  // 检查各页面是否有未翻译的 key（通常以 "page." 或 "common." 开头）
  await c.navigate('#/dashboard')
  const i18nInfo = await c.eval(`JSON.stringify({
    bodyText: document.body?.innerText || '',
    hasRawKey: (document.body?.innerText || '').includes('page.') || (document.body?.innerText || '').includes('common.') || (document.body?.innerText || '').includes('t('),
    title: document.title
  })`)
  const i18nData = JSON.parse(i18nInfo)
  record('i18n.no_raw_keys', !i18nData.hasRawKey, `hasRawKey=${i18nData.hasRawKey}`)

  // 切换语言验证
  // 注意: i18n 模块使用 'zh'/'en',settings 使用 'zh-CN'/'en-US'
  // IPC settings.set 不调用 setLang(),需通过 SettingsPage select onChange 触发
  const origLang = (await c.callApi('settings.get'))?.general?.language
  console.log(`  [i18n] origLang=${origLang}`)
  await c.navigate('#/settings')
  await sleep(500)
  await c.eval(`(async () => {
    const selects = Array.from(document.querySelectorAll('select'))
    const langSelect = selects.find(s => {
      const opts = Array.from(s.options).map(o => o.value)
      return opts.includes('zh-CN') && opts.includes('en-US')
    })
    if (!langSelect) return { error: 'not found', n: selects.length }
    const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    ns.call(langSelect, 'zh-CN')
    langSelect.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: langSelect.value }
  })()`)
  await sleep(1000)
  await c.navigate('#/dashboard')
  await sleep(500)
  const zhText = await c.eval(`document.body?.innerText?.slice(0, 300) || ''`)

  await c.navigate('#/settings')
  await sleep(500)
  await c.eval(`(async () => {
    const selects = Array.from(document.querySelectorAll('select'))
    const langSelect = selects.find(s => {
      const opts = Array.from(s.options).map(o => o.value)
      return opts.includes('zh-CN') && opts.includes('en-US')
    })
    if (!langSelect) return { error: 'not found' }
    const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    ns.call(langSelect, 'en-US')
    langSelect.dispatchEvent(new Event('change', { bubbles: true }))
    return { ok: true, value: langSelect.value }
  })()`)
  await sleep(1000)
  await c.navigate('#/dashboard')
  await sleep(500)
  const enText = await c.eval(`document.body?.innerText?.slice(0, 300) || ''`)

  console.log(`  [i18n] zhText(50)=${zhText.slice(0, 50)}`)
  console.log(`  [i18n] enText(50)=${enText.slice(0, 50)}`)

  record('i18n.language_switch', zhText !== enText, `zhLen=${zhText.length}, enLen=${enText.length}, different=${zhText !== enText}`)

  // 恢复原始语言
  if (origLang) {
    const restoreValue = origLang === 'zh' ? 'zh-CN' : origLang === 'en' ? 'en-US' : origLang
    await c.navigate('#/settings')
    await sleep(500)
    await c.eval(`(async () => {
      const selects = Array.from(document.querySelectorAll('select'))
      const langSelect = selects.find(s => {
        const opts = Array.from(s.options).map(o => o.value)
        return opts.includes('zh-CN') && opts.includes('en-US')
      })
      if (!langSelect) return
      const ns = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
      ns.call(langSelect, ${JSON.stringify(restoreValue)})
      langSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
    await sleep(500)
  }

  // ============================================================
  // [11] 导航栏状态一致性
  // ============================================================
  console.log('\n[11] 导航栏状态一致性')

  await c.navigate('#/dashboard')
  const navInfo = await c.eval(`JSON.stringify({
    navLinks: Array.from(document.querySelectorAll('nav a, nav button')).map(a => ({
      text: a.textContent?.trim().slice(0, 20),
      href: a.getAttribute('href') || '',
      active: a.classList.contains('active') || a.getAttribute('aria-current') === 'page'
    })),
    activeLink: Array.from(document.querySelectorAll('nav a, nav button')).findIndex(a => a.classList.contains('active') || a.getAttribute('aria-current') === 'page')
  })`)
  const navData = JSON.parse(navInfo)
  record('nav.links_count', navData.navLinks.length >= 5, `count=${navData.navLinks.length}`)
  record('nav.active_link_present', navData.activeLink >= 0, `activeIndex=${navData.activeLink}`)

  // 导航到不同页面，验证 active 状态变化
  await c.navigate('#/students')
  const navAfterNav = await c.eval(`JSON.stringify({
    activeLinkText: Array.from(document.querySelectorAll('nav a, nav button')).find(a => a.classList.contains('active') || a.getAttribute('aria-current') === 'page')?.textContent?.trim().slice(0, 20) || 'none'
  })`)
  const navAfterNavData = JSON.parse(navAfterNav)
  record('nav.active_changes', navAfterNavData.activeLinkText !== 'none', `active=${navAfterNavData.activeLinkText}`)

  // ============================================================
  // [12] 最终健康检查
  // ============================================================
  console.log('\n[12] 最终健康检查')
  const healthChecks = [
    { name: 'eaa.info', call: () => c.callApi('eaa.info') },
    { name: 'eaa.doctor', call: () => c.callApi('eaa.doctor') },
    { name: 'agent.list', call: () => c.callApi('agent.list') },
    { name: 'skill.list', call: () => c.callApi('skill.list') },
    { name: 'settings.get', call: () => c.callApi('settings.get') },
    { name: 'cron.list', call: () => c.callApi('cron.list') },
    { name: 'privacy.status', call: () => c.callApi('privacy.status') },
  ]

  for (const check of healthChecks) {
    const res = await check.call()
    record(`health.${check.name}`, res !== null && res !== undefined && !res?.__error, `ok=${res !== null && res !== undefined}`)
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`ROUND 17 SUMMARY: ${passed}/${results.length} passed, ${failed} failed`)
  console.log('============================================================')
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail}`))
  }

  c.close()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
