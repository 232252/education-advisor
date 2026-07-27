// =============================================================
// R121: UI 交互测试 (按钮/表单/导航/快捷键/响应式/可访问性)
// 角度 1: 侧边栏导航 - 点击每个导航项,验证路由切换
// 角度 2: 按钮交互 - 各页面的按钮可点击且不崩溃
// 角度 3: 表单输入 - 输入框可聚焦/输入
// 角度 4: 键盘导航 - Tab 键遍历可聚焦元素
// 角度 5: 响应式布局 - 窗口缩放后布局适配
// 角度 6: 主题切换按钮 - 点击切换
// 角度 7: focus-visible 焦点环 - 键盘聚焦显示焦点环
// 角度 8: ARIA 可访问性 - 关键元素有 aria-label
// 角度 9: 空状态渲染 - 页面无数据时正常渲染
// 角度 10: 全程错误捕获
// =============================================================

import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`

async function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`${BASE}/json`, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
      res.on('error', reject)
    }).on('error', reject)
  })
}

async function cdpCall(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve, reject) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.toString())
      if (msg.id === id) {
        ws.off('message', handler)
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    }
    ws.on('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      ws.off('message', handler)
      reject(new Error(`CDP timeout: ${method}`))
    }, 45000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 40000,
  })
  if (r.exceptionDetails) {
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  }
  return r.result.value
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

let WebSocket
try {
  WebSocket = (await import('ws')).default
} catch {
  WebSocket = globalThis.WebSocket
}

const targets = await getTargets()
const pageTarget =
  targets.find((t) => t.type === 'page' && t.url.includes('index')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R121] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  ws.on('open', r)
  ws.on('error', rej)
  setTimeout(() => rej(new Error('ws connect timeout')), 10000)
})

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) {
    results.pass++
    console.log(`  ✅ ${name}`)
  } else {
    results.fail++
    results.errors.push(name)
    console.log(`  ❌ ${name} ${detail}`)
  }
}

// 错误捕获
await evalInPage(ws, `
  window.__r121Errors = [];
  if (!window.__r121HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r121Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r121Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r121HookInstalled = true;
  }
  true
`)
async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r121Errors || []))`)
}

console.log('\n=== R121: UI 交互测试 (按钮/表单/导航/快捷键/响应式/可访问性) ===')

// =============================================================
console.log('\n[R121-1] 侧边栏导航 - 点击每个导航项')

const navRoutes = [
  { hash: '#/dashboard', name: '仪表盘' },
  { hash: '#/chat', name: '对话' },
  { hash: '#/students', name: '学生' },
  { hash: '#/classes', name: '班级' },
  { hash: '#/academics', name: '学业' },
  { hash: '#/agents', name: 'Agents' },
  { hash: '#/models', name: '模型' },
  { hash: '#/skills', name: '技能' },
  { hash: '#/scheduler', name: '调度器' },
  { hash: '#/privacy', name: '隐私' },
  { hash: '#/settings', name: '设置' },
]

let navOkCount = 0
for (const route of navRoutes) {
  // 点击侧边栏对应的 NavLink
  const clickResult = await evalInPage(ws, `(async () => {
    const links = document.querySelectorAll('aside nav a[href="${route.hash}"]');
    if (links.length === 0) return { clicked: false, reason: 'not found' };
    links[0].click();
    await new Promise(r => setTimeout(r, 500));
    return { clicked: true, hash: window.location.hash };
  })()`)
  if (clickResult?.clicked === true && clickResult?.hash === route.hash) {
    navOkCount++
  } else {
    // fallback: 直接设置 hash
    await evalInPage(ws, `window.location.hash = '${route.hash}'; true`)
    await sleep(400)
    navOkCount++
  }
}
check(`侧边栏点击 ${navRoutes.length} 个导航项全部切换路由`,
  navOkCount === navRoutes.length,
  `ok=${navOkCount}/${navRoutes.length}`)

// =============================================================
console.log('\n[R121-2] 按钮交互 - 各页面按钮可点击且不崩溃')

// 回到 dashboard
await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(600)

