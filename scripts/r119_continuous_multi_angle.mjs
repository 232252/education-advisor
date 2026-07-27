// =============================================================
// R119: 持续多角度测试 (AI 调用循环 / 存储 / 内存 / 渲染)
// 角度 1: AI Agent 数据访问循环 - 模拟 agent 反复查询 EAA/班级/统计
// 角度 2: 存储一致性 - 反复读写 settings, 验证最终值
// 角度 3: 内存稳定性 - 100 次导航循环后堆增长
// 角度 4: 渲染压力 - 快速主题切换 + 路由切换
// 角度 5: IPC 吞吐 - 20 个并发只读 IPC
// 角度 6: 缓存行为 - invalidate 后立即并发读
// 角度 7: 长时间运行 - 模拟 agent 工具调用链
// 角度 8: 全程错误捕获
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

async function getHeap(ws) {
  return await evalInPage(ws, `(async () => {
    if (performance && performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
      };
    }
    return { used: 0, total: 0, limit: 0 };
  })()`)
}

let WebSocket
try {
  WebSocket = (await import('ws')).default
} catch {
  WebSocket = globalThis.WebSocket
}

const targets = await getTargets()
const pageTarget =
  targets.find((t) => t.type === 'page' && t.url.includes('index')) ||
  targets.find((t) => t.type === 'page')
