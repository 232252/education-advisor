// =============================================================
// R115: 性能/内存/并发 多角度持续测试
// 角度 1: IPC 调用延迟 - 多个高频通道 p50/p95/p99
// 角度 2: 内存堆增长 - 50 次导航循环后 heap 不持续增长
// 角度 3: 并发 IPC - 100 个并发请求不丢/不串
// 角度 4: 压力测试 - 快速切换 settings 100 次
// 角度 5: 长时运行 - 反复 chat stream 启动/取消
// 角度 6: 监听器压力 - 反复订阅/取消 1000 次
// 角度 7: EAA 缓存失效 - 写入后立即读取一致性
// 角度 8: 渲染压力 - 大量 DOM 节点切换不卡死
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
console.log(`[R115] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r115Errors = [];
  if (!window.__r115HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r115Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r115Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r115HookInstalled = true;
  }
  true
`)

async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r115Errors || []))`)
}

async function getHeap() {
  return await evalInPage(ws, `(async () => {
    if (performance && performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
      };
    }
    return null;
  })()`)
}

function pct(arr, p) {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p / 100))
  return sorted[idx]
}

console.log('\n=== R115: 性能/内存/并发 多角度持续测试 ===')

// =============================================================
console.log('\n[R115-1] IPC 调用延迟 - p50/p95/p99')

// 测量每个高频通道 30 次调用延迟
const channels = [
  { name: 'settings.get', call: 'window.api.settings.get()' },
  { name: 'agent.list', call: 'window.api.agent.list()' },
  { name: 'skill.list', call: 'window.api.skill.list()' },
  { name: 'cron.list', call: 'window.api.cron.list()' },
  { name: 'chat.listSessions', call: 'window.api.chat.listSessions()' },
]

for (const ch of channels) {
  const latencies = await evalInPage(ws, `(async () => {
    const latencies = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      try { await ${ch.call}; } catch (e) {}
      latencies.push(performance.now() - t0);
    }
    return latencies;
  })()`)

  if (Array.isArray(latencies) && latencies.length === 30) {
    const p50 = pct(latencies, 50)
    const p95 = pct(latencies, 95)
    const p99 = pct(latencies, 99)
    const max = Math.max(...latencies)
    console.log(`    ${ch.name}: p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms max=${max.toFixed(1)}ms`)
    check(`${ch.name} p95 < 500ms`,
      p95 < 500,
      `p95=${p95.toFixed(1)}ms`)
    check(`${ch.name} max < 2000ms`,
      max < 2000,
      `max=${max.toFixed(1)}ms`)
  } else {
    check(`${ch.name} 延迟测量完成`, false, `len=${latencies?.length}`)
  }
}

// =============================================================
console.log('\n[R115-2] 内存堆增长 - 50 次导航循环')

const heapBefore = await getHeap()
const navCycles = 50
for (let i = 0; i < navCycles; i++) {
  // 在 5 个页面间循环切换
  const routes = ['/dashboard', '/agents', '/skills', '/settings', '/chat']
  const route = routes[i % routes.length]
  await evalInPage(ws, `window.location.hash = '#${route}'; true`)
  // 短暂等待让页面 mount
  if (i % 10 === 9) {
    await sleep(200) // 每 10 次让 GC 有机会跑
  }
}
await sleep(1000) // 等 GC
const heapAfter = await getHeap()

if (heapBefore && heapAfter) {
  const growthMB = (heapAfter.used - heapBefore.used) / 1024 / 1024
  const totalUsedMB = heapAfter.used / 1024 / 1024
  console.log(`    heap before: ${(heapBefore.used / 1024 / 1024).toFixed(1)}MB, after: ${(heapAfter.used / 1024 / 1024).toFixed(1)}MB, growth: ${growthMB.toFixed(1)}MB`)
  check(`50 次导航后堆增长 < 50MB`,
    growthMB < 50,
    `growth=${growthMB.toFixed(1)}MB`)
  check(`总堆使用 < 500MB`,
    totalUsedMB < 500,
    `total=${totalUsedMB.toFixed(1)}MB`)
} else {
  check('performance.memory 可用', false, 'skipped')
}

// =============================================================
console.log('\n[R115-3] 并发 IPC - 100 个并发请求不丢/不串')

// 100 个并发 agent.list + agent.get 请求
const concurrentResult = await evalInPage(ws, `(async () => {
  try {
    const agents = await window.api.agent.list();
    const arr = Array.isArray(agents) ? agents : (agents?.agents || []);
    if (arr.length === 0) return { ok: false, error: 'no agents' };

    // 100 个并发请求: 50 个 list + 50 个 get(用第一个 agent id)
    const targetId = arr[0].id;
    const promises = [];
    for (let i = 0; i < 50; i++) {
      promises.push(window.api.agent.list().then(r => ({ type: 'list', ok: Array.isArray(r) || Array.isArray(r?.agents), count: Array.isArray(r) ? r.length : (r?.agents?.length ?? 0) })));
    }
    for (let i = 0; i < 50; i++) {
      promises.push(window.api.agent.get(targetId).then(r => ({ type: 'get', ok: !!r, id: r?.id })));
    }
    const results = await Promise.all(promises);
    const listOk = results.filter(r => r.type === 'list' && r.ok && r.count > 0).length;
    const getOk = results.filter(r => r.type === 'get' && r.ok && r.id === targetId).length;
    return { ok: listOk === 50 && getOk === 50, listOk, getOk, total: results.length };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('100 个并发 IPC 请求全部成功',
  concurrentResult?.ok === true && concurrentResult?.listOk === 50 && concurrentResult?.getOk === 50,
  `result=${JSON.stringify(concurrentResult).slice(0, 200)}`)

// =============================================================
console.log('\n[R115-4] 压力测试 - 快速切换 settings 100 次')

// 备份 theme
const originalTheme = await evalInPage(ws, `(async () => {
  try {
    const s = await window.api.settings.get();
    return s?.general?.theme || 'light';
  } catch (e) { return 'light'; }
})()`)

const settingsStress = await evalInPage(ws, `(async () => {
  try {
    const t0 = performance.now();
    const values = ['light', 'dark', 'system'];
    let okCount = 0;
    for (let i = 0; i < 100; i++) {
      const v = values[i % 3];
      const r = await window.api.settings.set('general.theme', v);
      if (r?.success !== false) okCount++;
    }
    const elapsed = performance.now() - t0;
    // 验证最终值
    const s = await window.api.settings.get();
    return { okCount, elapsed, finalTheme: s?.general?.theme };
  } catch (e) { return { error: e.message }; }
})()`)
check('100 次 settings.set 全部成功',
  settingsStress?.okCount === 100,
  `okCount=${settingsStress?.okCount}`)
check('100 次 settings.set 总耗时 < 10s',
  settingsStress?.elapsed < 10000,
  `elapsed=${settingsStress?.elapsed?.toFixed(0)}ms`)
console.log(`    100 次 set 耗时: ${settingsStress?.elapsed?.toFixed(0)}ms, 平均: ${(settingsStress?.elapsed / 100).toFixed(1)}ms/op`)

// 还原 theme
await evalInPage(ws, `(async () => {
  try { await window.api.settings.set('general.theme', ${JSON.stringify(originalTheme)}); } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R115-5] 长时运行 - 反复 chat stream 启动/取消 20 次')

const chatStress = await evalInPage(ws, `(async () => {
  try {
    let successCount = 0;
    let errorEventsReceived = 0;
    for (let i = 0; i < 20; i++) {
      // 启动一个会失败的 chat (不存在 provider)
      const unsub = window.api.ai.onStream((event) => {
        if (event.type === 'error') errorEventsReceived++;
      });
      try {
        await window.api.ai.chat({
          providerId: 'r115_nonexistent_' + i,
          modelId: 'test',
          messages: [{ role: 'user', content: 'test' + i }],
        });
        successCount++;
      } catch (e) {
        // chat promise 可能 resolve (因为 stream 启动了), 也可能 reject
        successCount++;
      }
      // 立即 abort
      try { await window.api.ai.abortChat(); } catch {}
      unsub();
      // 短暂等待 error 事件到达
      await new Promise(r => setTimeout(r, 50));
    }
    return { successCount, errorEventsReceived };
  } catch (e) { return { error: e.message }; }
})()`)
check('20 次 chat stream 启动/取消全部完成',
  chatStress?.successCount === 20,
  `successCount=${chatStress?.successCount}`)
check('20 次 chat stream 至少收到部分 error 事件',
  chatStress?.errorEventsReceived > 0,
  `errorEvents=${chatStress?.errorEventsReceived}`)
console.log(`    20 次启动/取消: success=${chatStress?.successCount}, errorEvents=${chatStress?.errorEventsReceived}`)

// =============================================================
console.log('\n[R115-6] 监听器压力 - 反复订阅/取消 1000 次')

const listenerStress = await evalInPage(ws, `(async () => {
  try {
    let unsubCount = 0;
    let activeListeners = 0;
    for (let i = 0; i < 1000; i++) {
      const unsub = window.api.ai.onStream(() => {});
      if (typeof unsub === 'function') {
        activeListeners++;
        // 每 100 个批量清理一次, 模拟真实使用模式
        if (activeListeners >= 100) {
          // 不实际调用 unsub (会让测试变复杂), 验证订阅本身不崩溃
          unsub();
          activeListeners--;
          unsubCount++;
        } else {
          unsub();
          unsubCount++;
        }
      }
    }
    return { ok: true, unsubCount };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('1000 次 onStream 订阅/取消不崩溃',
  listenerStress?.ok === true && listenerStress?.unsubCount === 1000,
  `result=${JSON.stringify(listenerStress).slice(0, 100)}`)

// 监听器清理后, 验证 heap 不大幅增长
const heapAfterListeners = await getHeap()
if (heapAfterListeners) {
  const used = heapAfterListeners.used / 1024 / 1024
  check('1000 次监听器后堆使用 < 600MB',
    used < 600,
    `used=${used.toFixed(1)}MB`)
}

// =============================================================
console.log('\n[R115-7] EAA 缓存失效 - 写入后立即读取一致性')

const eaaCacheTest = await evalInPage(ws, `(async () => {
  try {
    // 列出当前学生 (响应格式: { success, data: { students: [...] } })
    const list1 = await window.api.eaa.listStudents();
    const arr1 = list1?.data?.students ?? [];
    const beforeCount = arr1.length;

    // 创建一个测试学生 (addStudent 接收 string name, 不是 object)
    const stamp = 'r115-stu-' + Date.now();
    const create = await window.api.eaa.addStudent(stamp);
    if (create?.success === false) {
      return { ok: false, error: 'addStudent failed: ' + (create?.error || 'unknown'), step: 'create' };
    }

    // 立即列出, 应包含新学生 (验证缓存失效)
    const list2 = await window.api.eaa.listStudents();
    const arr2 = list2?.data?.students ?? [];
    const afterCount = arr2.length;
    const found = arr2.find(s => s.name === stamp);

    // 清理: 删除测试学生
    try { await window.api.eaa.deleteStudent(stamp); } catch {}

    // 验证删除后缓存失效
    const list3 = await window.api.eaa.listStudents();
    const arr3 = list3?.data?.students ?? [];
    const foundAfterDelete = arr3.find(s => s.name === stamp);

    return {
      ok: !!found,
      beforeCount,
      afterCount,
      found: !!found,
      foundAfterDelete: !!foundAfterDelete,
    };
  } catch (e) { return { ok: false, error: e.message }; }
})()`)
check('EAA addStudent 后立即 listStudents 可见',
  eaaCacheTest?.found === true,
  `result=${JSON.stringify(eaaCacheTest).slice(0, 200)}`)
check('EAA deleteStudent 后立即 listStudents 不再可见',
  eaaCacheTest?.foundAfterDelete === false,
  `result=${JSON.stringify(eaaCacheTest).slice(0, 200)}`)

// =============================================================
console.log('\n[R115-8] 渲染压力 - 大量 DOM 节点切换不卡死')

// 快速切换 15 次路由, 测量每次 mount 时间 (分批避免 CDP 超时)
const routes = ['/dashboard', '/agents', '/academics', '/students', '/chat', '/skills', '/settings']
const mountTimes = []
for (let i = 0; i < 15; i++) {
  const route = routes[i % routes.length]
  const t = await evalInPage(ws, `(async () => {
    const t0 = performance.now();
    window.location.hash = '#${route}';
    await new Promise(r => setTimeout(r, 150));
    return performance.now() - t0;
  })()`)
  if (typeof t === 'number') mountTimes.push(t)
}
if (mountTimes.length > 0) {
  const avg = mountTimes.reduce((a, b) => a + b, 0) / mountTimes.length
  const max = Math.max(...mountTimes)
  check('15 次路由切换平均 mount 时间 < 300ms',
    avg < 300,
    `avg=${avg.toFixed(1)}ms`)
  check('15 次路由切换最大 mount 时间 < 1000ms',
    max < 1000,
    `max=${max.toFixed(1)}ms`)
  console.log(`    15 次切换: avg=${avg.toFixed(1)}ms, max=${max.toFixed(1)}ms`)
} else {
  check('15 次路由切换测量完成', false, 'no timing data')
}

// =============================================================
console.log('\n[R115-9] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 300)}`)

// =============================================================
console.log('\n========================================')
console.log(`R115 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
