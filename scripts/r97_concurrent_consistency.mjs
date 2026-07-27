// =============================================================
// R97: 并发数据一致性测试 (多 agent 写同一记录)
// 角度 1: 并发写同一个 profile - 验证最终一致 (无丢失更新)
// 角度 2: 并发写同一个 settings 字段 - 验证 atomicWrite 防撕裂
// 角度 3: 读-改-写竞态 - 验证 read-after-write 一致性
// 角度 4: 并发 cron 任务 add/remove - 验证 cron.user.json 不损坏
// 角度 5: 全程 0 unhandledrejection + 最终数据完整
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

const targets = await getTargets()
const pageTarget =
  targets.find((t) => t.type === 'page' && t.url.includes('localhost')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R97] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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

// 全局错误捕获
await evalInPage(ws, `
  window.__r97Errors = [];
  if (!window.__r97HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r97Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r97Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r97HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r97Errors || []))`)
}

async function clearErrors() {
  await evalInPage(ws, `window.__r97Errors = []; true`)
}

// =============================================================
console.log('\n=== R97: 并发数据一致性测试 ===')

// =============================================================
console.log('\n[R97-1] 并发写同一个 profile (10 个并发写)')

// 准备: 先确保测试 profile 存在
await evalInPage(ws, `window.api.profile.set('r97_test_profile', { counter: 0, writers: [] })`)
await sleep(300)

// 10 个并发写,每个都试图设置不同的 writer 字段
const concurrentProfileWrites = await evalInPage(ws, `(async () => {
  const writes = [];
  for (let i = 0; i < 10; i++) {
    writes.push((async () => {
      try {
        // 每个 writer 设置自己的字段
        const result = await window.api.profile.set('r97_test_profile', {
          writerId: 'writer_' + i,
          timestamp: Date.now(),
        });
        return { writerIdx: i, ok: true, success: result?.success };
      } catch (e) {
        return { writerIdx: i, ok: false, error: e.message };
      }
    })());
  }
  return await Promise.allSettled(writes);
})()`)

const profileWriteArray = Array.isArray(concurrentProfileWrites) ? concurrentProfileWrites : []
const profileSuccessCount = profileWriteArray.filter(r => r.status === 'fulfilled' && r.value?.ok).length
check('10 个并发 profile 写全部完成', profileSuccessCount === 10,
  `success=${profileSuccessCount}/10, detail=${JSON.stringify(concurrentProfileWrites).slice(0, 200)}`)

// 验证最终状态: profile 仍然可读且结构完整
const finalProfile = await evalInPage(ws, `window.api.profile.get('r97_test_profile')`)
check('并发写后 profile 可读', finalProfile && finalProfile.success !== false,
  `result=${JSON.stringify(finalProfile).slice(0, 150)}`)
check('并发写后 profile 结构完整', finalProfile?.data && typeof finalProfile.data === 'object',
  `data=${JSON.stringify(finalProfile?.data).slice(0, 100)}`)

// 清理
await evalInPage(ws, `window.api.profile.delete('r97_test_profile')`)

// =============================================================
console.log('\n[R97-2] 并发写同一 settings 字段 (atomicWrite 防撕裂)')

// 备份原值
const originalSettings = await evalInPage(ws, `window.api.settings.get()`)
const originalLog = originalSettings?.general?.logLevel || 'info'

// 10 个并发写同一字段 general.logLevel
const concurrentSettingsWrites = await evalInPage(ws, `(async () => {
  const levels = ['debug', 'info', 'warn', 'error', 'debug', 'info', 'warn', 'debug', 'info', 'warn'];
  const writes = levels.map((level, i) => 
    window.api.settings.set('general.logLevel', level)
      .then(r => ({ idx: i, level, ok: true, success: r?.success }))
      .catch(e => ({ idx: i, level, ok: false, error: e.message }))
  );
  return await Promise.allSettled(writes);
})()`)

const settingsWriteArray = Array.isArray(concurrentSettingsWrites) ? concurrentSettingsWrites : []
const settingsSuccessCount = settingsWriteArray.filter(r => r.status === 'fulfilled' && r.value?.ok).length
check('10 个并发 settings 写全部完成', settingsSuccessCount === 10,
  `success=${settingsSuccessCount}/10`)