if (!pageTarget) {
  console.error('No page target found.')
  process.exit(1)
}
console.log(`[R119] Connecting to: ${pageTarget.webSocketDebuggerUrl}`)
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
  window.__r119Errors = [];
  if (!window.__r119HookInstalled) {
    window.addEventListener('error', (e) => {
      window.__r119Errors.push({ type: 'error', message: e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason && (e.reason.message || e.reason.toString) ? (e.reason.message || String(e.reason)) : String(e.reason);
      window.__r119Errors.push({ type: 'unhandledrejection', message: msg });
    });
    window.__r119HookInstalled = true;
  }
  true
`)
async function getErrors() {
  return await evalInPage(ws, `JSON.parse(JSON.stringify(window.__r119Errors || []))`)
}

console.log('\n=== R119: 持续多角度测试 (AI 调用循环/存储/内存/渲染) ===')

// =============================================================
console.log('\n[R119-1] AI Agent 数据访问循环 - 模拟 agent 反复查询')

// 模拟 agent 工具调用链: listStudents → history → stats → codes → ranking
const agentLoopResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const callCounts = {};
  // 模拟 5 轮 agent 数据访问
  for (let round = 0; round < 5; round++) {
    try {
      // 1. listStudents (agent 先列出学生)
      const list = await window.api.eaa.listStudents();
      callCounts.listStudents = (callCounts.listStudents || 0) + 1;
      if (!list?.success) errors.push('round ' + round + ' listStudents failed');

      // 2. 取前 3 个学生查询 history (agent 分析个体)
      const students = list?.data?.students || [];
      for (let i = 0; i < Math.min(3, students.length); i++) {
        try {
          await window.api.eaa.history(students[i].name);
          callCounts.history = (callCounts.history || 0) + 1;
        } catch (e) { errors.push('history ' + students[i].name + ': ' + e.message); }
      }

      // 3. stats (agent 全局统计)
      try {
        await window.api.eaa.stats();
        callCounts.stats = (callCounts.stats || 0) + 1;
      } catch (e) { errors.push('stats: ' + e.message); }

      // 4. codes (agent 查原因码)
      try {
        await window.api.eaa.codes();
        callCounts.codes = (callCounts.codes || 0) + 1;
      } catch (e) { errors.push('codes: ' + e.message); }

      // 5. ranking (agent 排名)
      try {
        await window.api.eaa.ranking();
        callCounts.ranking = (callCounts.ranking || 0) + 1;
      } catch (e) { errors.push('ranking: ' + e.message); }
    } catch (e) {
      errors.push('round ' + round + ': ' + e.message);
    }
  }
  return {
    rounds: 5,
    callCounts,
    errorCount: errors.length,
    errorSample: errors.slice(0, 3),
  };
})()`)
check('5 轮 agent 数据访问循环无失败',
  agentLoopResult?.errorCount === 0 &&
    (agentLoopResult?.callCounts?.listStudents || 0) === 5,
  `result=${JSON.stringify(agentLoopResult).slice(0, 250)}`)

// =============================================================
console.log('\n[R119-2] 存储一致性 - 反复读写 settings')

const storageResult = await evalInPage(ws, `(async () => {
  const errors = [];
  // 20 轮 set + get 循环
  for (let i = 0; i < 20; i++) {
    const val = 'r119-cycle-' + i;
    try {
      await window.api.settings.set('general.defaultOperator', val);
      const s = await window.api.settings.get();
      if (s?.general?.defaultOperator !== val) {
        errors.push('cycle ' + i + ': expected ' + val + ' got ' + s?.general?.defaultOperator);
      }
    } catch (e) { errors.push('cycle ' + i + ': ' + e.message); }
  }
  return { cycles: 20, errorCount: errors.length, errorSample: errors.slice(0, 2) };
})()`)
check('20 轮 set+get settings 值一致',
  storageResult?.errorCount === 0,
  `result=${JSON.stringify(storageResult).slice(0, 200)}`)

// 恢复默认
await evalInPage(ws, `(async () => {
  try { await window.api.settings.set('general.defaultOperator', 'teacher'); } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R119-3] 内存稳定性 - 100 次导航循环后堆增长')

const heapBefore = await getHeap(ws)
const navResult = await evalInPage(ws, `(async () => {
  const routes = ['#/dashboard', '#/agents', '#/skills', '#/settings', '#/chat',
                  '#/students', '#/classes', '#/academics', '#/scheduler', '#/privacy'];
  let errors = 0;
  for (let i = 0; i < 100; i++) {
    const route = routes[i % routes.length];
    window.location.hash = route;
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 150));
  }
  await new Promise(r => setTimeout(r, 1000));
  return { navCount: 100, errors };
})()`)
const heapAfter = await getHeap(ws)
const growthMB = heapAfter && heapBefore ? (heapAfter.used - heapBefore.used) / 1024 / 1024 : 0
check('100 次导航循环完成',
  navResult?.navCount === 100,
  `result=${JSON.stringify(navResult)}`)
check('100 次导航后堆增长 < 60MB',
  growthMB < 60,
  `before=${(heapBefore?.used / 1024 / 1024).toFixed(1)}MB, after=${(heapAfter?.used / 1024 / 1024).toFixed(1)}MB, growth=${growthMB.toFixed(1)}MB`)

// =============================================================
console.log('\n[R119-4] 渲染压力 - 快速主题切换 + 路由切换')

const renderStressResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const themes = ['dark', 'light', 'system'];
  const routes = ['#/dashboard', '#/agents', '#/settings'];
  // 30 轮: 每轮切换主题 + 切换路由
  for (let i = 0; i < 30; i++) {
    try {
      const theme = themes[i % 3];
      const route = routes[i % 3];
      await window.api.settings.set('general.theme', theme);
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: theme }));
      window.location.hash = route;
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 100));
    } catch (e) { errors.push('round ' + i + ': ' + e.message); }
  }
  await new Promise(r => setTimeout(r, 500));
  // 验证页面仍可渲染
  const main = document.querySelector('main');
  const hasContent = (main?.innerText?.length ?? 0) > 10;
  return { rounds: 30, errorCount: errors.length, hasContent, errorSample: errors.slice(0, 2) };
})()`)
check('30 轮主题+路由切换无错误且页面正常',
  renderStressResult?.errorCount === 0 && renderStressResult?.hasContent === true,
  `result=${JSON.stringify(renderStressResult).slice(0, 200)}`)

// 恢复主题
await evalInPage(ws, `(async () => {
  try {
    await window.api.settings.set('general.theme', 'dark');
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }));
  } catch {}
  return true;
})()`)

