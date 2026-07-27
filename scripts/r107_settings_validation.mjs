// =============================================================
// R107: Settings 校验 + 重置 + 大输入测试 (存储角度)
// 角度 1: 枚举字段校验 (非法值被拒绝, 合法值被接受)
// 角度 2: Settings reset → 所有字段回到默认
// 角度 3: 大输入 (长字符串) 不崩溃
// 角度 4: 无效路径 / 空路径 / 超长路径
// 角度 5: 类型不匹配 (boolean 字段传 string 等)
// 角度 6: Settings 并发写 (10 个并发 set 不同字段)
// 角度 7: Settings 持久化 (set → reload → verify)
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
console.log(`[R107] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r107Errors = [];
  if (!window.__r107HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r107Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r107Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r107HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r107Errors || []))`)
}

async function settingsSet(path, value) {
  return await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.settings.set(${JSON.stringify(path)}, ${JSON.stringify(value)});
      return { ok: r?.success !== false, error: r?.error || null };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
}

async function settingsGet() {
  return await evalInPage(ws, `window.api.settings.get()`)
}

// 保存原始设置
const origSettings = await settingsGet()
console.log(`[R107] 原始 logLevel: ${origSettings?.general?.logLevel}`)

// =============================================================
console.log('\n=== R107: Settings 校验 + 重置 + 大输入测试 ===')

// =============================================================
console.log('\n[R107-1] 枚举字段校验')

// 非法 theme 值
const badTheme = await settingsSet('general.theme', 'INVALID_THEME_XYZ')
check('非法 theme 值被拒绝',
  badTheme?.ok === false,
  `result=${JSON.stringify(badTheme)}`)

// 合法 theme 值
const goodTheme = await settingsSet('general.theme', 'dark')
check('合法 theme 值被接受',
  goodTheme?.ok === true,
  `result=${JSON.stringify(goodTheme)}`)

// 非法 logLevel
const badLog = await settingsSet('general.logLevel', 'VERBOSE')
check('非法 logLevel 值被拒绝',
  badLog?.ok === false,
  `result=${JSON.stringify(badLog)}`)

// 合法 logLevel
const goodLog = await settingsSet('general.logLevel', 'debug')
check('合法 logLevel 值被接受',
  goodLog?.ok === true,
  `result=${JSON.stringify(goodLog)}`)

// 非法 language
const badLang = await settingsSet('general.language', 'fr-FR')
check('非法 language 值被拒绝',
  badLang?.ok === false,
  `result=${JSON.stringify(badLang)}`)

// 合法 language
const goodLang = await settingsSet('general.language', 'zh-CN')
check('合法 language 值被接受',
  goodLang?.ok === true,
  `result=${JSON.stringify(goodLang)}`)

// 非法 closeBehavior
const badClose = await settingsSet('general.closeBehavior', 'minimize')
check('非法 closeBehavior 值被拒绝',
  badClose?.ok === false,
  `result=${JSON.stringify(badClose)}`)

// 合法 closeBehavior
const goodClose = await settingsSet('general.closeBehavior', 'tray')
check('合法 closeBehavior 值被接受',
  goodClose?.ok === true,
  `result=${JSON.stringify(goodClose)}`)

// =============================================================
console.log('\n[R107-2] Settings reset → 所有字段回到默认')

// 先修改几个字段
await settingsSet('general.logLevel', 'error')
await settingsSet('general.theme', 'light')
await settingsSet('general.language', 'en-US')

// 验证修改生效
const beforeReset = await settingsGet()
check('reset 前 logLevel=error',
  beforeReset?.general?.logLevel === 'error',
  `logLevel=${beforeReset?.general?.logLevel}`)

// 执行 reset
const resetResult = await evalInPage(ws, `window.api.settings.reset()`)
check('settings.reset 成功',
  resetResult?.success === true,
  `result=${JSON.stringify(resetResult).slice(0, 100)}`)

// 验证 reset 后回到默认
const afterReset = await settingsGet()
check('reset 后 logLevel 回到默认 (info)',
  afterReset?.general?.logLevel === 'info',
  `logLevel=${afterReset?.general?.logLevel}`)
check('reset 后 theme 回到默认 (dark)',
  afterReset?.general?.theme === 'dark',
  `theme=${afterReset?.general?.theme}`)
check('reset 后 language 回到默认 (zh-CN)',
  afterReset?.general?.language === 'zh-CN',
  `language=${afterReset?.general?.language}`)

// =============================================================
console.log('\n[R107-3] 大输入 (长字符串) 不崩溃')