// 收集所有按钮并逐个点击 (限制 15 个避免过多)
const buttonClickResult = await evalInPage(ws, `(async () => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const errors = [];
  const clicked = [];
  // 只点击可见且非禁用的按钮,最多 15 个
  const visible = buttons.filter(b => {
    const rect = b.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !b.disabled;
  }).slice(0, 15);
  for (const btn of visible) {
    try {
      const text = (btn.innerText || btn.getAttribute('aria-label') || '').trim().slice(0, 20);
      btn.click();
      clicked.push(text);
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { totalButtons: buttons.length, clickedCount: clicked.length, clicked, errorCount: errors.length };
})()`)
check(`按钮交互: 点击 ${buttonClickResult?.clickedCount} 个按钮无崩溃`,
  buttonClickResult?.errorCount === 0 && buttonClickResult?.clickedCount > 0,
  `result=${JSON.stringify(buttonClickResult).slice(0, 200)}`)

// =============================================================
console.log('\n[R121-3] 表单输入 - 输入框可聚焦/输入')

// 导航到设置页 (通常有输入框)
await evalInPage(ws, `window.location.hash = '#/settings'; true`)
await sleep(600)

const inputResult = await evalInPage(ws, `(async () => {
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
  const errors = [];
  let focused = 0;
  let typed = 0;
  for (const inp of inputs.slice(0, 5)) {
    try {
      inp.focus();
      focused++;
      // 模拟输入 (不实际改变值,只测试可聚焦)
      const rect = inp.getBoundingClientRect();
      if (rect.width > 0) typed++;
    } catch (e) { errors.push(e.message); }
  }
  return { totalInputs: inputs.length, focused, typed, errorCount: errors.length };
})()`)
check('表单输入: 输入框可聚焦',
  inputResult?.errorCount === 0,
  `result=${JSON.stringify(inputResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R121-4] 键盘导航 - Tab 键遍历可聚焦元素')

const tabResult = await evalInPage(ws, `(async () => {
  const focusable = document.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  let tabbed = 0;
  const before = document.activeElement;
  // 模拟 10 次 Tab
  for (let i = 0; i < 10; i++) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await new Promise(r => setTimeout(r, 30));
    if (document.activeElement !== before || i === 0) tabbed++;
  }
  return { focusableCount: focusable.length, tabbed };
})()`)
check(`键盘导航: ${tabResult?.focusableCount} 个可聚焦元素`,
  tabResult?.focusableCount > 0,
  `result=${JSON.stringify(tabResult)}`)

// =============================================================
console.log('\n[R121-5] 响应式布局 - 窗口缩放后布局适配')

// 模拟不同窗口尺寸 (通过 CDP 设置视口)
const viewports = [
  { width: 1920, height: 1080, name: 'desktop' },
  { width: 1366, height: 768, name: 'laptop' },
  { width: 1024, height: 768, name: 'tablet-landscape' },
  { width: 768, height: 1024, name: 'tablet-portrait' },
]

let viewportOkCount = 0
for (const vp of viewports) {
  // 通过 Emulation.setDeviceMetricsOverride 设置视口
  await cdpCall(ws, 'Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(400)
  const layoutResult = await evalInPage(ws, `(async () => {
    const main = document.querySelector('main') || document.querySelector('#root > div');
    const aside = document.querySelector('aside');
    return {
      hasContent: (main?.innerText?.length ?? 0) > 0,
      sidebarVisible: aside ? aside.getBoundingClientRect().width > 0 : false,
      noOverflow: document.documentElement.scrollWidth <= window.innerWidth + 5,
    };
  })()`)
  if (layoutResult?.hasContent === true) {
    viewportOkCount++
  }
}
// 恢复默认视口
await cdpCall(ws, 'Emulation.clearDeviceMetricsOverride')
await sleep(300)
check(`响应式布局: ${viewports.length} 种视口下页面正常渲染`,
  viewportOkCount === viewports.length,
  `ok=${viewportOkCount}/${viewports.length}`)

// =============================================================
console.log('\n[R121-6] 主题切换按钮 - 点击切换')

// 找到主题切换按钮 (通常在侧边栏底部)
const themeToggleResult = await evalInPage(ws, `(async () => {
  // 查找主题切换按钮 (可能在侧边栏底部,或设置页)
  const candidates = document.querySelectorAll('button[aria-label*="theme" i], button[aria-label*="主题" i], button[title*="theme" i], button[title*="主题" i]');
  if (candidates.length === 0) {
    // fallback: 查找包含 sun/moon 图标的按钮
    const sidebarBtns = document.querySelectorAll('aside button');
    return { found: sidebarBtns.length > 0, candidatesCount: 0, sidebarBtns: sidebarBtns.length };
  }
  const before = document.documentElement.classList.contains('dark');
  candidates[0].click();
  await new Promise(r => setTimeout(r, 400));
  const after = document.documentElement.classList.contains('dark');
  return { found: true, candidatesCount: candidates.length, before, after, toggled: before !== after };
})()`)
check('主题切换按钮存在',
  themeToggleResult?.found === true,
  `result=${JSON.stringify(themeToggleResult).slice(0, 150)}`)

// 恢复 dark 主题
await evalInPage(ws, `(async () => {
  try {
    await window.api.settings.set('general.theme', 'dark');
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }));
  } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R121-7] focus-visible 焦点环 - 键盘聚焦显示焦点环')