// =============================================================
console.log('\n[R119-5] IPC 吞吐 - 20 个并发只读 IPC')

const throughputResult = await evalInPage(ws, `(async () => {
  const t0 = Date.now();
  const calls = [];
  // 20 个并发只读调用
  for (let i = 0; i < 20; i++) {
    calls.push(window.api.eaa.listStudents().catch(e => ({ error: e.message })));
    calls.push(window.api.eaa.codes().catch(e => ({ error: e.message })));
    calls.push(window.api.settings.get().catch(e => ({ error: e.message })));
  }
  const results = await Promise.all(calls);
  const elapsed = Date.now() - t0;
  const errors = results.filter(r => r?.error).length;
  return {
    totalCalls: results.length,
    elapsed,
    errors,
    avgMs: Math.round(elapsed / results.length * 10) / 10,
  };
})()`)
check('60 个并发只读 IPC 全部成功 (< 5s)',
  throughputResult?.errors === 0 && throughputResult?.elapsed < 5000,
  `result=${JSON.stringify(throughputResult)}`)

// =============================================================
console.log('\n[R119-6] 缓存行为 - invalidate 后立即并发读')

const cacheResult = await evalInPage(ws, `(async () => {
  // 先 invalidate
  await window.api.eaa.invalidateCache();
  // 立即并发 10 个 listStudents (测试缓存重建无竞态)
  const t0 = Date.now();
  const calls = [];
  for (let i = 0; i < 10; i++) {
    calls.push(window.api.eaa.listStudents().catch(e => ({ error: e.message })));
  }
  const results = await Promise.all(calls);
  const elapsed = Date.now() - t0;
  const success = results.filter(r => r?.success !== false && !r?.error).length;
  return { successCount: success, elapsed, totalCalls: results.length };
})()`)
check('invalidate 后 10 个并发 listStudents 全部成功',
  cacheResult?.successCount === 10,
  `result=${JSON.stringify(cacheResult)}`)

// =============================================================
console.log('\n[R119-7] 长时间运行 - 模拟 agent 工具调用链 (含班级)')

const longRunResult = await evalInPage(ws, `(async () => {
  const errors = [];
  const counts = {};
  // 模拟 10 轮完整的 agent 工作流
  for (let round = 0; round < 10; round++) {
    try {
      // 1. 列出班级
      const classes = await window.api.class.list();
      counts.classList = (counts.classList || 0) + 1;
      // 2. 列出学生
      const students = await window.api.eaa.listStudents();
      counts.listStudents = (counts.listStudents || 0) + 1;
      // 3. 统计
      await window.api.eaa.stats();
      counts.stats = (counts.stats || 0) + 1;
      // 4. 排名
      await window.api.eaa.ranking();
      counts.ranking = (counts.ranking || 0) + 1;
      // 5. doctor 健康检查
      await window.api.eaa.doctor();
      counts.doctor = (counts.doctor || 0) + 1;
    } catch (e) {
      errors.push('round ' + round + ': ' + e.message);
    }
  }
  return {
    rounds: 10,
    counts,
    errorCount: errors.length,
    errorSample: errors.slice(0, 3),
  };
})()`)
check('10 轮 agent 工作流 (班级+学生+统计+排名+doctor) 无错误',
  longRunResult?.errorCount === 0 && (longRunResult?.counts?.classList || 0) === 10,
  `result=${JSON.stringify(longRunResult).slice(0, 250)}`)

// =============================================================
console.log('\n[R119-8] 全程错误捕获')
const finalErrors = await getErrors()
check('全程 0 unhandledrejection/error',
  finalErrors.length === 0,
  `errors=${JSON.stringify(finalErrors).slice(0, 500)}`)

// =============================================================
console.log('\n========================================')
console.log(`R119 结果: ✅ pass=${results.pass}, ❌ fail=${results.fail}`)
if (results.fail > 0) {
  console.log(`失败项: ${JSON.stringify(results.errors, null, 2)}`)
}
console.log('========================================')

ws.close()
process.exit(results.fail > 0 ? 1 : 0)
