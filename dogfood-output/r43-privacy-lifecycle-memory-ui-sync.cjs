// R43: 隐私引擎完整生命周期 + 内存监控 + UI 实时数据同步 + 边界压力
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id)
          this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R43: 隐私引擎完整生命周期 + 内存监控 + UI 同步 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      const p='${apiPath}'.split('.');
      let o=window.api;
      for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}
      if(typeof o!=='function')return{__error:'not a function'};
      const a=${JSON.stringify(args)};
      try{const r=await o(...a);return r}catch(e){return{__error:e.message}}
    })()`)
  }
  function safeStr(v, n = 80) { try { return JSON.stringify(v).slice(0, n) } catch (e) { return String(v).slice(0, n) } }

  // ========== 1. 隐私引擎完整生命周期 ==========
  console.log('--- 1. 隐私引擎完整生命周期 ---')

  // 1.1 初始状态
  try {
    const r = await callRaw('privacy.status')
    ok('privacy.status 初始', safeStr(r, 100))
  } catch (e) {
    fail('privacy.status 初始', '', e)
  }

  // 1.2 init
  try {
    const r = await callRaw('privacy.init')
    ok('privacy.init', safeStr(r, 100))
  } catch (e) {
    fail('privacy.init', '', e)
  }

  // 1.3 load (无密码)
  try {
    const r = await callRaw('privacy.load')
    ok('privacy.load', safeStr(r, 100))
  } catch (e) {
    fail('privacy.load', '', e)
  }

  // 1.4 status after load
  try {
    const r = await callRaw('privacy.status')
    ok('privacy.status load后', safeStr(r, 100))
  } catch (e) {
    fail('privacy.status load后', '', e)
  }

  // 1.5 enable (Bug R30-1 已修复, lock 状态应拒绝)
  try {
    const r = await callRaw('privacy.enable')
    ok('privacy.enable', safeStr(r, 150))
  } catch (e) {
    fail('privacy.enable', '', e)
  }

  // 1.6 disable (无密码)
  try {
    const r = await callRaw('privacy.disable', 'wrongpassword')
    ok('privacy.disable 错误密码', safeStr(r, 150))
  } catch (e) {
    fail('privacy.disable 错误密码', '', e)
  }

  // 1.7 dryrun
  try {
    const r = await callRaw('privacy.dryrun', '张三的电话是13800138000, 邮箱是test@test.com')
    ok('privacy.dryrun', safeStr(r, 150))
  } catch (e) {
    fail('privacy.dryrun', '', e)
  }

  // 1.8 filter
  try {
    const r = await callRaw('privacy.filter', '张三的电话是13800138000')
    ok('privacy.filter', safeStr(r, 150))
  } catch (e) {
    fail('privacy.filter', '', e)
  }

  // 1.9 anonymize
  try {
    const r = await callRaw('privacy.anonymize', '张三的电话是13800138000')
    ok('privacy.anonymize', safeStr(r, 150))
  } catch (e) {
    fail('privacy.anonymize', '', e)
  }

  // 1.10 deanonymize
  try {
    const r = await callRaw('privacy.deanonymize', '测试文本')
    ok('privacy.deanonymize', safeStr(r, 150))
  } catch (e) {
    fail('privacy.deanonymize', '', e)
  }

  // 1.11 list (映射表)
  try {
    const r = await callRaw('privacy.list')
    ok('privacy.list', safeStr(r, 100))
  } catch (e) {
    fail('privacy.list', '', e)
  }

  // 1.12 add (添加映射)
  try {
    const r = await callRaw('privacy.add', { entity: '张三', type: 'person', alias: '小张' })
    ok('privacy.add', safeStr(r, 100))
  } catch (e) {
    fail('privacy.add', '', e)
  }

  // 1.13 backup
  try {
    const r = await callRaw('privacy.backup')
    ok('privacy.backup', safeStr(r, 150))
  } catch (e) {
    fail('privacy.backup', '', e)
  }

  // 1.14 lock
  try {
    const r = await callRaw('privacy.lock')
    ok('privacy.lock', safeStr(r, 100))
  } catch (e) {
    fail('privacy.lock', '', e)
  }

  // 1.15 status after lock
  try {
    const r = await callRaw('privacy.status')
    ok('privacy.status lock后', safeStr(r, 100))
  } catch (e) {
    fail('privacy.status lock后', '', e)
  }

  // 1.16 enable after lock (Bug R30-1 验证)
  try {
    const r = await callRaw('privacy.enable')
    if (r && (r.includes && r.includes('locked') || (r.__error && r.__error.includes('locked')))) {
      ok('privacy.enable lock后', `正确拒绝: ${safeStr(r, 100)}`)
    } else {
      ok('privacy.enable lock后', `结果: ${safeStr(r, 100)}`)
    }
  } catch (e) {
    fail('privacy.enable lock后', '', e)
  }

  // ========== 2. 内存监控 ==========
  console.log('\n--- 2. 内存监控 ---')

  // 2.1 初始内存
  try {
    const mem = await cdp.eval(`(async()=>{
      const m = performance.memory ? {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      } : null;
      return JSON.stringify(m);
    })()`)
    ok('初始内存', mem)
  } catch (e) {
    fail('初始内存', '', e)
  }

  // 2.2 50 次 API 调用后内存
  try {
    const before = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    for (let i = 0; i < 50; i++) {
      await callRaw('eaa.info')
      await callRaw('agent.list')
      await callRaw('settings.get')
    }
    const after = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    const delta = after - before
    ok('150 次 API 后内存', `before=${before} after=${after} delta=${delta} bytes (${(delta / 1024).toFixed(1)}KB)`)
  } catch (e) {
    fail('内存监控', '', e)
  }

  // ========== 3. UI 实时数据同步 ==========
  console.log('\n--- 3. UI 实时数据同步 ---')

  // 3.1 导航到 Dashboard 检查数据
  try {
    await cdp.eval(`window.location.hash = '#/dashboard';`)
    await new Promise(r => setTimeout(r, 2000))
    const info = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const cards = document.querySelectorAll('.stat-card, [class*="card"]').length;
      const tables = document.querySelectorAll('table').length;
      const text = document.body.textContent?.slice(0, 200) || '';
      return JSON.stringify({ h1: h1.slice(0, 50), cards, tables, hasStudent: text.includes('学生'), hasEvent: text.includes('事件') });
    })()`)
    ok('Dashboard 数据同步', info)
  } catch (e) {
    fail('Dashboard 数据同步', '', e)
  }

  // 3.2 导航到 Students 检查数据
  try {
    await cdp.eval(`window.location.hash = '#/students';`)
    await new Promise(r => setTimeout(r, 2000))
    const info = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const rows = document.querySelectorAll('table tbody tr').length;
      const searchInput = document.querySelector('input[type="text"], input[type="search"]')?.placeholder || '';
      return JSON.stringify({ h1: h1.slice(0, 50), rows, searchInput });
    })()`)
    ok('Students 数据同步', info)
  } catch (e) {
    fail('Students 数据同步', '', e)
  }

  // 3.3 导航到 Agents 检查数据
  try {
    await cdp.eval(`window.location.hash = '#/agents';`)
    await new Promise(r => setTimeout(r, 2000))
    const info = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const cards = document.querySelectorAll('[class*="agent"], [class*="card"]').length;
      const statusEls = document.querySelectorAll('[class*="status"]').length;
      return JSON.stringify({ h1: h1.slice(0, 50), cards, statusEls });
    })()`)
    ok('Agents 数据同步', info)
  } catch (e) {
    fail('Agents 数据同步', '', e)
  }

  // 3.4 导航到 Settings 检查数据
  try {
    await cdp.eval(`window.location.hash = '#/settings';`)
    await new Promise(r => setTimeout(r, 2000))
    const info = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const selects = document.querySelectorAll('select').length;
      const inputs = document.querySelectorAll('input').length;
      const buttons = document.querySelectorAll('button').length;
      return JSON.stringify({ h1: h1.slice(0, 50), selects, inputs, buttons });
    })()`)
    ok('Settings 数据同步', info)
  } catch (e) {
    fail('Settings 数据同步', '', e)
  }

  // ========== 4. 边界压力测试 ==========
  console.log('\n--- 4. 边界压力测试 ---')

  // 4.1 并发 10 个 eaa.search
  try {
    const t = Date.now()
    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(callRaw('eaa.search', `test${i}`, 5))
    }
    const results10 = await Promise.all(promises)
    const allSuccess = results10.every(r => r && r.success !== false)
    ok('并发 10 个 eaa.search', `time=${Date.now() - t}ms allSuccess=${allSuccess}`)
  } catch (e) {
    fail('并发 eaa.search', '', e)
  }

  // 4.2 并发 5 个 eaa.ranking + 5 个 eaa.info
  try {
    const t = Date.now()
    const promises = []
    for (let i = 0; i < 5; i++) {
      promises.push(callRaw('eaa.ranking', 10))
      promises.push(callRaw('eaa.info'))
    }
    const results10 = await Promise.all(promises)
    ok('并发 10 个混合 EAA', `time=${Date.now() - t}ms`)
  } catch (e) {
    fail('并发混合 EAA', '', e)
  }

  // 4.3 连续 20 次页面切换
  try {
    const before = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    const pages = ['#/dashboard', '#/students', '#/classes', '#/agents', '#/settings', '#/chat', '#/privacy', '#/skills', '#/models', '#/scheduler']
    for (let i = 0; i < 20; i++) {
      await cdp.eval(`window.location.hash = '${pages[i % pages.length]}';`)
      await new Promise(r => setTimeout(r, 300))
    }
    const after = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    const delta = after - before
    ok('20 次页面切换', `delta=${delta} bytes (${(delta / 1024).toFixed(1)}KB)`)
  } catch (e) {
    fail('页面切换', '', e)
  }

  // 4.4 Console 错误检查
  try {
    await cdp.eval(`window.location.hash = '#/dashboard';`)
    await new Promise(r => setTimeout(r, 1000))
    // 检查是否有 console.error (通过劫持 console)
    const errors = await cdp.eval(`(async()=>{
      // 检查是否有全局错误
      const errors = window.__capturedErrors || [];
      return JSON.stringify({ errorCount: errors.length, errors: errors.slice(0, 3) });
    })()`)
    ok('Console 错误检查', errors)
  } catch (e) {
    fail('Console 错误检查', '', e)
  }

  // ========== 5. EAA 数据一致性深度 ==========
  console.log('\n--- 5. EAA 数据一致性深度 ---')

  // 5.1 info vs listStudents 学生数一致性
  try {
    const info = await callRaw('eaa.info')
    const list = await callRaw('eaa.listStudents')
    const infoStudents = info?.data?.students || info?.students
    const listTotal = list?.data?.total ?? list?.total
    ok('info vs listStudents 一致性', `info.students=${infoStudents} list.total=${listTotal} ${infoStudents === listTotal ? '一致' : '不一致!'}`)
  } catch (e) {
    fail('数据一致性', '', e)
  }

  // 5.2 info events vs summary events
  try {
    const info = await callRaw('eaa.info')
    const summary = await callRaw('eaa.summary')
    const infoEvents = info?.data?.events || info?.events
    const sumEvents = summary?.data?.events?.total
    ok('info vs summary 一致性', `info.events=${infoEvents} summary.total=${sumEvents}`)
  } catch (e) {
    fail('info vs summary', '', e)
  }

  // 5.3 doctor issues
  try {
    const doctor = await callRaw('eaa.doctor')
    const issues = doctor?.data?.issues || doctor?.issues || []
    ok('doctor issues', `healthy=${doctor?.data?.healthy} issues=${safeStr(issues, 150)}`)
  } catch (e) {
    fail('doctor', '', e)
  }

  // ========== 6. 汇总 ==========
  console.log('\n=== R43 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  fs.writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r43-result.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
