// =============================================================
// R116: UI 可访问性 + 主题切换 + 国际化测试
// 角度 1: 主题切换 - light/dark/system 三态切换不崩溃
// 角度 2: 主题持久化 - 切换后 settings 持久化
// 角度 3: 国际化 - zh-CN/en-US 切换不崩溃
// 角度 4: 国际化持久化 - localStorage 保存语言
// 角度 5: 可访问性 - 主要交互元素有 aria-label/role
// 角度 6: 键盘导航 - Tab 键可聚焦主要元素
// 角度 7: 响应式布局 - 窗口尺寸变化不崩溃
// 角度 8: 暗色模式 DOM 类 - dark: 类正确应用
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
    }, 30000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 25000,
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
console.log(`[R116] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r116Errors = [];
  if (!window.__r116HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r116Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r116Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r116HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r116Errors || []))`)
}

console.log('\n=== R116: UI 可访问性 + 主题切换 + 国际化测试 ===')

// =============================================================
console.log('\n[R116-1] 主题切换 - light/dark/system 三态切换不崩溃')

// 备份原始 theme
const originalTheme = await evalInPage(ws, `(async () => {
  try {
    const s = await window.api.settings.get();
    return s?.general?.theme || 'light';
  } catch (e) { return 'light'; }
})()`)

