// =============================================================
// R126: 边界错误注入测试 (非法输入/异常路径/资源耗尽)
// 角度 1: EAA 非法学生名 (空/null/超长/特殊字符/SQL 注入)
// 角度 2: EAA 非法事件 (不存在学生/无效 reasonCode/缺失字段)
// 角度 3: Settings 非法路径 (不存在 dotPath/空/超长值)
// 角度 4: Skill 非法操作 (不存在的 skill/null name/超长内容)
// 角度 5: Agent 非法 ID (空/null/超长/不存在)
// 角度 6: Cron 非法表达式 (空/格式错误/超长)
// 角度 7: MCP 非法配置 (空 serverId/null/超长)
// 角度 8: AI 非法 provider (空/null/不存在的 id)
// 角度 9: 资源耗尽模拟 (大批量 addEvent 1000 次)
// 角度 10: 错误捕获 + 应用稳定性
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
    }, 60000)
  })
}

async function evalInPage(ws, expr) {
  const r = await cdpCall(ws, 'Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    timeout: 55000,
  })
  if (r.exceptionDetails) return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
if (!pageTarget) { console.error('No page target found.'); process.exit(1) }
console.log(`[R126] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('ws connect timeout')), 10000) })

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ✅ ${name}`) }
  else { results.fail++; results.errors.push(name); console.log(`  ❌ ${name} ${detail}`) }
}

