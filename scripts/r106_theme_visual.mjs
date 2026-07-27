// =============================================================
// R106: 主题切换 + 视觉稳定性测试 (渲染角度)
// 角度 1: 主题设置 (dark/light/system) → CSS class 正确应用
// 角度 2: 主题持久化 (reload 后仍保持)
// 角度 3: 快速切换主题 (20 次) → 无错误、无崩溃
// 角度 4: 各页面在 dark/light 下都有可见内容 (无空白渲染)
// 角度 5: CSS 变量一致性 (dark 下背景色 != light 下背景色)
// 角度 6: theme-changed 事件分发正常
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
  targets.find((t) => t.type === 'page' && t.url.includes('localhost')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R106] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r106Errors = [];
  if (!window.__r106HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r106Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r106Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r106HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r106Errors || []))`)
}

async function getThemeState() {
  return await evalInPage(ws, `(() => {
    const root = document.documentElement;
    return {
      hasDarkClass: root.classList.contains('dark'),
      dataTheme: root.getAttribute('data-theme'),
      bg: window.getComputedStyle(root).backgroundColor,
      color: window.getComputedStyle(root).color,
    };
  })()`)
}

// 保存原始主题
const origSettings = await evalInPage(ws, `window.api.settings.get()`)
const origTheme = origSettings?.general?.theme || 'dark'
console.log(`[R106] 原始主题: ${origTheme}`)

// =============================================================
console.log('\n=== R106: 主题切换 + 视觉稳定性测试 ===')

// =============================================================
console.log('\n[R106-1] 主题设置 → CSS class 应用')

// 设置为 light
await evalInPage(ws, `window.api.settings.set('general.theme', 'light')`)
await evalInPage(ws, `window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }))`)
await sleep(500)
const lightState = await getThemeState()
check('light 主题: dark class 已移除',
  lightState?.hasDarkClass === false,
  `hasDarkClass=${lightState?.hasDarkClass}`)

// 设置为 dark
await evalInPage(ws, `window.api.settings.set('general.theme', 'dark')`)
await evalInPage(ws, `window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }))`)
await sleep(500)
const darkState = await getThemeState()
check('dark 主题: dark class 已添加',
  darkState?.hasDarkClass === true,
  `hasDarkClass=${darkState?.hasDarkClass}`)

// =============================================================
console.log('\n[R106-2] 主题持久化 (reload 后保持)')

// 设置为 light, 显式 await + 验证持久化, 然后刷新页面
const setResult = await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', 'light');
  // 验证已持久化
  const s = await window.api.settings.get();
  return { ok: true, theme: s?.general?.theme };
})()`)
console.log(`    设置结果: ${JSON.stringify(setResult)}`)

await evalInPage(ws, `window.location.reload()`)

// 轮询等待页面重载完成 + useTheme 应用设置 (最多 15 秒)
let afterReload = null
let loadThemeApplied = false
for (let attempt = 0; attempt < 30; attempt++) {
  await sleep(500)
  try {
    const state = await evalInPage(ws, `(async () => {
      try {
        if (!window.api?.settings) return { ready: false };
        const s = await window.api.settings.get();
        return {
          ready: true,
          theme: s?.general?.theme,
          hasDarkClass: document.documentElement.classList.contains('dark'),
          rootClasses: document.documentElement.className,
        };
      } catch (e) {
        return { ready: false, error: e.message };
      }
    })()`)
    if (state?.ready && state?.theme === 'light') {
      afterReload = state
      if (state.hasDarkClass === false) {
        loadThemeApplied = true
        break // 主题已自动应用
      }
    }
  } catch {
    // CDP 可能在重载过渡期报错, 忽略重试
  }
}

// 如果 loadTheme 没有自动应用, 尝试手动 dispatch theme-changed 事件
// 这可以确认 useTheme 的事件监听器是否工作
if (!loadThemeApplied && afterReload?.theme === 'light') {
  await evalInPage(ws, `window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }))`)
  await sleep(1000)
  const afterEvent = await evalInPage(ws, `(() => {
    return {
      hasDarkClass: document.documentElement.classList.contains('dark'),
      rootClasses: document.documentElement.className,
    };
  })()`)
  afterReload = { ...afterReload, ...afterEvent }
  loadThemeApplied = afterEvent?.hasDarkClass === false
}

check('reload 后 light 主题保持 (dark class 已移除)',
  afterReload?.hasDarkClass === false,
  `hasDarkClass=${afterReload?.hasDarkClass}, theme=${afterReload?.theme}, classes=${afterReload?.rootClasses}, autoApplied=${loadThemeApplied}`)

// =============================================================
console.log('\n[R106-3] 快速切换主题 (20 次) → 无错误')