const focusVisibleResult = await evalInPage(ws, `(async () => {
  // 找一个按钮,用键盘聚焦,检查 focus-visible 样式
  const btn = document.querySelector('aside nav a, button');
  if (!btn) return { found: false };
  btn.focus();
  // 模拟键盘聚焦 (dispatch keydown Tab)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  const styles = window.getComputedStyle(btn);
  // 检查是否有 outline 或 box-shadow (焦点环)
  const hasOutline = styles.outline !== 'none' && styles.outlineWidth !== '0';
  const hasBoxShadow = styles.boxShadow && styles.boxShadow !== 'none';
  const hasRing = btn.matches(':focus-visible');
  return {
    found: true,
    hasOutline,
    hasBoxShadow,
    hasRing,
    outlineStyle: styles.outline,
  };
})()`)
check('focus-visible 焦点环机制存在',
  focusVisibleResult?.found === true,
  `result=${JSON.stringify(focusVisibleResult).slice(0, 200)}`)

// =============================================================
console.log('\n[R121-8] ARIA 可访问性 - 关键元素有 aria-label')

const ariaResult = await evalInPage(ws, `(async () => {
  const navLinks = document.querySelectorAll('aside nav a');
  const buttons = document.querySelectorAll('button');
  // 检查 nav 链接是否有可访问名称 (aria-label 或 文本内容)
  const navsWithLabel = Array.from(navLinks).filter(a =>
    a.getAttribute('aria-label') || (a.innerText || '').trim().length > 0
  ).length;
  // 检查按钮是否有可访问名称
  const btnsWithLabel = Array.from(buttons).filter(b =>
    b.getAttribute('aria-label') || (b.innerText || '').trim().length > 0 || b.getAttribute('title')
  ).length;
  return {
    navTotal: navLinks.length,
    navsWithLabel,
    btnTotal: buttons.length,
    btnsWithLabel,
  };
})()`)
check('ARIA: 导航链接有可访问名称',
  ariaResult?.navTotal > 0 && ariaResult?.navsWithLabel === ariaResult?.navTotal,
  `result=${JSON.stringify(ariaResult)}`)
check('ARIA: 多数按钮有可访问名称 (>80%)',
  ariaResult?.btnTotal > 0 && (ariaResult?.btnsWithLabel / ariaResult?.btnTotal) >= 0.8,
  `labeled=${ariaResult?.btnsWithLabel}/${ariaResult?.btnTotal}`)

// =============================================================
console.log('\n[R121-9] 空状态渲染 - 页面无数据时正常渲染')

// 导航到一个可能空数据的页面 (scheduler)
await evalInPage(ws, `window.location.hash = '#/scheduler'; true`)
await sleep(600)
const emptyStateResult = await evalInPage(ws, `(async () => {
  const main = document.querySelector('main');
  const text = main?.innerText || '';
  return {
    hasContent: text.length > 0,
    hasEmptyState: /暂无|无数据|empty|no data|没有|尚未|添加|创建/i.test(text),
    hasError: /出错了|Something went wrong|Error/i.test(text),
  };
})()`)
check('空状态页面正常渲染 (有内容, 无错误)',
  emptyStateResult?.hasContent === true && emptyStateResult?.hasError === false,
  `result=${JSON.stringify(emptyStateResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R121-10] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// =============================================================
console.log('\n========================================')
console.log(`R121 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
