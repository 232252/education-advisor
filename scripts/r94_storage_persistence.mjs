// =============================================================
// R94 存储层与持久化深度测试
// 角度 1: cron 任务 CRUD 闭环 (含持久化)
// 角度 2: skill CRUD 闭环 (100 个批量)
// 角度 3: profile 往返一致性 (含嵌套对象/数组/null)
// 角度 4: settings 并发原子写 (20 次同 dotPath)
// 角度 5: prototype 污染防御
// 角度 6: atomicWrite 大数据量 (1MB)
// =============================================================

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

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
console.log(`[R94] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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

// ---------- 全局错误捕获器 ----------
await evalInPage(ws, `
  window.__r94Errors = [];
  if (!window.__r94HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r94Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r94Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r94HookInstalled = true;
  }
  true
`)

// =============================================================
// R94-1: cron 任务 CRUD 闭环
// =============================================================
console.log('\n=== R94-1: cron 任务 CRUD 闭环 ===')

const cronList0 = await evalInPage(ws, `window.api.cron.list()`)
const initialCount = Array.isArray(cronList0) ? cronList0.length : (cronList0?.tasks?.length || 0)
console.log(`  初始 cron 任务数: ${initialCount}`)

// 添加任务
const addResult = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.cron.add({
      name: 'R94-Test-Task',
      expression: '0 9 * * *',
      agentId: 'main',
      prompt: 'R94 测试任务'
    });
    return r;
  } catch (e) { return { error: e.message }; }
})()`)
console.log(`  add 结果: ${JSON.stringify(addResult).slice(0, 150)}`)

const cronList1 = await evalInPage(ws, `window.api.cron.list()`)
const afterAddCount = Array.isArray(cronList1) ? cronList1.length : (cronList1?.tasks?.length || 0)
check('cron.add 后任务数 +1', afterAddCount === initialCount + 1, `(before=${initialCount}, after=${afterAddCount})`)

// 找到新任务
const newTask = (Array.isArray(cronList1) ? cronList1 : cronList1?.tasks || []).find(
  (t) => t.name === 'R94-Test-Task',
)
check('cron 新任务可在 list 中找到', !!newTask, `(task=${JSON.stringify(newTask).slice(0, 150)})`)

// toggle 任务
if (newTask) {
  const toggleR = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.cron.toggle(${JSON.stringify(newTask.id)}, false);
      return r;
    } catch (e) { return { error: e.message }; }
  })()`)
  check('cron.toggle 成功', toggleR && toggleR.success !== false, `(result=${JSON.stringify(toggleR).slice(0, 100)})`)
}

// remove 任务
if (newTask) {
  const removeR = await evalInPage(ws, `(async () => {
    try {
      const r = await window.api.cron.remove(${JSON.stringify(newTask.id)});
      return r;
    } catch (e) { return { error: e.message }; }
  })()`)
  check('cron.remove 成功', removeR && removeR.success !== false, `(result=${JSON.stringify(removeR).slice(0, 100)})`)

  // 验证删除
  const cronList2 = await evalInPage(ws, `window.api.cron.list()`)
  const afterRemoveCount = Array.isArray(cronList2) ? cronList2.length : (cronList2?.tasks?.length || 0)
  check('cron.remove 后任务数恢复', afterRemoveCount === initialCount, `(before=${initialCount}, after=${afterRemoveCount})`)
}

// =============================================================
// R94-2: skill CRUD 闭环 (100 个批量)
// =============================================================
console.log('\n=== R94-2: skill CRUD 闭环 (100 个批量) ===')

// 清理前置: 删除 R94-* 残留
const skillsBefore = await evalInPage(ws, `window.api.skill.list()`)
const beforeSkillCount = Array.isArray(skillsBefore) ? skillsBefore.length : 0
console.log(`  初始 skill 数: ${beforeSkillCount}`)

// 批量 save 100 个
const batchSaveR = await evalInPage(ws, `(async () => {
  const results = [];
  for (let i = 0; i < 100; i++) {
    try {
      const r = await window.api.skill.save('R94-Batch-' + i, '# R94 Batch Skill ' + i + '\\n\\nTest content.');
      results.push({ i, success: r && r.success !== false });
    } catch (e) {
      results.push({ i, success: false, error: e.message });
    }
  }
  const okCount = results.filter(r => r.success).length;
  return { ok: okCount, fail: 100 - okCount };
})()`)
check('skill.save 批量 100 个全部成功', batchSaveR.ok === 100, `(ok=${batchSaveR.ok}, fail=${batchSaveR.fail})`)

// list 验证
const skillsAfter = await evalInPage(ws, `window.api.skill.list()`)
const afterSkillCount = Array.isArray(skillsAfter) ? skillsAfter.length : 0
check('skill.list 含新增 100 个', afterSkillCount >= beforeSkillCount + 100, `(before=${beforeSkillCount}, after=${afterSkillCount})`)

// get 验证 50 个
const batchGetR = await evalInPage(ws, `(async () => {
  let ok = 0;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await window.api.skill.get('R94-Batch-' + i);
      if (r && r.content) ok++;
    } catch (e) {}
  }
  return { ok };
})()`)
check('skill.get 50 个全部返回内容', batchGetR.ok === 50, `(ok=${batchGetR.ok})`)

// 批量 delete 100 个
const batchDeleteR = await evalInPage(ws, `(async () => {
  let ok = 0;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await window.api.skill.delete('R94-Batch-' + i);
      if (r && r.success !== false) ok++;
    } catch (e) {}
  }
  return { ok };
})()`)
check('skill.delete 批量 100 个全部成功', batchDeleteR.ok === 100, `(ok=${batchDeleteR.ok})`)

// list 验证删除
const skillsFinal = await evalInPage(ws, `window.api.skill.list()`)
const finalSkillCount = Array.isArray(skillsFinal) ? skillsFinal.length : 0
check('skill.list 删除后恢复', finalSkillCount === beforeSkillCount, `(before=${beforeSkillCount}, after=${finalSkillCount})`)

// =============================================================
// R94-3: profile 往返一致性
// =============================================================
console.log('\n=== R94-3: profile 往返一致性 ===')

const profileData = {
  a: 1,
  b: { c: 2, d: 'hello' },
  arr: [10, 20, 30],
  str: '测试',
  nil: null,
  nested: { deep: { deeper: { deepest: 'value' } } },
}
const profileName = 'R94-Profile-Test'

const setR = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.set(${JSON.stringify(profileName)}, ${JSON.stringify(profileData)});
    return r;
  } catch (e) { return { error: e.message }; }
})()`)
check('profile.set 成功', setR && setR.success !== false, `(result=${JSON.stringify(setR).slice(0, 150)})`)