await evalInPage(ws, `
  window.__r126Errors = [];
  if (!window.__r126HookInstalled) {
    window.addEventListener('error', (e) => { window.__r126Errors.push({ type: 'error', message: e.message }); });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r126Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r126HookInstalled = true;
  }
  true
`)
async function getErrors() { return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r126Errors || []))`) }

const STAMP = `r126-${Date.now()}`
console.log('\n=== R126: 边界错误注入测试 ===')

// 辅助函数: 执行 IPC 调用并捕获错误
async function tryIPC(jsExpr) {
  return await evalInPage(ws, `(async () => {
    try {
      const r = ${jsExpr};
      const resolved = await r;
      return { handled: true, threw: false, result: resolved };
    } catch (e) {
      return { handled: true, threw: true, error: e.message };
    }
  })()`)
}

// =============================================================
console.log('\n[R126-1] EAA 非法学生名 (空/null/超长/特殊字符/SQL 注入)')

const illegalNames = [
  '',
  null,
  undefined,
  'a'.repeat(5000), // 超长
  '../../../etc/passwd', // 路径穿越
  "'; DROP TABLE students; --", // SQL 注入
  '<script>alert(1)</script>', // XSS
  '\x00\x01\x02', // 控制字符
  'name with spaces',
  'name"with"quotes',
  "name'with'apostrophes",
  'name\nwith\nnewlines',
]

let eaaRejectCount = 0
let eaaHandledCount = 0
for (const name of illegalNames) {
  const r = await tryIPC(`window.api.eaa.addStudent(${JSON.stringify(name)})`)
  if (r?.handled) eaaHandledCount++
  // 非法名应被拒绝 (success=false 或抛错), 不应崩溃应用
  const rejected = r?.threw === true || r?.result?.success === false
  if (rejected) eaaRejectCount++
}
check(`EAA 非法学生名 ${illegalNames.length} 种全部被处理 (不崩溃)`,
  eaaHandledCount === illegalNames.length,
  `handled=${eaaHandledCount}/${illegalNames.length}`)
check(`EAA 大部分非法学生名被拒绝 (>=${Math.floor(illegalNames.length * 0.6)})`,
  eaaRejectCount >= Math.floor(illegalNames.length * 0.6),
  `rejected=${eaaRejectCount}/${illegalNames.length}`)

// =============================================================
console.log('\n[R126-2] EAA 非法事件 (不存在学生/无效 reasonCode/缺失字段)')

const illegalEvents = [
  { studentName: '', reasonCode: 'SPEAK_IN_CLASS' },
  { studentName: null, reasonCode: 'SPEAK_IN_CLASS' },
  { studentName: `${STAMP}-nonexistent`, reasonCode: 'SPEAK_IN_CLASS' },
  { studentName: 'test', reasonCode: '' }, // 空 reasonCode
  { studentName: 'test', reasonCode: null },
  { studentName: 'test', reasonCode: 'INVALID_CODE_999' },
  { studentName: 'test' }, // 缺失 reasonCode
  { reasonCode: 'SPEAK_IN_CLASS' }, // 缺失 studentName
  {}, // 完全空
  { studentName: 'a'.repeat(10000), reasonCode: 'SPEAK_IN_CLASS' },
]

let eventRejectCount = 0
let eventHandledCount = 0
for (const params of illegalEvents) {
  const r = await tryIPC(`window.api.eaa.addEvent(${JSON.stringify(params)})`)
  if (r?.handled) eventHandledCount++
  const rejected = r?.threw === true || r?.result?.success === false
  if (rejected) eventRejectCount++
}
check(`EAA 非法事件 ${illegalEvents.length} 种全部被处理`,
  eventHandledCount === illegalEvents.length,
  `handled=${eventHandledCount}/${illegalEvents.length}`)
check(`EAA 大部分非法事件被拒绝`,
  eventRejectCount >= Math.floor(illegalEvents.length * 0.6),
  `rejected=${eventRejectCount}/${illegalEvents.length}`)

// =============================================================
console.log('\n[R126-3] Settings 非法路径 (不存在 dotPath/空/超长值)')

const illegalSettings = [
  ['', 'value'], // 空 path
  [null, 'value'],
  ['nonexistent.deep.path', 'value'], // 不存在 path
  ['general.theme', null], // null 值
  ['general.theme', undefined],
  ['general.theme', { deep: { nested: 'a'.repeat(10000) } }], // 超长嵌套值
  ['general.theme', 'a'.repeat(100000)], // 超长字符串
]

let settingsHandledCount = 0
for (const [path, value] of illegalSettings) {
  const r = await tryIPC(`window.api.settings.set(${JSON.stringify(path)}, ${JSON.stringify(value)})`)
  if (r?.handled) settingsHandledCount++
}
check(`Settings 非法输入 ${illegalSettings.length} 种全部被处理`,
  settingsHandledCount === illegalSettings.length,
  `handled=${settingsHandledCount}/${illegalSettings.length}`)

// 恢复 theme
await evalInPage(ws, `(async () => { try { await window.api.settings.set('general.theme', 'dark'); } catch {} return true; })()`)

// =============================================================
console.log('\n[R126-4] Skill 非法操作 (不存在的 skill/null name/超长内容)')

const illegalSkillOps = [
  () => tryIPC(`window.api.skill.get('')`),
  () => tryIPC(`window.api.skill.get(null)`),
  () => tryIPC(`window.api.skill.get('nonexistent-skill-' + Date.now())`),
  () => tryIPC(`window.api.skill.save('', 'content')`),
  () => tryIPC(`window.api.skill.save(null, 'content')`),
  () => tryIPC(`window.api.skill.save('test', null)`),
  () => tryIPC(`window.api.skill.save('test', 'a'.repeat(1000000))`), // 1MB 内容
  () => tryIPC(`window.api.skill.delete('')`),
  () => tryIPC(`window.api.skill.delete(null)`),
  () => tryIPC(`window.api.skill.delete('nonexistent-skill-' + Date.now())`),
]

let skillHandledCount = 0
for (const op of illegalSkillOps) {
  const r = await op()
  if (r?.handled) skillHandledCount++
}
check(`Skill 非法操作 ${illegalSkillOps.length} 种全部被处理`,
  skillHandledCount === illegalSkillOps.length,
  `handled=${skillHandledCount}/${illegalSkillOps.length}`)

// 清理可能创建的 test skill
await evalInPage(ws, `(async () => { try { await window.api.skill.delete('test'); } catch {} return true; })()`)

// =============================================================
console.log('\n[R126-5] Agent 非法 ID (空/null/超长/不存在)')

const illegalAgentIds = [
  '',
  null,
  undefined,
  'a'.repeat(10000),
  'nonexistent-agent-id-' + Date.now(),
  "'; DROP TABLE agents; --",
  '<script>alert(1)</script>',
]

let agentHandledCount = 0
for (const id of illegalAgentIds) {
  const r = await tryIPC(`window.api.agent.get(${JSON.stringify(id)})`)
  if (r?.handled) agentHandledCount++
}
check(`Agent 非法 ID ${illegalAgentIds.length} 种全部被处理`,
  agentHandledCount === illegalAgentIds.length,
  `handled=${agentHandledCount}/${illegalAgentIds.length}`)

// =============================================================
console.log('\n[R126-6] Cron 非法表达式 (空/格式错误/超长)')

const illegalCrons = [
  { name: 'test', expression: '', agentId: 'main', modelTier: 'low_cost' },
  { name: 'test', expression: null, agentId: 'main', modelTier: 'low_cost' },
  { name: 'test', expression: 'invalid-cron-expr', agentId: 'main', modelTier: 'low_cost' },
  { name: 'test', expression: '* * * * * * * * *', agentId: 'main', modelTier: 'low_cost' }, // 太多字段
  { name: 'test', expression: 'a'.repeat(10000), agentId: 'main', modelTier: 'low_cost' },
  { name: '', expression: '0 * * * *', agentId: 'main', modelTier: 'low_cost' }, // 空 name
  { name: null, expression: '0 * * * *', agentId: 'main', modelTier: 'low_cost' },
  { name: 'test', expression: '0 * * * *', agentId: '', modelTier: 'low_cost' }, // 空 agentId
  {}, // 完全空
  { name: 'test', expression: '0 * * * *', agentId: 'main', modelTier: 'invalid-tier' },
]

let cronHandledCount = 0
let cronRejectCount = 0
for (const task of illegalCrons) {
  const r = await tryIPC(`window.api.cron.add(${JSON.stringify(task)})`)
  if (r?.handled) cronHandledCount++
  const rejected = r?.threw === true || r?.result?.success === false || r?.result?.error
  if (rejected) cronRejectCount++
}
check(`Cron 非法表达式 ${illegalCrons.length} 种全部被处理`,
  cronHandledCount === illegalCrons.length,
  `handled=${cronHandledCount}/${illegalCrons.length}`)
check(`Cron 大部分非法表达式被拒绝`,
  cronRejectCount >= Math.floor(illegalCrons.length * 0.6),
  `rejected=${cronRejectCount}/${illegalCrons.length}`)

// =============================================================
console.log('\n[R126-7] MCP 非法配置 (空 serverId/null/超长)')

const illegalMcpOps = [
  () => tryIPC(`window.api.mcp.listTools('')`),
  () => tryIPC(`window.api.mcp.listTools(null)`),
  () => tryIPC(`window.api.mcp.listTools('nonexistent-server-' + Date.now())`),
  () => tryIPC(`window.api.mcp.connect('')`),
  () => tryIPC(`window.api.mcp.connect(null)`),
  () => tryIPC(`window.api.mcp.connect('nonexistent-server-' + Date.now())`),
  () => tryIPC(`window.api.mcp.disconnect('')`),
  () => tryIPC(`window.api.mcp.test('')`),
  () => tryIPC(`window.api.mcp.test(null)`),
  () => tryIPC(`window.api.mcp.test('nonexistent-' + Date.now())`),
]

let mcpHandledCount = 0
for (const op of illegalMcpOps) {
  const r = await op()
  if (r?.handled) mcpHandledCount++
}
check(`MCP 非法配置 ${illegalMcpOps.length} 种全部被处理`,
  mcpHandledCount === illegalMcpOps.length,
  `handled=${mcpHandledCount}/${illegalMcpOps.length}`)

// =============================================================
console.log('\n[R126-8] AI 非法 provider (空/null/不存在的 id)')

const illegalAiOps = [
  () => tryIPC(`window.api.ai.listModels('')`),
  () => tryIPC(`window.api.ai.listModels(null)`),
  () => tryIPC(`window.api.ai.listModels('nonexistent-provider-' + Date.now())`),
  () => tryIPC(`window.api.ai.testConnection('', 'fake-key')`),
  () => tryIPC(`window.api.ai.testConnection(null, 'fake-key')`),
  () => tryIPC(`window.api.ai.testConnection('nonexistent', 'fake-key')`),
  () => tryIPC(`window.api.ai.setApiKey('', 'fake-key')`),
  () => tryIPC(`window.api.ai.setApiKey(null, 'fake-key')`),
  () => tryIPC(`window.api.ai.deleteApiKey('')`),
  () => tryIPC(`window.api.ai.deleteApiKey(null)`),
]

let aiHandledCount = 0
for (const op of illegalAiOps) {
  const r = await op()
  if (r?.handled) aiHandledCount++
}
check(`AI 非法 provider ${illegalAiOps.length} 种全部被处理`,
  aiHandledCount === illegalAiOps.length,
  `handled=${aiHandledCount}/${illegalAiOps.length}`)

// =============================================================
console.log('\n[R126-9] 资源耗尽模拟 (100 学生 × 10 reason-code = 1000 事件)')

// EAA 业务规则: 同一学生今日同一 reason-code 不能重复。
// 因此用 100 个不同学生 × 10 种 reason-code = 1000 个事件, 既压力又合规。
const stressStudents = []
for (let i = 0; i < 100; i++) stressStudents.push(`${STAMP}-stress-${i}`)
const stressCodes = ['SPEAK_IN_CLASS', 'SLEEP_IN_CLASS', 'LATE', 'MAKEUP', 'DESK_UNALIGNED',
  'ACTIVITY_PARTICIPATION', 'CLASS_COMMITTEE', 'CIVILIZED_DORM', 'MONTHLY_ATTENDANCE', 'OTHER_DEDUCT']

// 批量创建 100 个学生 (捕获错误用于诊断)
const stressCreate = await evalInPage(ws, `(async () => {
  const names = ${JSON.stringify(stressStudents)};
  let ok = 0, fail = 0;
  const failSamples = [];
  for (const n of names) {
    try {
      const r = await window.api.eaa.addStudent(n);
      if (r?.success !== false) ok++;
      else {
        fail++;
        if (failSamples.length < 3) failSamples.push({ name: n, data: (r?.data || '').slice(0, 100), stderr: (r?.stderr || '').slice(0, 100) });
      }
    } catch (e) {
      fail++;
      if (failSamples.length < 3) failSamples.push({ name: n, threw: e.message?.slice(0, 100) });
    }
  }
  return { ok, fail, failSamples };
})()`)
console.log(`  [R126-9] 学生创建: ok=${stressCreate?.ok}, fail=${stressCreate?.fail}`)
if (stressCreate?.fail > 0) {
  console.log(`  [R126-9] 创建失败样本: ${JSON.stringify(stressCreate?.failSamples).slice(0, 400)}`)
}

// 验证学生创建成功: 用 score() 逐个查 (list-students 在数据量大时有截断, 见 project_memory)
const stressVerify = await evalInPage(ws, `(async () => {
  const names = ${JSON.stringify(stressStudents)};
  let found = 0;
  const failSamples = [];
  for (const n of names) {
    try {
      const r = await window.api.eaa.score(n);
      if (r?.success !== false && r?.data?.name === n) found++;
      else if (failSamples.length < 3) failSamples.push({ name: n, data: JSON.stringify(r?.data || '').slice(0, 80) });
    } catch (e) { if (failSamples.length < 3) failSamples.push({ name: n, threw: e.message?.slice(0, 80) }); }
  }
  return { found, failSamples };
})()`)
check(`资源耗尽前置: 100 个学生全部创建成功 (score 验证)`,
  stressVerify?.found === 100,
  `found=${stressVerify?.found}/100, failSamples=${JSON.stringify(stressVerify?.failSamples || []).slice(0, 300)}`)

// 1000 次 addEvent (100 学生 × 10 codes), 分批并发
const stressResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const failSamples = [];
  let success = 0;
  let failed = 0;
  const students = ${JSON.stringify(stressStudents)};
  const codes = ${JSON.stringify(stressCodes)};
  // 50 个事件为一批, 共 20 批
  const batchSize = 50;
  for (let batch = 0; batch < 20; batch++) {
    const promises = [];
    for (let i = 0; i < batchSize; i++) {
      const idx = batch * batchSize + i;
      const studentName = students[idx % students.length];
      const reasonCode = codes[Math.floor(idx / students.length) % codes.length];
      promises.push(window.api.eaa.addEvent({
        studentName,
        reasonCode,
        note: 'R126 stress ' + idx,
        operator: 'r126-stress',
        tags: ['r126', 'stress'],
      }).then(r => {
        if (r?.success !== false) success++;
        else {
          failed++;
          if (failSamples.length < 3) failSamples.push({ idx, student: studentName, code: reasonCode, data: (r?.data || '').slice(0, 120), stderr: (r?.stderr || '').slice(0, 120) });
        }
      })
      .catch(e => { errors.push(e.message); failed++; }));
    }
    await Promise.all(promises);
  }
  return { success, failed, errorCount: errors.length, sampleErrors: errors.slice(0, 3), failSamples };
})()`)
check(`资源耗尽测试: 1000 次 addEvent 不崩溃 (success=${stressResult?.success}, failed=${stressResult?.failed})`,
  stressResult?.success + stressResult?.failed === 1000,
  `result=${JSON.stringify(stressResult).slice(0, 200)}`)
