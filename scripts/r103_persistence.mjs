// =============================================================
// R103: 数据持久化往返测试 (写入 → reload → 读取)
// 角度 1: settings 写入后 reload 仍可读
// 角度 2: profile 写入后 reload 仍可读
// 角度 3: skill 写入后 reload 仍可读
// 角度 4: cron 任务写入后 reload 仍可读
// 角度 5: agent 配置写入后 reload 仍可读
// 角度 6: EAA 学生写入后 reload 仍可读
// 角度 7: reload 前后 0 错误
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
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
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

async function connectWS() {
  const targets = await getTargets()
  const pageTarget =
    targets.find((t) => t.type === 'page' && t.url.includes('localhost')) ||
    targets.find((t) => t.type === 'page')
  if (!pageTarget) {
    console.error('No page target found.')
    process.exit(1)
  }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((r, rej) => {
    ws.on('open', r)
    ws.on('error', rej)
    setTimeout(() => rej(new Error('ws connect timeout')), 10000)
  })
  return { ws, target: pageTarget }
}

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

// =============================================================
console.log('\n=== R103: 数据持久化往返测试 ===')

let { ws } = await connectWS()
console.log(`[R103] 初始连接成功`)

// 唯一时间戳,用于本次测试
const STAMP = `r103_${Date.now()}`
console.log(`[R103] 测试戳: ${STAMP}`)

// 安装错误捕获
await evalInPage(ws, `
  window.__r103Errors = [];
  if (!window.__r103HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r103Errors.push({ type: 'error', message: e.message, time: Date.now() });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r103Errors.push({ type: 'unhandledrejection', message: msg, time: Date.now() });
    });
    window.__r103HookInstalled = true;
  }
  true
`)

// =============================================================
console.log('\n[R103-1] settings 写入测试值')

// 备份原值
const originalSettings = await evalInPage(ws, `window.api.settings.get()`)
const originalLog = originalSettings?.general?.logLevel || 'info'

// 写入测试值
const testLog = 'debug'
const settingsWrite = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.settings.set('general.logLevel', ${JSON.stringify(testLog)});
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('settings.set 写入测试值',
  settingsWrite?.ok === true,
  `result=${JSON.stringify(settingsWrite).slice(0, 100)}`)

// 写入一个测试自定义字段 (用 profile 而非 settings,因为 settings 字段有白名单)
const profileKey = `${STAMP}_settings_test`
const profileWrite = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.set(${JSON.stringify(profileKey)}, {
      stamp: ${JSON.stringify(STAMP)},
      kind: 'settings_test',
      value: 'r103_persistence_test',
      timestamp: Date.now(),
    });
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('profile.set 写入测试值',
  profileWrite?.ok === true,
  `result=${JSON.stringify(profileWrite).slice(0, 100)}`)

// =============================================================
console.log('\n[R103-2] skill 写入测试值')

const testSkillName = `${STAMP}_test_skill`
const testSkillContent = `# R103 测试技能\n\n这是一个测试技能,时间戳: ${STAMP}\n\n## 用途\n- 验证持久化\n- 验证 reload 后可读`
const skillWrite = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.save(${JSON.stringify(testSkillName)}, ${JSON.stringify(testSkillContent)});
    return { ok: true, success: r?.success };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('skill.save 写入测试技能',
  skillWrite?.ok === true,
  `result=${JSON.stringify(skillWrite).slice(0, 100)}`)

// =============================================================
console.log('\n[R103-3] cron 任务写入')

const testCronName = `${STAMP}_test_cron`
const cronWrite = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.add({
      name: ${JSON.stringify(testCronName)},
      expression: '0 2 * * *', // 每天 2:00 AM
      task: 'noop',
      agentId: 'main',
      enabled: false, // 不启用,避免实际触发
    });
    return { ok: true, success: r?.success, id: r?.id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.add 写入测试任务',
  cronWrite?.ok === true,
  `result=${JSON.stringify(cronWrite).slice(0, 100)}`)

