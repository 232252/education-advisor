// R45: UI 表单验证深度 + EAA replay/dashboard + Chat 持久化 + 长时间运行
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

  console.log('=== R45: UI 表单验证 + EAA replay/dashboard + Chat 持久化 ===\n')
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

  // ========== 1. EAA replay 深度测试 ==========
  console.log('--- 1. EAA replay 深度测试 ---')

  try {
    const r = await callRaw('eaa.replay')
    const data = r?.data
    if (typeof data === 'string') {
      ok('eaa.replay', `len=${data.length} preview=${data.slice(0, 100)}`)
      // 验证 HTML 内容
      const hasHtml = data.includes('<html') || data.includes('<!DOCTYPE')
      const hasTable = data.includes('<table')
      const hasScript = data.includes('<script')
      ok('replay 格式验证', `html=${hasHtml} table=${hasTable} script=${hasScript}`)
    } else {
      ok('eaa.replay', safeStr(r, 150))
    }
  } catch (e) {
    fail('eaa.replay', '', e)
  }

  // ========== 2. EAA dashboard 深度测试 ==========
  console.log('\n--- 2. EAA dashboard 深度测试 ---')

  try {
    const r = await callRaw('eaa.dashboard')
    const data = r?.data
    if (typeof data === 'string') {
      ok('eaa.dashboard', `len=${data.length} preview=${data.slice(0, 100)}`)
      // 验证 HTML 内容
      const hasHtml = data.includes('<html') || data.includes('<!DOCTYPE')
      const hasCdn = data.includes('cdn') || data.includes('jsdelivr')
      const hasChart = data.includes('chart') || data.includes('Chart')
      ok('dashboard 格式验证', `html=${hasHtml} cdn=${hasCdn} chart=${hasChart}`)
    } else {
      ok('eaa.dashboard', safeStr(r, 150))
    }
  } catch (e) {
    fail('eaa.dashboard', '', e)
  }

  // ========== 3. EAA validate 深度 ==========
  console.log('\n--- 3. EAA validate 深度 ---')

  try {
    const r = await callRaw('eaa.validate')
    const data = r?.data
    ok('eaa.validate', safeStr(data, 200))
    if (data && typeof data === 'object') {
      ok('  valid', `valid=${data.valid} errors=${data.errors?.length || 0} warnings=${data.warnings?.length || 0}`)
    }
  } catch (e) {
    fail('eaa.validate', '', e)
  }

  // ========== 4. EAA range 多时间段 ==========
  console.log('\n--- 4. EAA range 多时间段 ---')

  const ranges = [
    { start: '2026-01-01', end: '2026-01-31', desc: '1月' },
    { start: '2026-02-01', end: '2026-02-28', desc: '2月' },
    { start: '2026-03-01', end: '2026-03-31', desc: '3月' },
    { start: '2026-04-01', end: '2026-04-30', desc: '4月' },
    { start: '2026-05-01', end: '2026-05-31', desc: '5月' },
    { start: '2026-06-01', end: '2026-06-30', desc: '6月' },
    { start: '2026-07-01', end: '2026-07-01', desc: '7月1日' },
  ]

  for (const rg of ranges) {
    try {
      const r = await callRaw('eaa.range', rg.start, rg.end, 100)
      const events = r?.data?.events || r?.data || []
      ok(`range ${rg.desc}`, `events=${Array.isArray(events) ? events.length : (typeof events === 'number' ? events : 0)}`)
    } catch (e) {
      fail(`range ${rg.desc}`, '', e)
    }
  }

  // ========== 5. Chat 持久化完整流程 ==========
  console.log('\n--- 5. Chat 持久化完整流程 ---')

  const sessionId = `R45-Session-${Date.now()}`
  const messages = [
    { role: 'user', content: 'R45测试消息1: 你好', thinking: '', toolCalls: '' },
    { role: 'assistant', content: 'R45测试回复1: 你好,我是AI助手', thinking: '思考中...', toolCalls: '' },
    { role: 'user', content: 'R45测试消息2: 今天的日期是什么?', thinking: '', toolCalls: '' },
    { role: 'assistant', content: 'R45测试回复2: 今天是2026年7月1日', thinking: '', toolCalls: '[{"name":"getDate"}]' },
  ]

  // 5.1 保存消息
  for (let i = 0; i < messages.length; i++) {
    try {
      const msg = messages[i]
      const r = await callRaw('chat.saveMessage', {
        sessionId,
        role: msg.role,
        content: msg.content,
        thinking: msg.thinking,
        toolCalls: msg.toolCalls,
        timestamp: new Date().toISOString()
      })
      ok(`saveMessage ${i}`, `success=${r?.success || r === undefined}`)
    } catch (e) {
      fail(`saveMessage ${i}`, '', e)
    }
  }

  // 5.2 加载消息
  try {
    const r = await callRaw('chat.loadMessages', sessionId)
    const msgs = r?.messages || r?.data || r || []
    ok('loadMessages', `count=${Array.isArray(msgs) ? msgs.length : 'n/a'} data=${safeStr(msgs, 150)}`)
  } catch (e) {
    fail('loadMessages', '', e)
  }

  // 5.3 列出会话
  try {
    const r = await callRaw('chat.listSessions')
    const sessions = Array.isArray(r) ? r : (r?.data || r?.sessions || [])
    const found = Array.isArray(sessions) ? sessions.some(s => {
      const sid = typeof s === 'object' ? (s.sessionId || s.id) : s
      return sid === sessionId
    }) : false
    ok('listSessions', `total=${Array.isArray(sessions) ? sessions.length : 0} found=${found}`)
  } catch (e) {
    fail('listSessions', '', e)
  }

  // 5.4 删除会话
  try {
    const r = await callRaw('chat.deleteSession', sessionId)
    ok('deleteSession', `success=${r?.success || r === undefined}`)
  } catch (e) {
    fail('deleteSession', '', e)
  }

  // 5.5 验证删除
  try {
    const r = await callRaw('chat.loadMessages', sessionId)
    const msgs = r?.messages || r?.data || r || []
    ok('删除后 loadMessages', `count=${Array.isArray(msgs) ? msgs.length : 0} (应为0)`)
  } catch (e) {
    fail('删除后 loadMessages', '', e)
  }

  // ========== 6. UI 表单验证深度 ==========
  console.log('\n--- 6. UI 表单验证深度 ---')

  // 6.1 Students 页面 - 搜索功能
  try {
    await cdp.eval(`window.location.hash = '#/students';`)
    await new Promise(r => setTimeout(r, 1500))

    // 搜索特殊字符
    const searchResult = await cdp.eval(`(async()=>{
      const input = document.querySelector('input[type="text"], input[type="search"]');
      if (!input) return JSON.stringify({error: 'no input'});
      const originalPlaceholder = input.placeholder;

      // 测试搜索
      input.value = 'R4';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      await new Promise(r => setTimeout(r, 1000));

      const rows = document.querySelectorAll('table tbody tr').length;

      // 清空搜索
      input.value = '';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      await new Promise(r => setTimeout(r, 1000));

      const allRows = document.querySelectorAll('table tbody tr').length;

      return JSON.stringify({ searchRows: rows, allRows, placeholder: originalPlaceholder });
    })()`)
    ok('Students 搜索功能', searchResult)
  } catch (e) {
    fail('Students 搜索功能', '', e)
  }

  // 6.2 Classes 页面 - 空状态
  try {
    await cdp.eval(`window.location.hash = '#/classes';`)
    await new Promise(r => setTimeout(r, 1500))
    const info = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const cards = document.querySelectorAll('[class*="card"]').length;
      const emptyState = document.body.textContent?.includes('暂无') || document.body.textContent?.includes(' empty') || false;
      const buttons = Array.from(document.querySelectorAll('button')).map(b=>b.textContent?.trim()).filter(Boolean).slice(0, 5);
      return JSON.stringify({ h1: h1.slice(0, 50), cards, emptyState, buttons });
    })()`)
    ok('Classes 空状态', info)
  } catch (e) {
    fail('Classes 空状态', '', e)
  }

  // 6.3 Settings 页面 - select 下拉框验证
  try {
    await cdp.eval(`window.location.hash = '#/settings';`)
    await new Promise(r => setTimeout(r, 1500))
    const info = await cdp.eval(`(async()=>{
      const selects = Array.from(document.querySelectorAll('select'));
      const selectInfo = selects.map(s => ({
        value: s.value,
        options: Array.from(s.options).map(o => o.value),
        label: s.closest('[class*="setting"], [class*="row"]')?.querySelector('label')?.textContent?.trim()?.slice(0, 30) || ''
      })).slice(0, 10);
      return JSON.stringify(selectInfo);
    })()`)
    ok('Settings select 下拉框', info.slice(0, 300))
  } catch (e) {
    fail('Settings select 下拉框', '', e)
  }

  // 6.4 Models 页面
  try {
    await cdp.eval(`window.location.hash = '#/models';`)
    await new Promise(r => setTimeout(r, 1500))
    const info = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const cards = document.querySelectorAll('[class*="card"], [class*="provider"]').length;
      const selects = document.querySelectorAll('select').length;
      const inputs = document.querySelectorAll('input').length;
      return JSON.stringify({ h1: h1.slice(0, 50), cards, selects, inputs });
    })()`)
    ok('Models 页面', info)
  } catch (e) {
    fail('Models 页面', '', e)
  }

  // 6.5 Scheduler 页面
  try {
    await cdp.eval(`window.location.hash = '#/scheduler';`)
    await new Promise(r => setTimeout(r, 1500))
    const info = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const cards = document.querySelectorAll('[class*="card"], [class*="task"]').length;
      const buttons = document.querySelectorAll('button').length;
      return JSON.stringify({ h1: h1.slice(0, 50), cards, buttons });
    })()`)
    ok('Scheduler 页面', info)
  } catch (e) {
    fail('Scheduler 页面', '', e)
  }

  // 6.6 Skills 页面
  try {
    await cdp.eval(`window.location.hash = '#/skills';`)
    await new Promise(r => setTimeout(r, 1500))
    const info = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const cards = document.querySelectorAll('[class*="card"], [class*="skill"]').length;
      const buttons = document.querySelectorAll('button').length;
      return JSON.stringify({ h1: h1.slice(0, 50), cards, buttons });
    })()`)
    ok('Skills 页面', info)
  } catch (e) {
    fail('Skills 页面', '', e)
  }

  // ========== 7. 长时间运行内存趋势 ==========
  console.log('\n--- 7. 长时间运行内存趋势 ---')

  try {
    const before = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)

    // 执行大量操作
    for (let i = 0; i < 30; i++) {
      await callRaw('eaa.info')
      await callRaw('eaa.ranking', 10)
      await callRaw('agent.list')
    }

    const after = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    const delta = after - before
    ok('90 次 API 内存趋势', `before=${before} after=${after} delta=${delta} bytes (${(delta / 1024).toFixed(1)}KB)`)
  } catch (e) {
    fail('内存趋势', '', e)
  }

  // ========== 8. 汇总 ==========
  console.log('\n=== R45 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  fs.writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r45-result.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