// 10KB 字符串设置到 note 字段 (通过 profile)
const bigString = 'x'.repeat(10000)
const bigSet = await evalInPage(ws, `(async () => {
  try {
    await window.api.profile.set('r107_big_test', { data: ${JSON.stringify(bigString)} });
    const r = await window.api.profile.get('r107_big_test');
    return { ok: true, len: r?.data?.data?.length || 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('10KB profile 数据写入 + 读回成功',
  bigSet?.ok === true && bigSet?.len === 10000,
  `result=${JSON.stringify(bigSet).slice(0, 150)}`)

// 50KB skill 内容
const bigSkill = '# Big Skill\n' + 'y'.repeat(50000)
const bigSkillResult = await evalInPage(ws, `(async () => {
  try {
    await window.api.skill.save('r107_big_skill', ${JSON.stringify(bigSkill)});
    const r = await window.api.skill.get('r107_big_skill');
    return { ok: true, len: r?.length || r?.data?.length || 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('50KB skill 内容写入 + 读回成功',
  bigSkillResult?.ok === true,
  `result=${JSON.stringify(bigSkillResult).slice(0, 150)}`)

// 清理
await evalInPage(ws, `window.api.profile.set('r107_big_test', { _cleared: true })`)
await evalInPage(ws, `window.api.skill.delete('r107_big_skill')`)

// =============================================================
console.log('\n[R107-4] 无效路径 / 空路径 / 超长路径')

// 空路径
const emptyPath = await settingsSet('', 'value')
check('空路径不崩溃 (返回错误或忽略)',
  emptyPath !== null && emptyPath !== undefined,
  `result=${JSON.stringify(emptyPath).slice(0, 100)}`)

// 不存在的路径 (应该被忽略或创建)
const fakePath = await settingsSet('nonexistent.field.xyz', 'value')
check('不存在的路径不崩溃',
  fakePath !== null && fakePath !== undefined,
  `result=${JSON.stringify(fakePath).slice(0, 100)}`)

// 超长路径
const longPath = 'a'.repeat(1000) + '.field'
const longPathResult = await settingsSet(longPath, 'value')
check('超长路径不崩溃',
  longPathResult !== null && longPathResult !== undefined,
  `result=${JSON.stringify(longPathResult).slice(0, 100)}`)

// null 路径
const nullPath = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set(null, 'value');
    return { ok: r?.success !== false, error: r?.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('null 路径不崩溃',
  nullPath !== null && nullPath !== undefined,
  `result=${JSON.stringify(nullPath).slice(0, 100)}`)

// =============================================================
console.log('\n[R107-5] 类型不匹配')

// boolean 字段传 string
const typeMismatch = await settingsSet('general.autoStart', 'not_a_boolean')
check('boolean 字段传 string 不崩溃',
  typeMismatch !== null && typeMismatch !== undefined,
  `result=${JSON.stringify(typeMismatch).slice(0, 100)}`)

// 验证 settings 仍可读
const afterTypeMismatch = await settingsGet()
check('类型不匹配后 settings 仍可读',
  afterTypeMismatch && afterTypeMismatch.general,
  `result=${JSON.stringify(afterTypeMismatch).slice(0, 100)}`)

// =============================================================
console.log('\n[R107-6] Settings 并发写 (10 个并发 set 不同字段)')

const concurrentWrites = await evalInPage(ws, `(async () => {
  const writes = [
    window.api.settings.set('general.logLevel', 'debug'),
    window.api.settings.set('general.theme', 'dark'),
    window.api.settings.set('general.language', 'zh-CN'),
    window.api.settings.set('general.closeBehavior', 'ask'),
    window.api.settings.set('general.autoStart', false),
    window.api.settings.set('chat.thinkingLevel', 'off'),
    window.api.settings.set('chat.steeringMode', 'all'),
    window.api.settings.set('chat.followUpMode', 'all'),
    window.api.settings.set('chat.conversationLogging', false),
    window.api.settings.set('general.minimizeToTray', false),
  ];
  const results = await Promise.allSettled(writes);
  return results.map(r => ({
    status: r.status,
    ok: r.status === 'fulfilled' && r.value?.success !== false,
  }));
})()`)

const writeArray = Array.isArray(concurrentWrites) ? concurrentWrites : []
const successCount = writeArray.filter(r => r.ok).length
check(`10 个并发 settings 写完成 (${successCount}/10)`,
  successCount >= 8, // 允许少量失败
  `success=${successCount}/10, detail=${JSON.stringify(concurrentWrites).slice(0, 200)}`)

// 验证 settings.json 未损坏
const afterConcurrent = await settingsGet()
check('并发写后 settings.json 可读',
  afterConcurrent && afterConcurrent.general,
  `result=${JSON.stringify(afterConcurrent).slice(0, 100)}`)

// =============================================================
console.log('\n[R107-7] Settings 持久化 (set → reload → verify)')

// 设置一个特殊值
await settingsSet('general.logLevel', 'warn')
await sleep(300)

// 验证写入
const beforeReload = await settingsGet()
check('reload 前 logLevel=warn',
  beforeReload?.general?.logLevel === 'warn',
  `logLevel=${beforeReload?.general?.logLevel}`)

// Reload
await evalInPage(ws, `window.location.reload()`)

// 轮询等待重载完成
let afterReloadSettings = null
for (let attempt = 0; attempt < 20; attempt++) {
  await sleep(500)
  try {
    const s = await settingsGet()
    if (s && s.general) {
      afterReloadSettings = s
      break
    }
  } catch {
    // 重载过渡期
  }
}

check('reload 后 logLevel 仍是 warn',
  afterReloadSettings?.general?.logLevel === 'warn',
  `logLevel=${afterReloadSettings?.general?.logLevel}`)

// =============================================================
console.log('\n[R107-8] 全程错误捕获')

const allErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  allErrors.length === 0,
  `errors=${allErrors.length}, detail=${JSON.stringify(allErrors).slice(0, 200)}`)

// 恢复原始设置
await settingsSet('general.logLevel', origSettings?.general?.logLevel || 'info')
await settingsSet('general.theme', origSettings?.general?.theme || 'dark')
await settingsSet('general.language', origSettings?.general?.language || 'zh-CN')
await settingsSet('general.closeBehavior', origSettings?.general?.closeBehavior || 'ask')
await settingsSet('general.autoStart', origSettings?.general?.autoStart ?? false)
await settingsSet('general.minimizeToTray', origSettings?.general?.minimizeToTray ?? false)

// =============================================================
console.log('\n========================================')
console.log(`R107 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