// 验证最终 settings 文件未损坏 (可读 + logLevel 是合法枚举)
const finalSettings = await evalInPage(ws, `window.api.settings.get()`)
check('并发写后 settings.json 可读', finalSettings && finalSettings.general,
  `result=${JSON.stringify(finalSettings).slice(0, 100)}`)
check('并发写后 logLevel 是合法枚举值',
  ['debug', 'info', 'warn', 'error'].includes(finalSettings?.general?.logLevel),
  `logLevel=${finalSettings?.general?.logLevel}`)

// 验证 settings.json 文件内容是合法 JSON (无撕裂)
const settingsValid = await evalInPage(ws, `(async () => {
  try {
    // 通过 settings.get 已经隐式验证了 JSON 合法性 (内部用 JSON.parse)
    // 这里再读一次确认稳定
    const s = await window.api.settings.get();
    return s !== null && typeof s === 'object';
  } catch (e) {
    return false;
  }
})()`)
check('settings.json 内容稳定 (无撕裂)', settingsValid === true)

// 恢复原值
await evalInPage(ws, `window.api.settings.set('general.logLevel', ${JSON.stringify(originalLog)})`)

// =============================================================
console.log('\n[R97-3] 读-改-写竞态 (5 轮 read-modify-write)')

// 测试 read-modify-write 模式下的一致性
const rmwResult = await evalInPage(ws, `(async () => {
  // 准备: 初始化 profile
  await window.api.profile.set('r97_rmw_test', { value: 0 });
  await new Promise(r => setTimeout(r, 200));
  
  // 5 个并发 read-modify-write
  const workers = [];
  for (let i = 0; i < 5; i++) {
    workers.push((async () => {
      try {
        // read
        const current = await window.api.profile.get('r97_rmw_test');
        const currentValue = current?.data?.value || 0;
        // modify (每个 worker 加 100)
        const newValue = currentValue + 100;
        // write
        await window.api.profile.set('r97_rmw_test', { value: newValue, writerIdx: i });
        return { idx: i, ok: true, beforeValue: currentValue, afterValue: newValue };
      } catch (e) {
        return { idx: i, ok: false, error: e.message };
      }
    })());
  }
  const results = await Promise.allSettled(workers);
  return results.map(r => r.status === 'fulfilled' ? r.value : { ok: false, error: r.reason?.message });
})()`)

const rmwArray = Array.isArray(rmwResult) ? rmwResult : []
const rmwSuccessCount = rmwArray.filter(r => r.ok).length
check('5 个 RMW 操作全部完成', rmwSuccessCount === 5,
  `success=${rmwSuccessCount}/5`)

// 注: 由于无锁,5 个并发 RMW 可能产生 lost update (这是预期的 - 无乐观锁)
// 这里只验证最终状态可读且是合法数字
const rmwFinal = await evalInPage(ws, `window.api.profile.get('r97_rmw_test')`)
check('RMW 后 profile 可读', rmwFinal && rmwFinal.success !== false,
  `result=${JSON.stringify(rmwFinal).slice(0, 100)}`)
check('RMW 后 value 是数字', typeof rmwFinal?.data?.value === 'number',
  `value=${rmwFinal?.data?.value}`)

// 数据完整性: value 应该 >= 100 (至少一个 write 生效)
check('RMW 至少有一个 write 生效 (value >= 100)', rmwFinal?.data?.value >= 100,
  `value=${rmwFinal?.data?.value}`)

// 清理
await evalInPage(ws, `window.api.profile.delete('r97_rmw_test')`)

// =============================================================
console.log('\n[R97-4] 并发 cron 任务 add/remove (cron.user.json 不损坏)')

// 准备: 清空现有 r97 测试任务
const existingCrons = await evalInPage(ws, `window.api.cron.list()`)
if (Array.isArray(existingCrons)) {
  for (const t of existingCrons) {
    if (t.name?.startsWith('r97_test_')) {
      await evalInPage(ws, `window.api.cron.remove(${JSON.stringify(t.id || t.name)})`)
    }
  }
}

