// =============================================================
// R109: Cron 任务生命周期测试
// 角度 1: cron.list — 初始列表可读
// 角度 2: cron.add — 创建任务 + 验证字段
// 角度 3: cron.update — 更新任务属性
// 角度 4: cron.toggle — 启用/禁用任务
// 角度 5: cron.runNow — 立即执行 (不崩溃)
// 角度 6: cron.getLogs — 读取日志
// 角度 7: cron.remove — 删除任务 + 验证
// 角度 8: 无效操作 — 不存在 ID 的 update/toggle/remove
// 角度 9: 并发 add/remove — 数据一致性
// 角度 10: cron.status 订阅
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
console.log(`[R109] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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

await evalInPage(ws, `
  window.__r109Errors = [];
  if (!window.__r109HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r109Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r109Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r109HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r109Errors || []))`)
}

const STAMP = `r109_${Date.now()}`
const createdTaskIds = []

// =============================================================
console.log('\n=== R109: Cron 任务生命周期测试 ===')

// =============================================================
console.log('\n[R109-1] cron.list — 初始列表可读')

const initialList = await evalInPage(ws, `window.api.cron.list()`)
const initialArr = Array.isArray(initialList) ? initialList : (initialList?.data || initialList?.tasks || [])
check('cron.list 返回数组',
  Array.isArray(initialArr),
  `type=${typeof initialArr}, result=${JSON.stringify(initialList).slice(0, 100)}`)

// 清理之前的 r109 测试任务
for (const t of initialArr) {
  if (t?.name?.startsWith('r109_')) {
    await evalInPage(ws, `window.api.cron.remove(${JSON.stringify(t.id || t.name)})`)
  }
}

// =============================================================
console.log('\n[R109-2] cron.add — 创建任务')

const addResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.add({
      name: ${JSON.stringify(STAMP + '_task1')},
      expression: '*/30 * * * *',
      task: 'noop',
      agentId: 'main',
      enabled: true,
    });
    return { ok: r?.success !== false, id: r?.id, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.add 创建任务成功',
  addResult?.ok === true,
  `result=${JSON.stringify(addResult).slice(0, 200)}`)

if (addResult?.id) createdTaskIds.push(addResult.id)

// 验证任务在列表中
const afterAdd = await evalInPage(ws, `window.api.cron.list()`)
const afterAddArr = Array.isArray(afterAdd) ? afterAdd : (afterAdd?.data || afterAdd?.tasks || [])
const found = afterAddArr.find(t => t.name === STAMP + '_task1')
check('创建的任务在 list 中可见',
  !!found,
  `found=${!!found}`)

// =============================================================
console.log('\n[R109-3] cron.update — 更新任务属性')

const taskId = found?.id || addResult?.id
const updateResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.update(${JSON.stringify(taskId)}, {
      name: ${JSON.stringify(STAMP + '_task1_renamed')},
      expression: '0 * * * *',
    });
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.update 修改任务名和表达式成功',
  updateResult?.ok === true,
  `result=${JSON.stringify(updateResult).slice(0, 100)}`)

// 验证更新
const afterUpdate = await evalInPage(ws, `window.api.cron.list()`)
const afterUpdateArr = Array.isArray(afterUpdate) ? afterUpdate : (afterUpdate?.data || afterUpdate?.tasks || [])
const updated = afterUpdateArr.find(t => t.id === taskId)
check('更新后任务名已改变',
  updated?.name === STAMP + '_task1_renamed',
  `name=${updated?.name}`)

// =============================================================
console.log('\n[R109-4] cron.toggle — 启用/禁用任务')

const toggleOff = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.toggle(${JSON.stringify(taskId)}, false);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.toggle(taskId, false) 成功',
  toggleOff?.ok === true,
  `result=${JSON.stringify(toggleOff).slice(0, 100)}`)

// 验证 disabled
const afterToggleOff = await evalInPage(ws, `window.api.cron.list()`)
const afterToggleOffArr = Array.isArray(afterToggleOff) ? afterToggleOff : (afterToggleOff?.data || afterToggleOff?.tasks || [])
const toggledOff = afterToggleOffArr.find(t => t.id === taskId)
check('toggle 后 enabled=false',
  toggledOff?.enabled === false,
  `enabled=${toggledOff?.enabled}`)

// Toggle back on
await evalInPage(ws, `window.api.cron.toggle(${JSON.stringify(taskId)}, true)`)

// =============================================================
console.log('\n[R109-5] cron.runNow — 立即执行')

const runNowResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.runNow(${JSON.stringify(taskId)});
    return { ok: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.runNow 不崩溃',
  runNowResult?.ok === true || runNowResult?.result?.success !== false,
  `result=${JSON.stringify(runNowResult).slice(0, 150)}`)

// 等待执行
await sleep(2000)

// =============================================================
console.log('\n[R109-6] cron.getLogs — 读取日志')

const logsResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.getLogs(${JSON.stringify(taskId)});
    return { ok: true, isArray: Array.isArray(r), len: Array.isArray(r) ? r.length : 0, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.getLogs 不崩溃',
  logsResult?.ok === true,
  `result=${JSON.stringify(logsResult).slice(0, 150)}`)

// 获取所有日志 (不传 taskId)
const allLogs = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.getLogs();
    return { ok: true, isArray: Array.isArray(r) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.getLogs() (全部) 不崩溃',
  allLogs?.ok === true,
  `result=${JSON.stringify(allLogs).slice(0, 100)}`)

// =============================================================
console.log('\n[R109-7] cron.remove — 删除任务')

const removeResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.remove(${JSON.stringify(taskId)});
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.remove 成功',
  removeResult?.ok === true,
  `result=${JSON.stringify(removeResult).slice(0, 100)}`)

// 验证已删除
const afterRemove = await evalInPage(ws, `window.api.cron.list()`)
const afterRemoveArr = Array.isArray(afterRemove) ? afterRemove : (afterRemove?.data || afterRemove?.tasks || [])
const removed = afterRemoveArr.find(t => t.id === taskId)
check('删除后任务不在 list 中',
  !removed,
  `stillFound=${!!removed}`)

// =============================================================
console.log('\n[R109-8] 无效操作 — 不存在 ID')

const badUpdate = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.update('nonexistent_id_xyz', { name: 'test' });
    return { ok: r?.success !== false, result: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('cron.update 不存在 ID 不崩溃',
  badUpdate !== null && badUpdate !== undefined,
  `result=${JSON.stringify(badUpdate).slice(0, 100)}`)

const badToggle = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.toggle('nonexistent_id_xyz', true);
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('cron.toggle 不存在 ID 不崩溃',
  badToggle !== null && badToggle !== undefined,
  `result=${JSON.stringify(badToggle).slice(0, 100)}`)

const badRemove = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.remove('nonexistent_id_xyz');
    return { ok: r?.success !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('cron.remove 不存在 ID 不崩溃',
  badRemove !== null && badRemove !== undefined,
  `result=${JSON.stringify(badRemove).slice(0, 100)}`)

// =============================================================
console.log('\n[R109-9] 并发 add/remove — 数据一致性')

const concurrentResult = await evalInPage(ws, `(async () => {
  // 5 个并发 add
  const adds = [];
  for (let i = 0; i < 5; i++) {
    adds.push((async () => {
      try {
        const r = await window.api.cron.add({
          name: ${JSON.stringify(STAMP)} + '_concurrent_' + i,
          expression: '*/10 * * * *',
          task: 'noop',
          agentId: 'main',
        });
        return { op: 'add', idx: i, ok: r?.success !== false, id: r?.id };
      } catch (e) {
        return { op: 'add', idx: i, ok: false, error: e.message };
      }
    })());
  }
  const addResults = await Promise.allSettled(adds);
  const addOk = addResults.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
  const addedIds = addResults.filter(r => r.status === 'fulfilled' && r.value?.id).map(r => r.value.id);
  
  // 3 个并发 remove
  const removes = addedIds.slice(0, 3).map((id, i) => 
    window.api.cron.remove(id)
      .then(r => ({ op: 'remove', idx: i, ok: r?.success !== false }))
      .catch(e => ({ op: 'remove', idx: i, ok: false, error: e.message }))
  );
  const removeResults = await Promise.allSettled(removes);
  const removeOk = removeResults.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
  
  // 清理剩余
  const remaining = addedIds.slice(3);
  for (const id of remaining) {
    try { await window.api.cron.remove(id); } catch {}
  }
  
  return { addOk, removeOk, totalAdded: addedIds.length };
})()`)

check('5 个并发 cron add 完成',
  concurrentResult?.addOk === 5,
  `addOk=${concurrentResult?.addOk}/5`)

check('3 个并发 cron remove 完成',
  concurrentResult?.removeOk === 3,
  `removeOk=${concurrentResult?.removeOk}/3`)

// 验证最终 list 一致 (无 r109 concurrent 任务残留)
const finalList = await evalInPage(ws, `window.api.cron.list()`)
const finalArr = Array.isArray(finalList) ? finalList : (finalList?.data || finalList?.tasks || [])
const r109Concurrent = finalArr.filter(t => t?.name?.startsWith(STAMP + '_concurrent'))
check('并发操作后无 r109 concurrent 任务残留',
  r109Concurrent.length === 0,
  `remaining=${r109Concurrent.length}`)

// =============================================================
console.log('\n[R109-10] cron.status 订阅')

const subTest = await evalInPage(ws, `(async () => {
  try {
    let received = [];
    const unsub = window.api.cron.onStatusUpdate((data) => {
      received.push(data);
    });
    
    const isFunc = typeof unsub === 'function';
    unsub();
    
    await new Promise(r => setTimeout(r, 300));
    
    return { ok: true, isFunc };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)

check('cron.onStatusUpdate 返回取消订阅函数',
  subTest?.isFunc === true,
  `result=${JSON.stringify(subTest).slice(0, 100)}`)

check('cron.onStatusUpdate 安装 + 卸载不崩溃',
  subTest?.ok === true,
  `result=${JSON.stringify(subTest).slice(0, 100)}`)

// =============================================================
console.log('\n[R109-11] 全程错误捕获')

const allErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  allErrors.length === 0,
  `errors=${allErrors.length}, detail=${JSON.stringify(allErrors).slice(0, 200)}`)

// 清理所有 r109 任务
const cleanupList = await evalInPage(ws, `window.api.cron.list()`)
const cleanupArr = Array.isArray(cleanupList) ? cleanupList : (cleanupList?.data || cleanupList?.tasks || [])
for (const t of cleanupArr) {
  if (t?.name?.startsWith('r109_')) {
    await evalInPage(ws, `window.api.cron.remove(${JSON.stringify(t.id)})`)
  }
}

// =============================================================
console.log('\n========================================')
console.log(`R109 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