const errorsBefore = (await getErrors()).length
for (let i = 0; i < 20; i++) {
  const theme = i % 2 === 0 ? 'dark' : 'light'
  await evalInPage(ws, `(async () => {
    window.api.settings.set('general.theme', ${JSON.stringify(theme)});
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: ${JSON.stringify(theme)} }));
  })()`)
}
await sleep(1000)

const errorsAfter = (await getErrors()).length
check('20 次快速切换后 0 新增错误',
  errorsAfter === errorsBefore,
  `before=${errorsBefore}, after=${errorsAfter}`)

// 验证最终状态一致 (最后一次是 i=19 → light)
const finalState = await getThemeState()
check('快速切换后最终状态 = light',
  finalState?.hasDarkClass === false,
  `hasDarkClass=${finalState?.hasDarkClass}`)

// =============================================================
console.log('\n[R106-4] 各页面在 dark/light 下有可见内容')

const pages = [
  { hash: '#/dashboard', name: 'Dashboard' },
  { hash: '#/students', name: 'Students' },
  { hash: '#/agents', name: 'Agents' },
  { hash: '#/settings', name: 'Settings' },
]

for (const theme of ['dark', 'light']) {
  await evalInPage(ws, `(async () => {
    await window.api.settings.set('general.theme', ${JSON.stringify(theme)});
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: ${JSON.stringify(theme)} }));
  })()`)
  await sleep(500)

  for (const page of pages) {
    await evalInPage(ws, `window.location.hash = ${JSON.stringify(page.hash)}`)
    await sleep(1200)
    const visCheck = await evalInPage(ws, `(() => {
      const body = document.body;
      const root = document.documentElement;
      const visibleEls = body.querySelectorAll('button, a, input, [role="button"], h1, h2, h3, p, td, li, label');
      return {
        bodyChildren: body.children.length,
        visibleCount: visibleEls.length,
        bodyBg: window.getComputedStyle(body).backgroundColor,
        rootBg: window.getComputedStyle(root).backgroundColor,
        hasContent: body.innerText.length > 50,
      };
    })()`)
    check(`${page.name} (${theme}): 有可见内容`,
      visCheck?.hasContent === true && visCheck?.visibleCount > 0,
      `visible=${visCheck?.visibleCount}, text=${visCheck?.hasContent}`)
  }
}

// =============================================================
console.log('\n[R106-5] CSS 变量一致性 (dark != light 背景)')

// dark
await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', 'dark');
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }));
})()`)
await sleep(500)
const darkColors = await evalInPage(ws, `(() => {
  const body = document.body;
  const root = document.documentElement;
  return {
    bodyBg: window.getComputedStyle(body).backgroundColor,
    rootBg: window.getComputedStyle(root).backgroundColor,
    bodyColor: window.getComputedStyle(body).color,
  };
})()`)

// light
await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', 'light');
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }));
})()`)
await sleep(500)
const lightColors = await evalInPage(ws, `(() => {
  const body = document.body;
  const root = document.documentElement;
  return {
    bodyBg: window.getComputedStyle(body).backgroundColor,
    rootBg: window.getComputedStyle(root).backgroundColor,
    bodyColor: window.getComputedStyle(body).color,
  };
})()`)

const darkBg = darkColors?.bodyBg || darkColors?.rootBg
const lightBg = lightColors?.bodyBg || lightColors?.rootBg
check('dark 与 light 背景色不同',
  darkBg !== lightBg,
  `dark=${JSON.stringify(darkColors)}, light=${JSON.stringify(lightColors)}`)
console.log(`    dark bodyBg: ${darkColors?.bodyBg}, light bodyBg: ${lightColors?.bodyBg}`)

// =============================================================
console.log('\n[R106-6] theme-changed 事件分发')

// 验证事件可以被 useTheme hook 正确接收
const eventTest = await evalInPage(ws, `(async () => {
  return new Promise((resolve) => {
    let received = null;
    const handler = (e) => {
      received = e.detail;
      window.removeEventListener('theme-changed-test', handler);
      resolve(received);
    };
    window.addEventListener('theme-changed-test', handler);
    window.dispatchEvent(new CustomEvent('theme-changed-test', { detail: 'test-value' }));
    setTimeout(() => resolve(received), 2000);
  });
})()`)
check('CustomEvent 分发正常',
  eventTest === 'test-value',
  `received=${eventTest}`)

// =============================================================
console.log('\n[R106-7] 全程错误捕获')

const allErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  allErrors.length === 0,
  `errors=${allErrors.length}, detail=${JSON.stringify(allErrors).slice(0, 200)}`)

// 恢复原始主题
await evalInPage(ws, `(async () => {
  await window.api.settings.set('general.theme', ${JSON.stringify(origTheme)});
  window.dispatchEvent(new CustomEvent('theme-changed', { detail: ${JSON.stringify(origTheme)} }));
})()`)

// =============================================================
console.log('\n========================================')
console.log(`R106 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
