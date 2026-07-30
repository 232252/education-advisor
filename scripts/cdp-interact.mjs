// CDP 深度交互测试: 主题切换 + Dashboard 班级过滤 + 班级对比
import fs from 'node:fs'
import WebSocket from 'ws'

const OUT = process.argv[2] || process.env.TEMP + '/cdp-interact'
fs.mkdirSync(OUT, { recursive: true })

async function getPageTarget() {
  const res = await fetch(`http://localhost:${process.env.EA_CDP_PORT || '9222'}/json`)
  const targets = await res.json()
  const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  if (!page) throw new Error('no page target')
  return page
}

const page = await getPageTarget()
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })
let id = 0
const pending = new Map()
const consoleMsgs = []
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString())
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    consoleMsgs.push({ type: msg.params.type, text: msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) })
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleMsgs.push({ type: 'exception', text: JSON.stringify(msg.params.exceptionDetails).slice(0, 300) })
  }
})
const send = (method, params = {}, timeoutMs = 15000) => new Promise((res, rej) => {
  const mid = ++id
  const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)) }, timeoutMs)
  pending.set(mid, (msg) => { clearTimeout(timer); res(msg) })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
const evl = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') }
  return r.result?.result?.value
}
// 截图用独立子进程: 同一会话内 Runtime.enable + captureScreenshot 组合偶发无响应,
// cdp-shot.mjs 独立进程 100% 可靠, 直接复用。
import { execFileSync } from 'node:child_process'
const shot = (name) => {
  execFileSync(process.execPath, ['scripts/cdp-shot.mjs', `${OUT}/${name}.png`, '300'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    timeout: 30000,
  })
  console.log(`[shot] ${name}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 注意: 不在主连接上 enable Page/Runtime 域 — 只要主连接启用了域,
// 其他会话的 Page.captureScreenshot 就会无限挂起(实测复现)。
// 控制台错误改用注入的 window.onerror 钩子采集。
await evl(`(() => {
  if (window.__errHookInstalled) return true
  window.__errHookInstalled = true
  window.__consoleErrors = []
  window.addEventListener('error', (e) => window.__consoleErrors.push({ type: 'error', text: String(e.message).slice(0, 300) }))
  window.addEventListener('unhandledrejection', (e) => window.__consoleErrors.push({ type: 'rejection', text: String(e.reason).slice(0, 300) }))
  const origErr = console.error.bind(console)
  console.error = (...a) => { window.__consoleErrors.push({ type: 'console.error', text: a.map(String).join(' ').slice(0, 300) }); origErr(...a) }
  return true
})()`)

const report = { steps: [], consoleIssues: consoleMsgs }
const step = (name, ok, detail) => { report.steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : ''}`) }

// ---------- 1. Dashboard 加载 ----------
await evl(`location.hash = '#/dashboard'`)
await sleep(2200)
const dashStats = await evl(`(() => {
  const cards = document.querySelectorAll('main [class*="card"], main [class*="stat"], main section, main div')
  const text = document.querySelector('main')?.innerText || ''
  const m = text.match(/学生总数[\\s\\S]{0,30}?(\\d+)/)
  return { hasMain: !!document.querySelector('main'), studentCount: m ? m[1] : null, textLen: text.length }
})()`)
step('dashboard-load', !!dashStats?.hasMain && dashStats.textLen > 100, dashStats)

// ---------- 2. 班级过滤下拉 ----------
const classOptions = await evl(`(() => {
  const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.includes('全部班级')))
  if (!sel) return null
  return { count: sel.options.length, first3: [...sel.options].slice(0, 3).map((o) => o.text) }
})()`)
step('dashboard-class-filter-present', !!classOptions && classOptions.count > 1, classOptions)

// 选一个具体班级, 验证过滤生效
if (classOptions && classOptions.count > 2) {
  const filterResult = await evl(`(async () => {
    const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.text.includes('全部班级')))
    const target = [...sel.options].find((o) => o.value && o.value !== '__ALL__' && !o.text.includes('全部'))
    if (!target) return { skip: 'no class option' }
    sel.value = target.value
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 1500))
    const text = document.querySelector('main')?.innerText || ''
    return { selected: target.text, rankingVisible: text.includes('排行榜'), textLen: text.length }
  })()`)
  step('dashboard-class-filter-apply', !!filterResult && !filterResult.skip, filterResult)
  await shot('dashboard-filtered')
}

// ---------- 3. 班级对比模式 ----------
const compareResult = await evl(`(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('班级对比'))
  if (!btn) return { error: 'no compare button' }
  btn.click()
  await new Promise((r) => setTimeout(r, 800))
  // 找 A/B 选择器
  const selects = [...document.querySelectorAll('main select')]
  return { selectsAfterCompare: selects.length, options: selects.map((s) => s.options.length) }
})()`)
step('dashboard-compare-mode', !!compareResult && !compareResult.error, compareResult)
await shot('dashboard-compare')

// 选两个班并验证对比数据
if (compareResult && compareResult.selectsAfterCompare >= 2) {
  const compareData = await evl(`(async () => {
    const selects = [...document.querySelectorAll('main select')].filter((s) => [...s.options].some((o) => /班|G\\d|选择/.test(o.text)))
    if (selects.length < 2) return { skip: 'compare selects not found', found: selects.length }
    const pick = (sel, idx) => {
      const opts = [...sel.options].filter((o) => o.value && !o.text.includes('选择') && !o.text.includes('全部'))
      if (opts.length > idx) { sel.value = opts[idx].value; sel.dispatchEvent(new Event('change', { bubbles: true })); return opts[idx].text }
      return null
    }
    const a = pick(selects[0], 0)
    const b = pick(selects[1], Math.min(1, selects[1].options.length - 2))
    await new Promise((r) => setTimeout(r, 1500))
    const text = document.querySelector('main')?.innerText || ''
    return { a, b, hasAvg: text.includes('平均'), textSnippet: text.slice(0, 400) }
  })()`)
  step('dashboard-compare-data', !!compareData && !compareData.skip && compareData.hasAvg, compareData)
  await shot('dashboard-compare-data')
}

// ---------- 4. 主题切换 ----------
await evl(`location.hash = '#/dashboard'`)
await sleep(800)
const themeBefore = await evl(`document.documentElement.classList.contains('dark')`)
await evl(`(() => {
  const btn = [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === '深色' || b.textContent.trim() === '浅色')
  if (btn) btn.click()
})()`)
await sleep(900)
const themeAfter = await evl(`document.documentElement.classList.contains('dark')`)
step('theme-toggle', themeBefore !== themeAfter, { before: themeBefore, after: themeAfter })
await shot('theme-dark')
// 切回
await evl(`(() => {
  const btn = [...document.querySelectorAll('button, a')].find((b) => b.textContent.trim() === '深色' || b.textContent.trim() === '浅色')
  if (btn) btn.click()
})()`)
await sleep(600)
const themeFinal = await evl(`document.documentElement.classList.contains('dark')`)
step('theme-restore', themeFinal === themeBefore, { final: themeFinal })

// ---------- 5. localStorage 主题持久化 ----------
const storedTheme = await evl(`localStorage.getItem('theme') || localStorage.getItem('ea-theme') || 'none'`)
step('theme-persist', true, { storedTheme })

const pageErrors = await evl(`(window.__consoleErrors || []).slice(0, 20)`)
report.consoleIssues = pageErrors || []
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log('page errors:', (pageErrors || []).length)
for (const c of (pageErrors || []).slice(0, 10)) console.log(' [page]', c.type, c.text)
ws.close()
process.exit(0)