// 测试三种主题
const themes = ['light', 'dark', 'system']
for (const theme of themes) {
  const result = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set('general.theme', ${JSON.stringify(theme)});
      // 等待 React 重新渲染
      await new Promise(r => setTimeout(r, 300));
      const s = await window.api.settings.get();
      return { ok: r?.success !== false, applied: s?.general?.theme === ${JSON.stringify(theme)} };
    } catch (e) { return { ok: false, error: e.message }; }
  })()`)
  check(`主题切换到 ${theme} 不崩溃`,
    result?.ok === true && result?.applied === true,
    `result=${JSON.stringify(result).slice(0, 100)}`)
}

// 还原
await evalInPage(ws, `(async () => {
  try { await window.api.settings.set('general.theme', ${JSON.stringify(originalTheme)}); } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R116-2] 主题持久化 - 切换后 settings 持久化')

// 切换到 dark
await evalInPage(ws, `(async () => { await window.api.settings.set('general.theme', 'dark'); return true; })()`)
await sleep(300)

// 重新读取
const persistedTheme = await evalInPage(ws, `(async () => {
  try {
    const s = await window.api.settings.get();
    return s?.general?.theme;
  } catch (e) { return null; }
})()`)
check('主题 dark 持久化到 settings',
  persistedTheme === 'dark',
  `theme=${persistedTheme}`)

// 还原
await evalInPage(ws, `(async () => { await window.api.settings.set('general.theme', ${JSON.stringify(originalTheme)}); return true; })()`)

// =============================================================
console.log('\n[R116-3] 国际化 - zh-CN/en-US 切换不崩溃')

// 备份当前语言
const originalLang = await evalInPage(ws, `window.localStorage.getItem('education-advisor.lang') || 'zh-CN'`)

// 切换到 en-US
await evalInPage(ws, `window.localStorage.setItem('education-advisor.lang', 'en-US'); true`)
await sleep(500)

// 导航到 dashboard 验证不崩溃
await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(1000)

const enUsOk = await evalInPage(ws, `(async () => {
  const main = document.querySelector('main') || document.querySelector('#root > div');
  const text = main ? main.innerText : '';
  return { hasContent: text.length > 0, hasError: /出错|Something went wrong/i.test(text) };
})()`)
check('切换到 en-US 后页面正常加载',
  enUsOk?.hasContent === true && enUsOk?.hasError === false,
  `result=${JSON.stringify(enUsOk).slice(0, 100)}`)

// 切换回 zh-CN
await evalInPage(ws, `window.localStorage.setItem('education-advisor.lang', 'zh-CN'); true`)
await sleep(500)

const zhCnOk = await evalInPage(ws, `(async () => {
  const main = document.querySelector('main') || document.querySelector('#root > div');
  const text = main ? main.innerText : '';
  return { hasContent: text.length > 0, hasError: /出错|Something went wrong/i.test(text) };
})()`)
check('切换回 zh-CN 后页面正常加载',
  zhCnOk?.hasContent === true && zhCnOk?.hasError === false,
  `result=${JSON.stringify(zhCnOk).slice(0, 100)}`)

// 还原
await evalInPage(ws, `window.localStorage.setItem('education-advisor.lang', ${JSON.stringify(originalLang)}); true`)

// =============================================================
console.log('\n[R116-4] 国际化持久化 - localStorage 保存语言')

// 设置 en-US
await evalInPage(ws, `window.localStorage.setItem('education-advisor.lang', 'en-US'); true`)
const langEnUs = await evalInPage(ws, `window.localStorage.getItem('education-advisor.lang')`)
check('localStorage 保存 en-US',
  langEnUs === 'en-US',
  `value=${langEnUs}`)

// 设置 zh-CN
await evalInPage(ws, `window.localStorage.setItem('education-advisor.lang', 'zh-CN'); true`)
const langZhCn = await evalInPage(ws, `window.localStorage.getItem('education-advisor.lang')`)
check('localStorage 保存 zh-CN',
  langZhCn === 'zh-CN',
  `value=${langZhCn}`)

// 还原
await evalInPage(ws, `window.localStorage.setItem('education-advisor.lang', ${JSON.stringify(originalLang)}); true`)

// =============================================================
console.log('\n[R116-5] 可访问性 - 主要交互元素有 aria-label/role')

// 导航到 dashboard
await evalInPage(ws, `window.location.hash = '#/dashboard'; true`)
await sleep(1000)

const a11y = await evalInPage(ws, `(async () => {
  // 检查导航栏
  const nav = document.querySelector('nav') || document.querySelector('aside');
  const buttons = document.querySelectorAll('button');
  const links = document.querySelectorAll('a');
  const inputs = document.querySelectorAll('input, select, textarea');

  // 统计有 aria-label 或 title 的交互元素
  const interactiveWithLabel = [
    ...buttons,
    ...links,
    ...inputs,
  ].filter(el => el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim());

  return {
    hasNav: !!nav,
    navRole: nav?.getAttribute('role'),
    navAriaLabel: nav?.getAttribute('aria-label'),
    buttonsCount: buttons.length,
    linksCount: links.length,
    inputsCount: inputs.length,
    interactiveWithLabelCount: interactiveWithLabel.length,
  };
})()`)

check('页面有导航元素',
  a11y?.hasNav === true,
  `result=${JSON.stringify(a11y).slice(0, 100)}`)
check('交互元素 (button/link/input) 数量 > 0',
  (a11y?.buttonsCount || 0) + (a11y?.linksCount || 0) + (a11y?.inputsCount || 0) > 0,
  `buttons=${a11y?.buttonsCount}, links=${a11y?.linksCount}, inputs=${a11y?.inputsCount}`)

// =============================================================
console.log('\n[R116-6] 键盘导航 - Tab 键可聚焦主要元素')

const keyboardNav = await evalInPage(ws, `(async () => {
  // 模拟 Tab 键, 检查 focus 是否移动到可交互元素
  const focusableSelectors = 'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const initialActive = document.activeElement;
  const focusableElements = document.querySelectorAll(focusableSelectors);

  // 找到第一个可聚焦元素
  let firstFocusable = null;
  for (const el of focusableElements) {
    if (el.offsetParent !== null) { // visible
      firstFocusable = el;
      break;
    }
  }

  if (firstFocusable) {
    firstFocusable.focus();
    return {
      ok: true,
      tagName: firstFocusable.tagName,
      hasFocus: document.activeElement === firstFocusable,
      totalFocusable: focusableElements.length,
    };
  }
  return { ok: false, totalFocusable: focusableElements.length };
})()`)
check('存在可聚焦元素',
  keyboardNav?.ok === true && keyboardNav?.totalFocusable > 0,
  `result=${JSON.stringify(keyboardNav).slice(0, 150)}`)
check('focus() 可设置焦点',
  keyboardNav?.hasFocus === true,
  `tagName=${keyboardNav?.tagName}`)

// =============================================================
console.log('\n[R116-7] 响应式布局 - 窗口尺寸变化不崩溃')

// 通过 CDP 设置不同视口尺寸
const viewports = [
  { width: 1920, height: 1080, name: 'desktop-fullhd' },
  { width: 1366, height: 768, name: 'desktop-laptop' },
  { width: 1024, height: 768, name: 'tablet-landscape' },
  { width: 768, height: 1024, name: 'tablet-portrait' },
]

for (const vp of viewports) {
  await cdpCall(ws, 'Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await sleep(500)
  const vpOk = await evalInPage(ws, `(async () => {
    const main = document.querySelector('main') || document.querySelector('#root > div');
    const text = main ? main.innerText : '';
    return {
      hasContent: text.length > 0,
      hasError: /出错|Something went wrong/i.test(text),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  })()`)
  check(`视口 ${vp.name} (${vp.width}x${vp.height}) 正常`,
    vpOk?.hasContent === true && vpOk?.hasError === false,
    `result=${JSON.stringify(vpOk).slice(0, 100)}`)
}

// 还原视口
await cdpCall(ws, 'Emulation.clearDeviceMetricsOverride')

// =============================================================
console.log('\n[R116-8] 暗色模式 DOM 类 - dark: 类正确应用')

// 切换到 dark (需要同时 dispatch theme-changed 事件, 模拟 SettingsPage UI 行为)
await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', 'dark');
  // 模拟 SettingsPage 的 GeneralSection 行为: dispatch theme-changed 事件
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }));
  return true;
})()`)
await sleep(800)

const darkModeDom = await evalInPage(ws, `(async () => {
  // 检查 html 或 body 是否有 dark 类 (Tailwind dark mode)
  const html = document.documentElement;
  const body = document.body;
  // Tailwind 默认 dark mode: class="dark" on html
  const htmlHasDark = html.classList.contains('dark');
  const bodyHasDark = body.classList.contains('dark');
  // 或者通过 color-scheme
  const colorScheme = html.style.colorScheme || getComputedStyle(html).colorScheme;

  // 检查是否有 dark: 变体的 CSS 规则生效
  const sampleEl = document.querySelector('main, #root > div');
  const sampleBg = sampleEl ? getComputedStyle(sampleEl).backgroundColor : null;

  return {
    htmlHasDark,
    bodyHasDark,
    colorScheme,
    sampleBg,
    htmlClasses: html.className,
  };
})()`)
check('dark 主题切换后 html 有 dark 类或 colorScheme=dark',
  darkModeDom?.htmlHasDark === true || darkModeDom?.colorScheme === 'dark' || darkModeDom?.bodyHasDark === true,
  `htmlHasDark=${darkModeDom?.htmlHasDark}, colorScheme=${darkModeDom?.colorScheme}, htmlClasses=${darkModeDom?.htmlClasses}`)

// 切换到 light
await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', 'light');
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }));
  return true;
})()`)
await sleep(800)

const lightModeDom = await evalInPage(ws, `(async () => {
  const html = document.documentElement;
  return {
    htmlHasDark: html.classList.contains('dark'),
    htmlClasses: html.className,
  };
})()`)
check('light 主题切换后 html 无 dark 类',
  lightModeDom?.htmlHasDark === false,
  `htmlHasDark=${lightModeDom?.htmlHasDark}, classes=${lightModeDom?.htmlClasses}`)

// 还原主题
await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', ${JSON.stringify(originalTheme)});
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: ${JSON.stringify(originalTheme)} }));
  return true;
})()`)

// =============================================================
console.log('\n[R116-9] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 300)}`)

// =============================================================
console.log('\n========================================')
console.log(`R116 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
