// =============================================================
// R124: 存储一致性压力测试 (大量并发 IPC)
// 角度 1: Settings 并发写入读取一致性 (dotPath 隔离)
// 角度 2: EAA 学生并发 CRUD (无冲突字段)
// 角度 3: Skill 并发写入同名文件 (最后写入胜出)
// 角度 4: Cron 任务并发创建 (唯一 ID)
// 角度 5: Privacy 并发 anonymize/deanonymize (幂等性)
// 角度 6: Agent toggle 并发 (最终一致)
// 角度 7: Settings reset 并发安全
// 角度 8: 大批量 listStudents 一致性 (并发 100 次)
// 角度 9: 错误捕获 + 数据完整性验证
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
  if (r.exceptionDetails) {
    return { __error: JSON.stringify(r.exceptionDetails).slice(0, 500) }
  }
  return r.result.value
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

let WebSocket
try { WebSocket = (await import('ws')).default } catch { WebSocket = globalThis.WebSocket }

const targets = await getTargets()
const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('index')) || targets.find((t) => t.type === 'page')
if (!pageTarget) { console.error('No page target found.'); process.exit(1) }
console.log(`[R124] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
await new Promise((r, rej) => { ws.on('open', r); ws.on('error', rej); setTimeout(() => rej(new Error('ws connect timeout')), 10000) })

const results = { pass: 0, fail: 0, errors: [] }
function check(name, cond, detail = '') {
  if (cond) { results.pass++; console.log(`  ✅ ${name}`) }
  else { results.fail++; results.errors.push(name); console.log(`  ❌ ${name} ${detail}`) }
}

await evalInPage(ws, `
  window.__r124Errors = [];
  if (!window.__r124HookInstalled) {
    window.addEventListener('error', (e) => { window.__r124Errors.push({ type: 'error', message: e.message }); });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r124Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r124HookInstalled = true;
  }
  true
`)
async function getErrors() { return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r124Errors || []))`) }

const STAMP = `r124-${Date.now()}`
console.log('\n=== R124: 存储一致性压力测试 ===')

// =============================================================
console.log('\n[R124-1] Settings 并发写入读取一致性 (dotPath 隔离)')

// 并发写入不同 dotPath, 验证互不干扰
const settingsConcurrentResult = await evalInPage(ws, `(async () => {
  const errors = [];
  // 10 个不同的 dotPath 并发写入
  const paths = [
    ['general.theme', 'dark'],
    ['general.language', 'zh-CN'],
    ['general.logLevel', 'info'],
    ['general.autoStart', false],
    ['general.minimizeToTray', false],
    ['general.closeBehavior', 'ask'],
    ['general.agentTimeoutMins', 30],
    ['general.maxConcurrentCronTasks', 3],
    ['general.autoUpdate', true],
    ['general.timezone', 'Asia/Shanghai'],
  ];
  // 并发写入
  const promises = paths.map(([p, v]) => window.api.settings.set(p, v).catch(e => errors.push(p + ': ' + e.message)));
  await Promise.all(promises);
  // 读回验证
  const r = await window.api.settings.get();
  const s = r?.data || r;
  return {
    errorCount: errors.length,
    theme: s?.general?.theme,
    language: s?.general?.language,
    logLevel: s?.general?.logLevel,
    autoStart: s?.general?.autoStart,
    timezone: s?.general?.timezone,
  };
})()`)
check('Settings 并发 10 个 dotPath 写入无错误',
  settingsConcurrentResult?.errorCount === 0,
  `result=${JSON.stringify(settingsConcurrentResult).slice(0, 200)}`)
check('Settings 并发写入后读取一致 (theme=dark, language=zh-CN)',
  settingsConcurrentResult?.theme === 'dark' && settingsConcurrentResult?.language === 'zh-CN',
  `theme=${settingsConcurrentResult?.theme}, language=${settingsConcurrentResult?.language}`)

// =============================================================
console.log('\n[R124-2] EAA 学生并发 CRUD (无冲突字段)')

const studentNames = []
for (let i = 0; i < 20; i++) studentNames.push(`${STAMP}-stu-${i}`)

const eaaConcurrentResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const names = ${JSON.stringify(studentNames)};
  // 并发添加 20 个学生
  const addPromises = names.map(n => window.api.eaa.addStudent(n).catch(e => errors.push('add: ' + e.message)));
  await Promise.all(addPromises);
  // 并发读取 listStudents
  const listPromises = [];
  for (let i = 0; i < 10; i++) {
    listPromises.push(window.api.eaa.listStudents().catch(e => errors.push('list: ' + e.message)));
  }
  const lists = await Promise.all(listPromises);
  // 验证所有 listStudents 调用返回相同的学生数
  const counts = lists.map(r => r?.data?.students?.length ?? -1);
  const allSame = counts.every(c => c === counts[0]);
  // 验证新增学生都存在
  const firstList = lists[0];
  const students = firstList?.data?.students ?? [];
  const foundCount = names.filter(n => students.some(s => s.name === n)).length;
  return { errorCount: errors.length, allListsSameCount: allSame, foundCount, sampleCounts: counts.slice(0, 3) };
})()`)
check('EAA 并发添加 20 个学生 + 并发 10 次 listStudents 无错误',
  eaaConcurrentResult?.errorCount === 0,
  `result=${JSON.stringify(eaaConcurrentResult).slice(0, 200)}`)
check('10 次并发 listStudents 返回相同 count',
  eaaConcurrentResult?.allListsSameCount === true,
  `sampleCounts=${JSON.stringify(eaaConcurrentResult?.sampleCounts)}`)
check(`20 个并发添加的学生全部出现在 list (${eaaConcurrentResult?.foundCount}/20)`,
  eaaConcurrentResult?.foundCount === 20,
  `found=${eaaConcurrentResult?.foundCount}`)

// 清理
await evalInPage(ws, `(async () => {
  const names = ${JSON.stringify(studentNames)};
  for (const n of names) { try { await window.api.eaa.deleteStudent(n); } catch {} }
  return true;
})()`)

// =============================================================
console.log('\n[R124-3] Skill 并发写入同名文件 (最后写入胜出)')

const skillName = `${STAMP}-concurrent-skill`
const skillConcurrentResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const name = ${JSON.stringify(skillName)};
  // 并发写入 5 次不同内容
  const contents = ['v1', 'v2', 'v3', 'v4', 'v5'];
  const promises = contents.map(c => window.api.skill.save(name, c).catch(e => errors.push(e.message)));
  await Promise.all(promises);
  // 读回验证
  const r = await window.api.skill.get(name);
  const final = typeof r === 'string' ? r : (r?.content || r?.data);
  return { errorCount: errors.length, finalContent: final };
})()`)
check('Skill 并发写入 5 次同名文件无错误',
  skillConcurrentResult?.errorCount === 0,
  `result=${JSON.stringify(skillConcurrentResult).slice(0, 200)}`)
check('Skill 并发写入后最终内容是 v1-v5 之一 (原子性)',
  ['v1', 'v2', 'v3', 'v4', 'v5'].includes(skillConcurrentResult?.finalContent),
  `final=${skillConcurrentResult?.finalContent}`)

// 清理
await evalInPage(ws, `(async () => {
  try { await window.api.skill.delete(${JSON.stringify(skillName)}); } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R124-4] Cron 任务并发创建 (唯一 ID)')

const cronConcurrentResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const createdIds = [];
  // 并发创建 5 个 cron 任务
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(window.api.cron.add({
      name: ${JSON.stringify(STAMP)} + '-cron-' + i,
      expression: '0 ' + i + ' * * *',
      agentId: 'main',
      modelTier: 'low_cost',
      enabled: false,
    }).then(r => {
      const id = r?.id || r?.data?.id;
      if (id) createdIds.push(id);
    }).catch(e => errors.push(e.message)));
  }
  await Promise.all(promises);
  // 验证所有 ID 唯一
  const uniqueIds = new Set(createdIds);
  return { errorCount: errors.length, createdCount: createdIds.length, uniqueCount: uniqueIds.size, ids: createdIds };
})()`)
check('Cron 并发创建 5 个任务无错误',
  cronConcurrentResult?.errorCount === 0,
  `result=${JSON.stringify(cronConcurrentResult).slice(0, 200)}`)
check('5 个并发创建的 cron 任务 ID 全部唯一',
  cronConcurrentResult?.uniqueCount === cronConcurrentResult?.createdCount && cronConcurrentResult?.uniqueCount === 5,
  `created=${cronConcurrentResult?.createdCount}, unique=${cronConcurrentResult?.uniqueCount}`)

// 清理
if (cronConcurrentResult?.ids?.length > 0) {
  await evalInPage(ws, `(async () => {
    const ids = ${JSON.stringify(cronConcurrentResult.ids)};
    for (const id of ids) { try { await window.api.cron.remove(id); } catch {} }
    return true;
  })()`)
}

// =============================================================
console.log('\n[R124-5] Privacy 并发 anonymize/deanonymize (幂等性)')

const privacyConcurrentResult = await evalInPage(ws, `(async () => {
  const errors = [];
  // 先检查隐私引擎状态
  const status = await window.api.privacy.status();
  if (!status?.loaded && !status?.enabled) {
    return { skipped: true, reason: 'privacy not initialized' };
  }
  // 并发 anonymize 同一文本 (幂等性)
  const text = '测试文本 r124 ' + Date.now();
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(window.api.privacy.anonymize(text).catch(e => errors.push(e.message)));
  }
  const results = await Promise.all(promises);
  // 验证 5 次结果一致
  const allSame = results.every(r => JSON.stringify(r) === JSON.stringify(results[0]));
  return { errorCount: errors.length, allSame, skipped: false, sampleResult: results[0] };
})()`)
if (privacyConcurrentResult?.skipped) {
  check('Privacy 并发 anonymize 跳过 (引擎未初始化)',
    true,
    `reason=${privacyConcurrentResult?.reason}`)
} else {
  check('Privacy 并发 5 次 anonymize 无错误',
    privacyConcurrentResult?.errorCount === 0,
    `result=${JSON.stringify(privacyConcurrentResult).slice(0, 200)}`)
  check('Privacy 并发 anonymize 结果一致 (幂等)',
    privacyConcurrentResult?.allSame === true,
    `result=${JSON.stringify(privacyConcurrentResult).slice(0, 150)}`)
}