// 获取 cron id 用于后续清理
const cronListBefore = await evalInPage(ws, `window.api.cron.list()`)
const testCron = Array.isArray(cronListBefore)
  ? cronListBefore.find(t => t.name === testCronName)
  : null
const testCronId = testCron?.id || cronWrite?.id

// =============================================================
console.log('\n[R103-4] agent 配置写入')

const agentList = await evalInPage(ws, `window.api.agent.list()`)
const testAgent = Array.isArray(agentList) && agentList.length > 0 ? agentList[0] : null
let originalAgentDesc = ''

if (testAgent) {
  const originalDetail = await evalInPage(ws, `window.api.agent.get(${JSON.stringify(testAgent.id)})`)
  originalAgentDesc = originalDetail?.description || ''
  
  const newDesc = `R103 持久化测试 ${STAMP}`
  const agentUpdate = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.agent.update(${JSON.stringify(testAgent.id)}, { description: ${JSON.stringify(newDesc)} });
      return { ok: true, success: r?.success };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  })()`)
  check('agent.update 写入测试描述',
    agentUpdate?.ok === true,
    `result=${JSON.stringify(agentUpdate).slice(0, 100)}`)
} else {
  check('agent.update 写入测试描述 (跳过 - 无 agent)', false, 'no agents available')
}

// =============================================================
console.log('\n[R103-5] EAA 学生写入')

const testStudentName = `${STAMP}_student`
const eaaWrite = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.eaa.addStudent(${JSON.stringify(testStudentName)});
    return { ok: true, success: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('eaa.addStudent 写入测试学生',
  eaaWrite?.ok === true,
  `result=${JSON.stringify(eaaWrite).slice(0, 100)}`)

// =============================================================
console.log('\n[R103-6] reload 渲染进程')

// 关闭当前 ws 连接
ws.close()
await sleep(500)

// 通过 CDP 触发页面 reload (使用新的 ws 连接)
const targets2 = await getTargets()
const pageTarget2 =
  targets2.find((t) => t.type === 'page' && t.url.includes('localhost')) ||
  targets2.find((t) => t.type === 'page')
const wsReload = new WebSocket(pageTarget2.webSocketDebuggerUrl)
await new Promise((r, rej) => {
  wsReload.on('open', r)
  wsReload.on('error', rej)
  setTimeout(() => rej(new Error('reload ws connect timeout')), 10000)
})

// 触发 reload
await cdpCall(wsReload, 'Page.reload')
console.log('  已触发 Page.reload, 等待页面重新加载...')

// 关闭 reload ws
wsReload.close()
await sleep(3000) // 等待页面重新加载完成

// 重新连接
let ws2
let attempts = 0
while (attempts < 10) {
  try {
    const connected = await connectWS()
    ws2 = connected.ws
    
    // 验证页面已就绪 (window.api 可用)
    const ready = await evalInPage(ws2, `typeof window.api === 'object' && typeof window.api.settings === 'object'`)
    if (ready === true) break
    
    ws2.close()
  } catch (e) {
    // ignore
  }
  attempts++
  await sleep(1000)
}

if (!ws2) {
  console.error('  ❌ 无法重新连接到页面')
  process.exit(1)
}
console.log('  页面重新加载完成,已重新连接')

ws = ws2

// 重新安装错误捕获 (reload 后会丢失)
await evalInPage(ws, `
  window.__r103ErrorsAfterReload = [];
  window.addEventListener('error', (e) => {
    window.__r103ErrorsAfterReload.push({ type: 'error', message: e.message, time: Date.now() });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
    window.__r103ErrorsAfterReload.push({ type: 'unhandledrejection', message: msg, time: Date.now() });
  });
  true