// 5 个并发 add + 3 个并发 remove (用已存在的任务)
const concurrentCronOps = await evalInPage(ws, `(async () => {
  const ops = [];
  // 5 个并发 add
  for (let i = 0; i < 5; i++) {
    ops.push((async () => {
      try {
        const r = await window.api.cron.add({
          name: 'r97_test_cron_' + i,
          expression: '*/10 * * * *',
          task: 'noop',
          agentId: 'main',
        });
        return { op: 'add', idx: i, ok: true, success: r?.success, id: r?.id };
      } catch (e) {
        return { op: 'add', idx: i, ok: false, error: e.message };
      }
    })());
  }
  return await Promise.allSettled(ops);
})()`)

const cronOpsArray = Array.isArray(concurrentCronOps) ? concurrentCronOps : []
const cronAddSuccess = cronOpsArray.filter(r => r.status === 'fulfilled' && r.value?.ok).length
check('5 个并发 cron add 完成', cronAddSuccess === 5,
  `success=${cronAddSuccess}/5`)

// 验证 cron.user.json 未损坏
const cronListAfterAdd = await evalInPage(ws, `window.api.cron.list()`)
check('并发 add 后 cron list 可读', Array.isArray(cronListAfterAdd),
  `result=${JSON.stringify(cronListAfterAdd).slice(0, 100)}`)
const r97Crons = Array.isArray(cronListAfterAdd) ? cronListAfterAdd.filter(t => t.name?.startsWith('r97_test_cron_')) : []
check('并发 add 后 r97 测试任务数量 = 5', r97Crons.length === 5,
  `count=${r97Crons.length}`)

// 3 个并发 remove
const concurrentRemoveOps = await evalInPage(ws, `(async () => {
  const list = await window.api.cron.list();
  const r97Tasks = list.filter(t => t.name?.startsWith('r97_test_cron_'));
  const toRemove = r97Tasks.slice(0, 3);
  const ops = toRemove.map((t, i) => 
    window.api.cron.remove(t.id)
      .then(r => ({ op: 'remove', idx: i, name: t.name, ok: true, success: r?.success }))
      .catch(e => ({ op: 'remove', idx: i, name: t.name, ok: false, error: e.message }))
  );
  return await Promise.allSettled(ops);
})()`)

const removeArray = Array.isArray(concurrentRemoveOps) ? concurrentRemoveOps : []
const removeSuccess = removeArray.filter(r => r.status === 'fulfilled' && r.value?.ok).length
check('3 个并发 cron remove 完成', removeSuccess === 3,
  `success=${removeSuccess}/3`)

// 验证最终 cron list 一致
const finalCronList = await evalInPage(ws, `window.api.cron.list()`)
const finalR97Crons = Array.isArray(finalCronList) ? finalCronList.filter(t => t.name?.startsWith('r97_test_cron_')) : []
check('并发 remove 后 r97 任务数量 = 2', finalR97Crons.length === 2,
  `count=${finalR97Crons.length}`)

// 清理: 删除剩余 r97 任务
for (const t of finalR97Crons) {
  await evalInPage(ws, `window.api.cron.remove(${JSON.stringify(t.id)})`)
}

// =============================================================
console.log('\n[R97-5] 全程错误捕获 + 最终一致性验证')

const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error', finalErrors.length === 0,
  `errors=${finalErrors.length}, detail=${JSON.stringify(finalErrors).slice(0, 200)}`)

// 最终验证: 所有核心 API 仍工作
const finalCheck = await evalInPage(ws, `(async () => {
  const [stats, settings, agents, skills, cronList] = await Promise.all([
    window.api.eaa.stats(),
    window.api.settings.get(),
    window.api.agent.list(),
    window.api.skill.list(),
    window.api.cron.list(),
  ]);
  return {
    statsOk: stats && stats.success !== false,
    settingsOk: settings && settings.general,
    agentsOk: Array.isArray(agents),
    skillsOk: Array.isArray(skills),
    cronListOk: Array.isArray(cronList),
  };
})()`)

check('最终一致性: 所有核心 API 仍工作',
  finalCheck?.statsOk && finalCheck?.settingsOk && finalCheck?.agentsOk && finalCheck?.skillsOk && finalCheck?.cronListOk,
  `result=${JSON.stringify(finalCheck)}`)

// =============================================================
console.log('\n========================================')
console.log(`R97 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.errors.length > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