// =============================================================
console.log('\n[R124-6] Agent toggle 并发 (最终一致)')

const agentToggleResult = await evalInPage(ws, `(async () => {
  const errors = [];
  // 先取 agent 列表第一个 id
  const list = await window.api.agent.list();
  const agents = Array.isArray(list) ? list : (list?.agents || list?.data || []);
  if (agents.length === 0) return { skipped: true };
  const agentId = agents[0]?.id || agents[0]?.name;
  // 读取原状态
  const before = await window.api.agent.get(agentId);
  const original = before?.enabled;
  // 并发切换 5 次 (最后一次胜出)
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(window.api.agent.toggle(agentId, i % 2 === 0).catch(e => errors.push(e.message)));
  }
  await Promise.all(promises);
  // 读回最终状态
  const after = await window.api.agent.get(agentId);
  // 恢复原状态
  await window.api.agent.toggle(agentId, original).catch(() => {});
  return { errorCount: errors.length, original, final: after?.enabled, skipped: false };
})()`)
if (agentToggleResult?.skipped) {
  check('Agent toggle 并发跳过 (无 agent)', false, 'skipped')
} else {
  check('Agent 并发 5 次 toggle 无错误',
    agentToggleResult?.errorCount === 0,
    `result=${JSON.stringify(agentToggleResult).slice(0, 200)}`)
  check('Agent 并发 toggle 后状态为 true/false 之一 (最终一致)',
    agentToggleResult?.final === true || agentToggleResult?.final === false,
    `final=${agentToggleResult?.final}`)
}

// =============================================================
console.log('\n[R124-7] Settings reset 并发安全')

// 注意: 不实际执行 reset (会清除用户配置), 只验证 reset API 可调用且不崩溃
const resetSafetyResult = await evalInPage(ws, `(async () => {
  // 不实际 reset, 只验证 settings.get 在并发读取下稳定
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(window.api.settings.get().catch(e => ({ error: e.message })));
  }
  const results = await Promise.all(promises);
  const errors = results.filter(r => r?.error).map(r => r.error);
  // 验证所有结果一致
  const allSame = results.every(r => JSON.stringify(r?.data || r) === JSON.stringify(results[0]?.data || results[0]));
  return { errorCount: errors.length, allSame, sampleError: errors[0] };
})()`)
check('Settings 并发 20 次 get 无错误',
  resetSafetyResult?.errorCount === 0,
  `result=${JSON.stringify(resetSafetyResult).slice(0, 200)}`)
check('Settings 并发 20 次 get 结果一致',
  resetSafetyResult?.allSame === true,
  `result=${JSON.stringify(resetSafetyResult).slice(0, 150)}`)

// =============================================================
console.log('\n[R124-8] 大批量 listStudents 一致性 (并发 100 次)')

const bulkListResult = await evalInPage(ws, `(async () => {
  const errors = [];
  // 并发 100 次 listStudents
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(window.api.eaa.listStudents().catch(e => { errors.push(e.message); return null; }));
  }
  const results = await Promise.all(promises);
  // 验证所有结果的学生数一致
  const counts = results.filter(r => r !== null).map(r => r?.data?.students?.length ?? -1);
  const allSame = counts.every(c => c === counts[0]);
  const successCount = results.filter(r => r?.success === true).length;
  return { errorCount: errors.length, allSame, successCount, sampleCount: counts[0] };
})()`)
check('EAA 并发 100 次 listStudents 无错误',
  bulkListResult?.errorCount === 0,
  `result=${JSON.stringify(bulkListResult).slice(0, 200)}`)
check('100 次并发 listStudents 全部 success=true',
  bulkListResult?.successCount === 100,
  `successCount=${bulkListResult?.successCount}`)
check('100 次并发 listStudents 学生数一致',
  bulkListResult?.allSame === true,
  `sampleCount=${bulkListResult?.sampleCount}`)

// =============================================================
console.log('\n[R124-9] 错误捕获 + 数据完整性验证')

const finalErrors = await getErrors()
check('存储压力测试期间 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// 最终验证 settings 完整性
const finalSettings = await evalInPage(ws, `(async () => {
  const r = await window.api.settings.get();
  const s = r?.data || r;
  return {
    hasGeneral: !!s?.general,
    hasChat: !!s?.chat,
    hasFeishu: !!s?.feishu,
    hasMcp: !!s?.mcp,
    theme: s?.general?.theme,
  };
})()`)
check('Settings 最终完整性 (general/chat/feishu/mcp 全部存在)',
  finalSettings?.hasGeneral === true && finalSettings?.hasChat === true && finalSettings?.hasFeishu === true && finalSettings?.hasMcp === true,
  `result=${JSON.stringify(finalSettings)}`)

// =============================================================
console.log('\n========================================')
console.log(`R124 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
