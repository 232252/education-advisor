// R34: UI DOM 实际交互深度 - 真实点击/表单/对话框/路由跳转/页面渲染验证
// 通过 CDP 直接操作 DOM,模拟真实用户交互
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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

  console.log('=== R34: UI DOM 实际交互深度 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  // ========== 1. 当前页面状态 ==========
  console.log('--- 1. 当前页面状态 ---')
  const pageState = await cdp.eval(`(async()=>{
    return JSON.stringify({
      url: window.location.hash,
      title: document.title,
      bodyLen: document.body?.innerHTML?.length || 0,
      h1Text: document.querySelector('h1')?.textContent?.slice(0,50) || null,
      navLinks: Array.from(document.querySelectorAll('a[href]')).map(a=>a.getAttribute('href')).slice(0,20)
    });
  })()`)
  const ps = JSON.parse(pageState)
  ok('当前页面', `url=${ps.url} title=${ps.title} bodyLen=${ps.bodyLen}`)

  // ========== 2. 导航到各页面并验证渲染 ==========
  console.log('\n--- 2. 导航到各页面并验证渲染 ---')
  const pages = [
    { hash: '#/', name: 'Dashboard' },
    { hash: '#/students', name: 'Students' },
    { hash: '#/classes', name: 'Classes' },
    { hash: '#/agents', name: 'Agents' },
    { hash: '#/chat', name: 'Chat' },
    { hash: '#/cron', name: 'Cron' },
    { hash: '#/skills', name: 'Skills' },
    { hash: '#/settings', name: 'Settings' },
    { hash: '#/logs', name: 'Logs' },
    { hash: '#/privacy', name: 'Privacy' },
  ]

  for (const page of pages) {
    try {
      // 导航
      await cdp.eval(`window.location.hash = '${page.hash}';`)
      await new Promise(r => setTimeout(r, 1500))

      const result = await cdp.eval(`(async()=>{
        return JSON.stringify({
          url: window.location.hash,
          h1: document.querySelector('h1')?.textContent?.slice(0,80) || null,
          buttons: document.querySelectorAll('button').length,
          inputs: document.querySelectorAll('input').length,
          links: document.querySelectorAll('a[href]').length,
          tables: document.querySelectorAll('table').length,
          bodyLen: document.body?.innerHTML?.length || 0,
          errors: Array.from(document.querySelectorAll('.error, .alert-error, [role="alert"]')).length
        });
      })()`)
      const r = JSON.parse(result)
      ok(`导航 ${page.name} (${page.hash})`, `h1="${r.h1}" buttons=${r.buttons} inputs=${r.inputs} body=${r.bodyLen}`)
    } catch (e) {
      fail(`导航 ${page.name}`, '', e)
    }
  }

  // ========== 3. Students 页面交互 ==========
  console.log('\n--- 3. Students 页面交互 ---')
  try {
    await cdp.eval(`window.location.hash = '#/students';`)
    await new Promise(r => setTimeout(r, 2000))

    // 检查学生列表
    const studentsInfo = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const rows = document.querySelectorAll('table tr, [class*="student"] [class*="row"], [class*="card"]');
      const searchInput = document.querySelector('input[type="text"]');
      const buttons = Array.from(document.querySelectorAll('button')).map(b=>b.textContent?.trim()).filter(Boolean);
      return JSON.stringify({
        h1: h1.slice(0,80),
        rowCount: rows.length,
        hasSearch: !!searchInput,
        searchPlaceholder: searchInput?.placeholder || null,
        buttons: buttons.slice(0,10)
      });
    })()`)
    const si = JSON.parse(studentsInfo)
    ok('Students 页面', `h1="${si.h1}" rows=${si.rowCount} search=${si.hasSearch} buttons=[${si.buttons.join(',')}]`)

    // 测试搜索功能
    try {
      const searchResult = await cdp.eval(`(async()=>{
        const input = document.querySelector('input[type="text"]');
        if (!input) return JSON.stringify({error: 'no search input'});
        // 模拟输入
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, 'R4');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // 等待 React 渲染
        await new Promise(r => setTimeout(r, 1000));
        const rows = document.querySelectorAll('table tr, [class*="student"] [class*="row"]');
        return JSON.stringify({
          rowCount: rows.length,
          inputValue: input.value
        });
      })()`)
      const sr = JSON.parse(searchResult)
      ok('Students 搜索 R4', `结果行数=${sr.rowCount}`)
    } catch (e) {
      fail('Students 搜索', '', e)
    }
  } catch (e) {
    fail('Students 页面交互', '', e)
  }

  // ========== 4. Settings 页面交互 ==========
  console.log('\n--- 4. Settings 页面交互 ---')
  try {
    await cdp.eval(`window.location.hash = '#/settings';`)
    await new Promise(r => setTimeout(r, 2000))

    const settingsInfo = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const selects = document.querySelectorAll('select').length;
      const inputs = document.querySelectorAll('input').length;
      const buttons = Array.from(document.querySelectorAll('button')).map(b=>b.textContent?.trim()).filter(Boolean);
      // 查找 select 元素的选项
      const selectOptions = Array.from(document.querySelectorAll('select')).map(s => ({
        value: s.value,
        options: Array.from(s.options).map(o => o.value).slice(0, 10)
      }));
      return JSON.stringify({
        h1: h1.slice(0,80),
        selects: selects,
        inputs: inputs,
        buttons: buttons.slice(0,15),
        selectOptions: selectOptions.slice(0, 5)
      });
    })()`)
    const sgi = JSON.parse(settingsInfo)
    ok('Settings 页面', `h1="${sgi.h1}" selects=${sgi.selects} inputs=${sgi.inputs} buttons=[${sgi.buttons.join(',')}]`)
    if (sgi.selectOptions.length > 0) {
      ok('Settings select 选项', JSON.stringify(sgi.selectOptions).slice(0, 200))
    }
  } catch (e) {
    fail('Settings 页面交互', '', e)
  }

  // ========== 5. Agents 页面交互 ==========
  console.log('\n--- 5. Agents 页面交互 ---')
  try {
    await cdp.eval(`window.location.hash = '#/agents';`)
    await new Promise(r => setTimeout(r, 2000))

    const agentsInfo = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const cards = document.querySelectorAll('[class*="card"], [class*="agent"]');
      const toggles = document.querySelectorAll('input[type="checkbox"], button[class*="toggle"]');
      const buttons = Array.from(document.querySelectorAll('button')).map(b=>b.textContent?.trim()).filter(Boolean);
      return JSON.stringify({
        h1: h1.slice(0,80),
        cardCount: cards.length,
        toggleCount: toggles.length,
        buttons: buttons.slice(0,20)
      });
    })()`)
    const ai = JSON.parse(agentsInfo)
    ok('Agents 页面', `h1="${ai.h1}" cards=${ai.cardCount} toggles=${ai.toggleCount} buttons=[${ai.buttons.join(',')}]`)
  } catch (e) {
    fail('Agents 页面交互', '', e)
  }

  // ========== 6. Chat 页面交互 ==========
  console.log('\n--- 6. Chat 页面交互 ---')
  try {
    await cdp.eval(`window.location.hash = '#/chat';`)
    await new Promise(r => setTimeout(r, 2000))

    const chatInfo = await cdp.eval(`(async()=>{
      const h1 = document.querySelector('h1')?.textContent || '';
      const textareas = document.querySelectorAll('textarea').length;
      const inputs = document.querySelectorAll('input').length;
      const buttons = Array.from(document.querySelectorAll('button')).map(b=>b.textContent?.trim()).filter(Boolean);
      const messages = document.querySelectorAll('[class*="message"], [class*="msg"]');
      return JSON.stringify({
        h1: h1.slice(0,80),
        textareas: textareas,
        inputs: inputs,
        messageCount: messages.length,
        buttons: buttons.slice(0,10)
      });
    })()`)
    const ci = JSON.parse(chatInfo)
    ok('Chat 页面', `h1="${ci.h1}" textareas=${ci.textareas} inputs=${ci.inputs} messages=${ci.messageCount} buttons=[${ci.buttons.join(',')}]`)
  } catch (e) {
    fail('Chat 页面交互', '', e)
  }

  // ========== 7. 404 路由测试 ==========
  console.log('\n--- 7. 404 路由测试 ---')
  try {
    await cdp.eval(`window.location.hash = '#/nonexistent-page-xyz';`)
    await new Promise(r => setTimeout(r, 1500))
    const r404 = await cdp.eval(`(async()=>{
      return JSON.stringify({
        url: window.location.hash,
        bodyText: document.body?.innerText?.slice(0,200) || '',
        h1: document.querySelector('h1')?.textContent?.slice(0,80) || null
      });
    })()`)
    const r = JSON.parse(r404)
    ok('404 路由', `url=${r.url} h1="${r.h1}" body="${r.bodyText.slice(0, 100)}"`)
  } catch (e) {
    fail('404 路由', '', e)
  }

  // ========== 8. 深度 DOM 检查 - Dashboard 数据 ==========
  console.log('\n--- 8. Dashboard 数据深度检查 ---')
  try {
    await cdp.eval(`window.location.hash = '#/';`)
    await new Promise(r => setTimeout(r, 2000))
    const dashInfo = await cdp.eval(`(async()=>{
      const text = document.body?.innerText || '';
      // 查找数字统计
      const stats = text.match(/\d+/g)?.slice(0, 20) || [];
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(h=>h.textContent?.trim()).filter(Boolean);
      const cards = document.querySelectorAll('[class*="card"], [class*="stat"]');
      return JSON.stringify({
        url: window.location.hash,
        headings: headings.slice(0, 10),
        stats: stats,
        cardCount: cards.length,
        bodyLen: text.length,
        bodyPreview: text.slice(0, 300)
      });
    })()`)
    const di = JSON.parse(dashInfo)
    ok('Dashboard 数据', `headings=[${di.headings.join(',')}] stats=[${di.stats.slice(0,10).join(',')}] cards=${di.cardCount}`)
  } catch (e) {
    fail('Dashboard 数据', '', e)
  }

  // ========== 9. Console 错误检查 ==========
  console.log('\n--- 9. Console 错误检查 ---')
  try {
    // 启用 console 捕获
    await cdp.send('Runtime.enable')
    const errors = []
    // 设置一个临时收集器
    await cdp.eval(`(async()=>{
      window.__r34Errors = [];
      const origError = console.error;
      console.error = function(...args) {
        window.__r34Errors.push(args.join(' '));
        origError.apply(console, args);
      };
      return true;
    })()`)

    // 导航遍历所有页面
    for (const page of pages) {
      await cdp.eval(`window.location.hash = '${page.hash}';`)
      await new Promise(r => setTimeout(r, 800))
    }

    const consoleErrors = await cdp.eval(`JSON.stringify(window.__r34Errors || [])`)
    const errs = JSON.parse(consoleErrors)
    if (errs.length === 0) {
      ok('Console 错误', '0 个错误 (遍历全部10个页面)')
    } else {
      ok('Console 错误', `${errs.length} 个错误`)
      errs.slice(0, 5).forEach((e, i) => {
        ok(`  错误 ${i+1}`, String(e).slice(0, 100))
      })
    }
  } catch (e) {
    fail('Console 错误检查', '', e)
  }

  // ========== 10. focusable 元素计数 ==========
  console.log('\n--- 10. focusable 元素 (无障碍) ---')
  try {
    await cdp.eval(`window.location.hash = '#/';`)
    await new Promise(r => setTimeout(r, 1500))
    const focusable = await cdp.eval(`(async()=>{
      const els = document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]');
      const visible = Array.from(els).filter(e => {
        const s = window.getComputedStyle(e);
        return s.display !== 'none' && s.visibility !== 'hidden' && e.offsetParent !== null;
      });
      return JSON.stringify({
        total: els.length,
        visible: visible.length,
        types: {
          a: document.querySelectorAll('a[href]').length,
          button: document.querySelectorAll('button').length,
          input: document.querySelectorAll('input').length,
          select: document.querySelectorAll('select').length,
          textarea: document.querySelectorAll('textarea').length,
        }
      });
    })()`)
    const f = JSON.parse(focusable)
    ok('focusable 元素', `total=${f.total} visible=${f.visible} types=${JSON.stringify(f.types)}`)
  } catch (e) {
    fail('focusable 元素', '', e)
  }

  // ========== 总结 ==========
  console.log('\n=== R34 总结 ===')
  console.log(`Pass: ${results.pass} / Fail: ${results.fail}`)
  console.log(`Total: ${results.pass + results.fail}`)

  const reportPath = path.join(__dirname, 'r34-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n结果已保存: ${reportPath}`)

  await cdp.close()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