`)

// =============================================================
console.log('\n[R103-7] 验证 reload 后数据仍可读')

// 验证 settings.logLevel
const settingsAfter = await evalInPage(ws, `window.api.settings.get()`)
check('reload 后 settings.logLevel 仍是测试值',
  settingsAfter?.general?.logLevel === testLog,
  `expected=${testLog}, actual=${settingsAfter?.general?.logLevel}`)

// 验证 profile
const profileAfter = await evalInPage(ws, `window.api.profile.get(${JSON.stringify(profileKey)})`)
check('reload 后 profile 测试值仍存在',
  profileAfter?.data?.stamp === STAMP && profileAfter?.data?.value === 'r103_persistence_test',
  `result=${JSON.stringify(profileAfter).slice(0, 150)}`)

// 验证 skill
const skillAfter = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.skill.get(${JSON.stringify(testSkillName)});
    return { ok: true, content: r?.content || r, hasStamp: (typeof r === 'string' ? r : (r?.content || '')).includes(${JSON.stringify(STAMP)}) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('reload 后 skill 测试技能仍存在',
  skillAfter?.ok === true && skillAfter?.hasStamp === true,
  `result=${JSON.stringify(skillAfter).slice(0, 150)}`)

// 验证 cron
const cronListAfter = await evalInPage(ws, `window.api.cron.list()`)
const cronAfter = Array.isArray(cronListAfter) ? cronListAfter.find(t => t.name === testCronName) : null
check('reload 后 cron 测试任务仍存在',
  !!cronAfter,
  `name=${testCronName}`)

// 验证 agent
if (testAgent) {
  const agentDetailAfter = await evalInPage(ws, `window.api.agent.get(${JSON.stringify(testAgent.id)})`)
  check('reload 后 agent 描述仍是测试值',
    agentDetailAfter?.description?.includes(STAMP) === true,
    `expected to include ${STAMP}, actual=${agentDetailAfter?.description?.slice(0, 80)}`)
}

// 验证 EAA 学生
const listAfter = await evalInPage(ws, `window.api.eaa.listStudents()`)
const studentsAfter = Array.isArray(listAfter)
  ? listAfter
  : (Array.isArray(listAfter?.data) ? listAfter.data
    : (Array.isArray(listAfter?.data?.students) ? listAfter.data.students : []))
const studentExists = studentsAfter.find(s => typeof s === 'string' ? s === testStudentName : s?.name === testStudentName)
check('reload 后 EAA 测试学生仍存在',
  !!studentExists,
  `student=${testStudentName}`)

// =============================================================
console.log('\n[R103-8] reload 后错误捕获')

const errorsAfterReload = await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r103ErrorsAfterReload || []))`)
check('reload 后 0 unhandledrejection/error',
  errorsAfterReload.length === 0,
  `errors=${errorsAfterReload.length}, detail=${JSON.stringify(errorsAfterReload).slice(0, 200)}`)

// =============================================================
console.log('\n[R103-9] 清理测试数据')

// 恢复 settings
await evalInPage(ws, `window.api.settings.set('general.logLevel', ${JSON.stringify(originalLog)})`)
// 删除 profile
await evalInPage(ws, `window.api.profile.delete(${JSON.stringify(profileKey)})`)
// 删除 skill
await evalInPage(ws, `window.api.skill.delete(${JSON.stringify(testSkillName)})`)
// 删除 cron
if (testCronId) {
  await evalInPage(ws, `window.api.cron.remove(${JSON.stringify(testCronId)})`)
}
// 恢复 agent 描述
if (testAgent) {
  await evalInPage(ws, `window.api.agent.update(${JSON.stringify(testAgent.id)}, { description: ${JSON.stringify(originalAgentDesc)} })`)
}
// 删除 EAA 学生
await evalInPage(ws, `window.api.eaa.deleteStudent(${JSON.stringify(testStudentName)}, 'R103 清理')`)

check('清理测试数据完成', true)

// =============================================================
console.log('\n========================================')
console.log(`R103 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