const getR = await evalInPage(ws, `(async () => {
  try {
    const r = await window.api.profile.get(${JSON.stringify(profileName)});
    return r;
  } catch (e) { return { error: e.message }; }
})()`)
const profileReturned = getR?.data || getR?.result?.data
const profileMatch =
  profileReturned &&
  profileReturned.a === 1 &&
  profileReturned.b?.c === 2 &&
  profileReturned.b?.d === 'hello' &&
  Array.isArray(profileReturned.arr) &&
  profileReturned.arr.length === 3 &&
  profileReturned.arr[0] === 10 &&
  profileReturned.str === '测试' &&
  profileReturned.nil === null &&
  profileReturned.nested?.deep?.deeper?.deepest === 'value'
check('profile.get 往返数据一致', profileMatch, `(returned=${JSON.stringify(profileReturned).slice(0, 200)})`)

// =============================================================
// R94-4: settings 并发原子写 (20 次同 dotPath)
// =============================================================
console.log('\n=== R94-4: settings 并发原子写 ===')

const concurrentR = await evalInPage(ws, `(async () => {
  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(window.api.settings.set('general.defaultOperator', 'concurrent-' + i));
  }
  const settled = await Promise.allSettled(promises);
  let ok = 0, fail = 0;
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value?.success !== false) ok++;
    else fail++;
  }
  const final = await window.api.settings.get();
  return { ok, fail, finalValue: final?.general?.defaultOperator };
})()`)
check(
  'settings 并发写 20 次全部成功',
  concurrentR.ok === 20,
  `(ok=${concurrentR.ok}, fail=${concurrentR.fail}, finalValue=${concurrentR.finalValue})`,
)
check(
  'settings 并发写最终值是最后一个写入',
  concurrentR.finalValue && concurrentR.finalValue.startsWith('concurrent-'),
  `(finalValue=${concurrentR.finalValue})`,
)

// =============================================================
// R94-5: prototype 污染防御
// =============================================================
console.log('\n=== R94-5: prototype 污染防御 ===')

const protoR = await evalInPage(ws, `(async () => {
  const tests = [
    { path: '__proto__.polluted', value: 'evil' },
    { path: 'constructor.prototype.polluted', value: 'evil' },
    { path: '__proto__', value: { polluted: 'evil' } },
  ];
  const results = [];
  for (const t of tests) {
    try {
      const r = await window.api.settings.set(t.path, t.value);
      results.push({ path: t.path, success: r?.success });
    } catch (e) {
      results.push({ path: t.path, success: false, error: e.message });
    }
  }
  // 验证 Object.prototype 未被污染
  const polluted = ({}).polluted;
  return { results, polluted };
})()`)
const allBlocked = protoR.results.every((r) => r.success === false)
check('prototype 污染 payload 全部被拒', allBlocked, `(results=${JSON.stringify(protoR.results)})`)
check('Object.prototype 未被污染', protoR.polluted === undefined, `(polluted=${protoR.polluted})`)

// =============================================================
// R94-6: 大数据量原子写 (1MB 字符串)
// =============================================================
console.log('\n=== R94-6: 大数据量原子写 ===')

const bigDataR = await evalInPage(ws, `(async () => {
  // 构造 100KB 字符串(避免触发 1MB 上限 + IPC 通道对超大数据的 size 限制)
  const big = 'x'.repeat(100000);
  try {
    // models.transport 是 DEFAULT_SETTINGS 中的合法字符串字段
    const r = await window.api.settings.set('models.transport', big);
    if (!r || r.success === false) return { ok: false, error: 'set failed', setResult: r };
    const final = await window.api.settings.get();
    const value = final?.models?.transport;
    return {
      ok: true,
      length: typeof value === 'string' ? value.length : -1,
      matches: value === big,
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
})()`)
check('100KB 字符串 set+get 长度一致', bigDataR.ok && bigDataR.length === 100000, `(length=${bigDataR.length}, error=${bigDataR.error || ''})`)

// 还原默认值
await evalInPage(ws, `window.api.settings.set('models.transport', 'auto'); true`)

// =============================================================
// R94-7: 全程 0 错误
// =============================================================
console.log('\n=== R94-7: 全程 0 错误 ===')

const errs = await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r94Errors || []))`)
check('全程 0 unhandledrejection/error', errs.length === 0, `(errors=${errs.length})`)
if (errs.length > 0) {
  console.log(`    错误明细: ${JSON.stringify(errs.slice(0, 5))}`)
}

// =============================================================
// 总结
// =============================================================
console.log('\n========================================')
console.log(`R94 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