check(`资源耗尽测试: 大部分事件成功 (>=800)`,
  stressResult?.success >= 800,
  `success=${stressResult?.success}/1000, failSamples=${JSON.stringify(stressResult?.failSamples || []).slice(0, 400)}`)

// 验证 history 能查到事件 (取第一个学生)
const stressHistory = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.history(${JSON.stringify(stressStudents[0])});
    const events = r?.data?.events ?? r?.events ?? [];
    return { count: events.length, ok: events.length > 0 };
  } catch (e) { return { count: 0, ok: false, error: e.message }; }
})()`)
check(`资源耗尽后 history 仍能查询 (events=${stressHistory?.count})`,
  stressHistory?.count > 0,
  `result=${JSON.stringify(stressHistory).slice(0, 150)}`)

// 清理 100 个学生
await evalInPage(ws, `(async () => {
  const names = ${JSON.stringify(stressStudents)};
  for (const n of names) { try { await window.api.eaa.deleteStudent(n); } catch {} }
  return true;
})()`)

// =============================================================
console.log('\n[R126-10] 错误捕获 + 应用稳定性')

const finalErrors = await getErrors()
check('边界错误注入测试期间 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// 验证应用仍可正常响应
const stableCheck = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.listStudents();
    return { ok: r?.success === true };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('错误注入后应用仍可正常响应 (listStudents)',
  stableCheck?.ok === true,
  `result=${JSON.stringify(stableCheck)}`)

// =============================================================
console.log('\n========================================')
console.log(`R126 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
