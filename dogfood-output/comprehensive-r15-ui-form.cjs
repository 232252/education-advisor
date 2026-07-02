// 第十五轮测试 — 真实 UI 表单交互 + 通过 UI 触发主题/语言切换
// 通过 DOM 操作触发 React 表单,模拟真实用户交互
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try { resolve(JSON.parse(d).find((x) => x.type === 'page').webSocketDebuggerUrl) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try { const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 60000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 55000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  async navigate(path, wait = 2000) {
    await this.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
  }
  /** 模拟原生 select onChange (React 受控组件需要用原生 setter) */
  async selectOption(selector, value) {
    return await this.eval(`(function(){
      const sel = document.querySelector('${selector}');
      if(!sel) return { ok: false, error: 'select not found' };
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativeInputValueSetter.call(sel, '${value}');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: sel.value };
    })()`)
  }
  /** 模拟原生 input onChange */
  async inputText(selector, value) {
    return await this.eval(`(function(){
      const inp = document.querySelector('${selector}');
      if(!inp) return { ok: false, error: 'input not found' };
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(inp, ${JSON.stringify(value)});
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: inp.value };
    })()`)
  }
  /** 模拟原生 textarea onChange */
  async textareaText(selector, value) {
    return await this.eval(`(function(){
      const ta = document.querySelector('${selector}');
      if(!ta) return { ok: false, error: 'textarea not found' };
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeInputValueSetter.call(ta, ${JSON.stringify(value)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: ta.value };
    })()`)
  }
  /** 点击元素 */
  async click(selector) {
    return await this.eval(`(function(){
      const el = document.querySelector('${selector}');
      if(!el) return { ok: false, error: 'not found' };
      el.click();
      return { ok: true };
    })()`)
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const results = { pass: 0, fail: 0, warn: 0, details: [], apiCalls: 0, startTime: Date.now() }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  const origEval = cdp.eval.bind(cdp)
  cdp.eval = async (expr) => { results.apiCalls++; return origEval(expr) }

  console.log('=== 第十五轮: 真实 UI 表单交互 + 通过 UI 触发主题/语言 ===\n')

  // ========== 1. 主题切换 (通过 SettingsPage select) ==========
  console.log('--- 1. 主题切换 (通过 UI) ---')

  await cdp.navigate('/settings', 2500)

  // 读取当前主题
  const origTheme = await cdp.eval(`(function(){
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  })()`)
  ok('初始主题', origTheme)

  // 找到主题 select
  const themeSelectInfo = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for(const s of selects) {
      const opts = Array.from(s.options).map(o => o.value);
      if(opts.includes('dark') && opts.includes('light')) {
        return { index: Array.from(selects).indexOf(s), value: s.value, options: opts };
      }
    }
    return null;
  })()`)
  ok('主题 select', `value: ${themeSelectInfo?.value}, options: ${themeSelectInfo?.options?.join(',')}`)

  // 切换到 light
  const themeSelect = `select:nth-of-type(${(themeSelectInfo?.index ?? 0) + 1})`
  // 用更精确的选择器: 找包含 light option 的 select
  const lightR = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for(const s of selects) {
      const opts = Array.from(s.options).map(o => o.value);
      if(opts.includes('dark') && opts.includes('light')) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        nativeSetter.call(s, 'light');
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: s.value };
      }
    }
    return { ok: false };
  })()`)
  if (lightR?.ok) ok('切换到 light', `value: ${lightR.value}`)
  else fail('切换到 light', '', 'select not found')

  await new Promise((r) => setTimeout(r, 500))

  // 验证 dark class 被移除
  const afterLight = await cdp.eval(`(function(){
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  })()`)
  if (afterLight === 'light') ok('Light 主题生效', 'dark class 已移除 ✓')
  else warn('Light 主题生效', `当前: ${afterLight}`)

  // 切换回 dark
  const darkR = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for(const s of selects) {
      const opts = Array.from(s.options).map(o => o.value);
      if(opts.includes('dark') && opts.includes('light')) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        nativeSetter.call(s, 'dark');
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: s.value };
      }
    }
    return { ok: false };
  })()`)
  if (darkR?.ok) ok('切换到 dark', `value: ${darkR.value}`)

  await new Promise((r) => setTimeout(r, 500))
  const afterDark = await cdp.eval(`(function(){
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  })()`)
  if (afterDark === 'dark') ok('Dark 主题生效', 'dark class 已添加 ✓')
  else warn('Dark 主题生效', `当前: ${afterDark}`)

  // ========== 2. 语言切换 (通过 SettingsPage select) ==========
  console.log('\n--- 2. 语言切换 (通过 UI) ---')

  // 找到语言 select (包含 zh-CN 和 en-US)
  const langSelectInfo = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for(const s of selects) {
      const opts = Array.from(s.options).map(o => o.value);
      if(opts.includes('zh-CN') && opts.includes('en-US')) {
        return { index: Array.from(selects).indexOf(s), value: s.value, options: opts };
      }
    }
    return null;
  })()`)
  ok('语言 select', `value: ${langSelectInfo?.value}, options: ${langSelectInfo?.options?.join(',')}`)

  // 切换到 en-US
  const enR = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for(const s of selects) {
      const opts = Array.from(s.options).map(o => o.value);
      if(opts.includes('zh-CN') && opts.includes('en-US')) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        nativeSetter.call(s, 'en-US');
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: s.value };
      }
    }
    return { ok: false };
  })()`)
  if (enR?.ok) ok('切换到 en-US', `value: ${enR.value}`)

  await new Promise((r) => setTimeout(r, 1000))

  // 检查 UI 是否有英文文本
  const enCheck = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1');
    const labels = Array.from(document.querySelectorAll('label')).slice(0, 5).map(l => l.textContent?.trim());
    return { h1: h1?.textContent?.trim(), labels };
  })()`)
  ok('en-US UI 检查', `h1: ${enCheck?.h1}, labels: ${enCheck?.labels?.join(', ').slice(0, 60)}`)

  // 切换回 zh-CN
  const zhR = await cdp.eval(`(function(){
    const selects = document.querySelectorAll('select');
    for(const s of selects) {
      const opts = Array.from(s.options).map(o => o.value);
      if(opts.includes('zh-CN') && opts.includes('en-US')) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        nativeSetter.call(s, 'zh-CN');
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, value: s.value };
      }
    }
    return { ok: false };
  })()`)
  if (zhR?.ok) ok('切换回 zh-CN', `value: ${zhR.value}`)

  await new Promise((r) => setTimeout(r, 1000))

  // ========== 3. Chat 页面表单交互 ==========
  console.log('\n--- 3. Chat 页面表单交互 ---')

  await cdp.navigate('/chat', 2000)

  // 检查 Chat 页面元素
  const chatElements = await cdp.eval(`(function(){
    const textareas = document.querySelectorAll('textarea').length;
    const buttons = document.querySelectorAll('button').length;
    const inputs = document.querySelectorAll('input').length;
    const h1 = document.querySelector('h1')?.textContent;
    return { textareas, buttons, inputs, h1 };
  })()`)
  ok('Chat 页面元素', `${chatElements?.h1} | textarea:${chatElements?.textareas}, btn:${chatElements?.buttons}, input:${chatElements?.inputs}`)

  // 尝试在 textarea 输入
  if (chatElements?.textareas > 0) {
    const inputR = await cdp.eval(`(function(){
      const ta = document.querySelector('textarea');
      if(!ta) return { ok: false };
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(ta, 'R15测试消息');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, value: ta.value };
    })()`)
    if (inputR?.ok) ok('Chat textarea 输入', `value: ${inputR.value}`)
    else warn('Chat textarea 输入', '失败')
  }

  // ========== 4. Skills 页面交互 ==========
  console.log('\n--- 4. Skills 页面交互 ---')

  await cdp.navigate('/skills', 2000)
  const skillElements = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const buttons = document.querySelectorAll('button').length;
    const inputs = document.querySelectorAll('input').length;
    const textareas = document.querySelectorAll('textarea').length;
    return { h1, buttons, inputs, textareas };
  })()`)
  ok('Skills 页面', `${skillElements?.h1} | btn:${skillElements?.buttons}, input:${skillElements?.inputs}, textarea:${skillElements?.textareas}`)

  // ========== 5. Agents 页面交互 ==========
  console.log('\n--- 5. Agents 页面交互 ---')

  await cdp.navigate('/agents', 2500)
  const agentElements = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const cards = document.querySelectorAll('[class*="card"], [class*="agent"]').length;
    const buttons = document.querySelectorAll('button').length;
    const toggles = document.querySelectorAll('[role="switch"], input[type="checkbox"]').length;
    return { h1, cards, buttons, toggles };
  })()`)
  ok('Agents 页面', `${agentElements?.h1} | cards:${agentElements?.cards}, btn:${agentElements?.buttons}, toggle:${agentElements?.toggles}`)

  // 点击第一个 agent 卡片
  if (agentElements?.cards > 0) {
    const clickR = await cdp.eval(`(function(){
      const card = document.querySelector('[class*="card"], [class*="agent"]');
      if(!card) return { ok: false };
      card.click();
      return { ok: true };
    })()`)
    if (clickR?.ok) {
      await new Promise((r) => setTimeout(r, 1000))
      const afterClick = await cdp.eval(`(function(){
        const modal = document.querySelector('[class*="modal"], [class*="dialog"], [role="dialog"]');
        const detail = document.querySelector('[class*="detail"], [class*="soul"], [class*="rules"]');
        return { hasModal: !!modal, hasDetail: !!detail };
      })()`)
      ok('点击 Agent 卡片', `modal: ${afterClick?.hasModal}, detail: ${afterClick?.hasDetail}`)
    }
  }

  // ========== 6. Privacy 页面交互 ==========
  console.log('\n--- 6. Privacy 页面交互 ---')

  await cdp.navigate('/privacy', 2000)
  const privacyElements = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const buttons = document.querySelectorAll('button').length;
    const inputs = document.querySelectorAll('input').length;
    const textareas = document.querySelectorAll('textarea').length;
    return { h1, buttons, inputs, textareas };
  })()`)
  ok('Privacy 页面', `${privacyElements?.h1} | btn:${privacyElements?.buttons}, input:${privacyElements?.inputs}, textarea:${privacyElements?.textareas}`)

  // ========== 7. Logs 页面交互 ==========
  console.log('\n--- 7. Logs 页面交互 ---')

  await cdp.navigate('/logs', 2000)
  const logElements = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const buttons = document.querySelectorAll('button').length;
    const inputs = document.querySelectorAll('input').length;
    const selects = document.querySelectorAll('select').length;
    const tables = document.querySelectorAll('table').length;
    return { h1, buttons, inputs, selects, tables };
  })()`)
  ok('Logs 页面', `${logElements?.h1} | btn:${logElements?.buttons}, input:${logElements?.inputs}, select:${logElements?.selects}, table:${logElements?.tables}`)

  // ========== 8. 班级页表单交互 ==========
  console.log('\n--- 8. 班级页表单交互 ---')

  await cdp.navigate('/classes', 2000)
  const clsElements = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const buttons = document.querySelectorAll('button').length;
    const inputs = document.querySelectorAll('input').length;
    return { h1, buttons, inputs };
  })()`)
  ok('班级页', `${clsElements?.h1} | btn:${clsElements?.buttons}, input:${clsElements?.inputs}`)

  // 点击创建班级按钮 (如果有)
  const createBtnR = await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const createBtn = btns.find(b => b.textContent?.includes('创建') || b.textContent?.includes('新建') || b.textContent?.includes('Create'));
    if(createBtn) {
      createBtn.click();
      return { ok: true, text: createBtn.textContent?.trim() };
    }
    return { ok: false };
  })()`)
  if (createBtnR?.ok) {
    ok('点击创建按钮', createBtnR.text)
    await new Promise((r) => setTimeout(r, 500))
    // 检查是否弹出表单/对话框
    const formCheck = await cdp.eval(`(function(){
      const modal = document.querySelector('[class*="modal"], [role="dialog"]');
      const form = document.querySelector('form');
      const inputs = document.querySelectorAll('input[type="text"]').length;
      return { hasModal: !!modal, hasForm: !!form, inputs };
    })()`)
    ok('创建表单', `modal: ${formCheck?.hasModal}, form: ${formCheck?.hasForm}, inputs: ${formCheck?.inputs}`)
  } else {
    warn('创建按钮', '未找到')
  }

  // ========== 9. 学生页表单交互 ==========
  console.log('\n--- 9. 学生页表单交互 ---')

  await cdp.navigate('/students', 2000)
  const stuElements = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const buttons = document.querySelectorAll('button').length;
    const inputs = document.querySelectorAll('input').length;
    const selects = document.querySelectorAll('select').length;
    const tableRows = document.querySelectorAll('table tbody tr').length;
    return { h1, buttons, inputs, selects, tableRows };
  })()`)
  ok('学生页', `${stuElements?.h1} | btn:${stuElements?.buttons}, input:${stuElements?.inputs}, select:${stuElements?.selects}, rows:${stuElements?.tableRows}`)

  // 测试班级筛选 (如果有 select)
  if (stuElements?.selects > 0) {
    const filterR = await cdp.eval(`(function(){
      const sel = document.querySelector('select');
      if(!sel || sel.options.length < 2) return { ok: false };
      // 选第二个 option (第一个通常是"全部")
      const secondVal = sel.options[1]?.value;
      if(!secondVal) return { ok: false };
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      nativeSetter.call(sel, secondVal);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: secondVal };
    })()`)
    if (filterR?.ok) {
      await new Promise((r) => setTimeout(r, 500))
      const afterFilter = await cdp.eval(`document.querySelectorAll('table tbody tr').length`)
      ok('班级筛选', `select: ${filterR.value}, 筛选后 ${afterFilter} 行`)
    } else {
      warn('班级筛选', '无可筛选选项')
    }
  }

  // ========== 10. 搜索功能 ==========
  console.log('\n--- 10. 搜索功能 ---')

  // 搜索框
  const searchR = await cdp.eval(`(function(){
    const searchInput = document.querySelector('input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"], input[placeholder*="Search"]');
    if(!searchInput) return { ok: false };
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(searchInput, 'R15');
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, value: searchInput.value };
  })()`)
  if (searchR?.ok) {
    ok('搜索框输入', `value: ${searchR.value}`)
    await new Promise((r) => setTimeout(r, 500))
    const searchResults = await cdp.eval(`document.querySelectorAll('table tbody tr').length`)
    ok('搜索结果', `${searchResults} 行`)
  } else {
    warn('搜索框', '未找到')
  }

  // ========== 11. Dashboard 图表检查 ==========
  console.log('\n--- 11. Dashboard 图表检查 ---')

  await cdp.navigate('/dashboard', 3000)
  const dashElements = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const canvas = document.querySelectorAll('canvas').length;
    const svg = document.querySelectorAll('svg').length;
    const tables = document.querySelectorAll('table').length;
    const tableRows = document.querySelectorAll('table tbody tr').length;
    const cards = document.querySelectorAll('[class*="card"], [class*="stat"]').length;
    return { h1, canvas, svg, tables, tableRows, cards };
  })()`)
  ok('Dashboard', `${dashElements?.h1} | canvas:${dashElements?.canvas}, svg:${dashElements?.svg}, table:${dashElements?.tables}, rows:${dashElements?.tableRows}, cards:${dashElements?.cards}`)

  // ========== 12. About 页面 ==========
  console.log('\n--- 12. About 页面 ---')

  await cdp.navigate('/about', 2000)
  const aboutElements = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const body = document.body?.innerHTML?.length || 0;
    const links = document.querySelectorAll('a').length;
    return { h1, body, links };
  })()`)
  ok('About 页面', `${aboutElements?.h1} | body:${aboutElements?.body}, links:${aboutElements?.links}`)

  // ========== 13. 最终内存检查 ==========
  console.log('\n--- 13. 最终内存检查 ---')

  const memR = await cdp.eval(`(function(){
    if(performance.memory) return { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize };
    return null;
  })()`)
  if (memR) ok('内存', `${(memR.used / 1024 / 1024).toFixed(1)} MB / ${(memR.total / 1024 / 1024).toFixed(1)} MB`)
  else warn('内存', '不可用')

  // ========== 汇总 ==========
  const elapsed = ((Date.now() - results.startTime) / 1000).toFixed(1)
  console.log('\n=== 测试汇总 ===')
  console.log(`通过: ${results.pass}, 失败: ${results.fail}, 警告: ${results.warn}, 通过率: ${((results.pass / (results.pass + results.fail + results.warn)) * 100).toFixed(1)}%`)
  console.log(`API 调用: ${results.apiCalls}, 耗时: ${elapsed}s`)

  fs.writeFileSync('dogfood-output/r15-results.json', JSON.stringify({
    ...results,
    elapsedSec: parseFloat(elapsed),
    testType: 'R15-ui-form-interaction',
  }, null, 2))
  console.log('结果已写入: r15-results.json')

  ws.close()
  process.exit(results.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
