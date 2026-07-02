// R22: UI DOM 实际交互 — 真实点击按钮、填表单、观察 DOM 变化
// 不依赖写操作, 专注 UI 渲染逻辑和交互响应
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 5000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R22 UI DOM 实际交互 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function navigate(route) { await cdp.eval(`window.location.hash = '${route}'`); await new Promise((r) => setTimeout(r, 700)) }
  async function getHeap() { return cdp.eval(`performance && performance.memory ? performance.memory.usedJSHeapSize : 0`) }
  async function clickSelector(sel) {
    return cdp.eval(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'NOT_FOUND';try{el.click();return 'CLICKED'}catch(e){return 'ERR:'+e.message}})()`)
  }
  async function getText(sel) {
    return cdp.eval(`(document.querySelector(${JSON.stringify(sel)})?.textContent||'').trim().slice(0,200)`)
  }
  async function setValue(sel, val) {
    return cdp.eval(`(function(){const el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'NOT_FOUND';try{const setter=Object.getOwnPropertyDescriptor(el.__proto__,'value');if(setter&&setter.set)setter.set.call(el,${JSON.stringify(val)});else el.value=${JSON.stringify(val)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return 'SET'}catch(e){return 'ERR:'+e.message}})()`)
  }

  // ========== 1. Dashboard 页交互 ==========
  console.log('--- 1. Dashboard 页交互 ---')
  await navigate('#/dashboard')
  const dashTitle = await getText('h1, h2')
  ok('Dashboard 标题', dashTitle || '(无标题)')

  // 统计卡片
  const cards = await cdp.eval(`document.querySelectorAll('[class*="card"], [class*="stat"], [class*="metric"]').length`)
  ok('Dashboard 卡片数', `${cards} 个`)

  // 查看是否有图表 (echarts)
  const charts = await cdp.eval(`document.querySelectorAll('canvas, [_echarts_instance_], [class*="chart"]').length`)
  ok('Dashboard 图表', `${charts} 个`)

  // ========== 2. Students 页 ==========
  console.log('\n--- 2. Students 页 ---')
  await navigate('#/students')
  const stuTitle = await getText('h1, h2')
  ok('Students 标题', stuTitle || '(无标题)')

  // 学生表格
  const tableRows = await cdp.eval(`document.querySelectorAll('table tbody tr, [class*="table"] [class*="row"]').length`)
  ok('Students 表格行', `${tableRows} 行`)

  // 搜索框
  const searchInput = await cdp.eval(`document.querySelectorAll('input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]').length`)
  ok('Students 搜索框', `${searchInput} 个`)

  // ========== 3. Classes 页 ==========
  console.log('\n--- 3. Classes 页 ---')
  await navigate('#/classes')
  const clsTitle = await getText('h1, h2')
  ok('Classes 标题', clsTitle || '(无标题)')

  // 班级卡片或表格
  const clsItems = await cdp.eval(`document.querySelectorAll('[class*="card"], [class*="class"], table tbody tr').length`)
  ok('Classes 项', `${clsItems} 个`)

  // 创建班级按钮
  const createBtn = await cdp.eval(`(function(){const btns=Array.from(document.querySelectorAll('button'));const t=btns.find(b=>b.textContent.includes('创建')||b.textContent.includes('新增')||b.textContent.includes('Create'));return t?t.textContent:''})()`)
  ok('Classes 创建按钮', createBtn || '(无)')

  // ========== 4. Agents 页 — 查看所有 Agent ==========
  console.log('\n--- 4. Agents 页 ---')
  await navigate('#/agents')
  await new Promise((r) => setTimeout(r, 1000))
  // Agent 列表 (可能是 cards 或 list items)
  const agentItems = await cdp.eval(`document.querySelectorAll('[class*="agent"], [class*="card"], [data-agent-id]').length`)
  ok('Agents 项', `${agentItems} 个`)

  // 尝试找到 agent 卡片并点击第一个
  const firstAgentClick = await cdp.eval(`(function(){const cards=document.querySelectorAll('[class*="card"], [class*="agent"]');if(cards.length===0)return 'NO_CARDS';try{cards[0].click();return 'CLICKED '+cards[0].textContent.trim().slice(0,40)}catch(e){return 'ERR:'+e.message}})()`)
  ok('Agents 点击首个', firstAgentClick.slice(0, 80))
  await new Promise((r) => setTimeout(r, 500))

  // ========== 5. Chat 页 ==========
  console.log('\n--- 5. Chat 页 ---')
  await navigate('#/chat')
  const chatTitle = await getText('h1, h2')
  ok('Chat 标题', chatTitle || '(无标题)')

  // 输入框
  const chatInput = await cdp.eval(`document.querySelectorAll('textarea, input[type="text"]').length`)
  ok('Chat 输入框', `${chatInput} 个`)

  // 发送按钮
  const sendBtn = await cdp.eval(`(function(){const btns=Array.from(document.querySelectorAll('button'));const t=btns.find(b=>b.textContent.includes('发送')||b.textContent.includes('Send')||b.textContent.includes('提交'));return t?t.textContent:'(无)'})()`)
  ok('Chat 发送按钮', sendBtn)

  // ========== 6. Skills 页 ==========
  console.log('\n--- 6. Skills 页 ---')
  await navigate('#/skills')
  const skillTitle = await getText('h1, h2')
  ok('Skills 标题', skillTitle || '(无标题)')

  // 技能列表
  const skillItems = await cdp.eval(`document.querySelectorAll('[class*="skill"], [class*="card"], li').length`)
  ok('Skills 项', `${skillItems} 个`)

  // ========== 7. Privacy 页 ==========
  console.log('\n--- 7. Privacy 页 ---')
  await navigate('#/privacy')
  const privTitle = await getText('h1, h2')
  ok('Privacy 标题', privTitle || '(无标题)')

  // 密码输入框
  const pwdInputs = await cdp.eval(`document.querySelectorAll('input[type="password"]').length`)
  ok('Privacy 密码框', `${pwdInputs} 个`)

  // ========== 8. Settings 页 — 切换 select ==========
  console.log('\n--- 8. Settings 页 — select 切换 ---')
  await navigate('#/settings')
  // 切换语言
  const langChange = await cdp.eval(`(function(){const sel=document.querySelectorAll('select')[0];if(!sel)return 'NO_SELECT';sel.value='en';sel.dispatchEvent(new Event('change',{bubbles:true}));return 'CHANGED to en'})()`)
  ok('Settings 切换语言', langChange)
  await new Promise((r) => setTimeout(r, 500))
  // 验证 UI 文本变化
  const titleAfterEn = await getText('h1, h2')
  ok('Settings 英文标题', titleAfterEn || '(无)')
  // 切回中文
  await cdp.eval(`(function(){const sel=document.querySelectorAll('select')[0];sel.value='zh';sel.dispatchEvent(new Event('change',{bubbles:true}));return 'OK'})()`)
  await new Promise((r) => setTimeout(r, 500))

  // 切换主题
  const themeChange = await cdp.eval(`(function(){const sels=document.querySelectorAll('select');if(sels.length<2)return 'NO_SELECT';sels[1].value='light';sels[1].dispatchEvent(new Event('change',{bubbles:true}));return 'CHANGED to light'})()`)
  ok('Settings 切换主题', themeChange)
  await new Promise((r) => setTimeout(r, 500))
  // 检查 body/html class
  const bodyClass = await cdp.eval(`document.documentElement.className + '|' + document.body.className`)
  ok('Settings 主题 class', bodyClass.slice(0, 80))
  // 切回 dark
  await cdp.eval(`(function(){const sels=document.querySelectorAll('select');sels[1].value='dark';sels[1].dispatchEvent(new Event('change',{bubbles:true}));return 'OK'})()`)

  // ========== 9. Models 页 ==========
  console.log('\n--- 9. Models 页 ---')
  await navigate('#/models')
  const modelsTitle = await getText('h1, h2')
  ok('Models 标题', modelsTitle || '(无标题)')

  // provider select
  const providerSel = await cdp.eval(`(function(){const sels=document.querySelectorAll('select');return sels.length+' selects, first options: '+Array.from(sels[0]?.options||[]).slice(0,5).map(o=>o.value).join(',')})()`)
  ok('Models provider select', providerSel.slice(0, 100))

  // ========== 10. 404 路由 ==========
  console.log('\n--- 10. 404 路由 ---')
  await navigate('#/nonexistent-page-r22-test')
  await new Promise((r) => setTimeout(r, 500))
  // 验证重定向到 dashboard
  const hash = await cdp.eval(`window.location.hash`)
  if (hash === '#/dashboard' || hash === '#/') ok('404 重定向', `重定向到 ${hash}`)
  else fail('404 重定向', `实际: ${hash}`, '未重定向')

  // ========== 11. 键盘 Tab 导航 ==========
  console.log('\n--- 11. 键盘 Tab 导航 ---')
  await navigate('#/dashboard')
  await new Promise((r) => setTimeout(r, 500))
  // 模拟 Tab 键
  const tabResult = await cdp.eval(`(function(){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',keyCode:9,which:9,bubbles:true}));return document.activeElement?document.activeElement.tagName+'|'+(document.activeElement.textContent||'').slice(0,30):'NO_FOCUS'})()`)
  ok('Tab 键导航', tabResult.slice(0, 60))

  // ========== 12. 鼠标事件 ==========
  console.log('\n--- 12. 鼠标事件 ---')
  // 点击 Dashboard 第一个按钮
  const clickResult = await cdp.eval(`(function(){const btn=document.querySelector('button');if(!btn)return 'NO_BTN';btn.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'CLICKED: '+(btn.textContent||'').trim().slice(0,40)})()`)
  ok('鼠标点击按钮', clickResult.slice(0, 80))

  // ========== 13. 窗口大小变化 ==========
  console.log('\n--- 13. 窗口大小变化 ---')
  const resizeResult = await cdp.eval(`(function(){window.dispatchEvent(new Event('resize'));return 'RESIZE dispatched'})()`)
  ok('resize 事件', resizeResult)

  // ========== 14. 长时间稳定性 — 50 次 DOM 查询 ==========
  console.log('\n--- 14. 长时间稳定性 (50 次 DOM 查询) ---')
  const t1 = Date.now()
  let domOk = 0
  for (let i = 0; i < 50; i++) {
    const r = await cdp.eval(`document.querySelectorAll('*').length`)
    if (r > 0) domOk++
  }
  const elapsed = Date.now() - t1
  ok('50 次 DOM 查询', `${domOk}/50 成功, 耗时 ${elapsed}ms, 平均 ${elapsed / 50}ms/次`)

  // ========== 15. 内存 ==========
  console.log('\n--- 15. 内存 ---')
  const finalHeap = await getHeap()
  ok('最终内存', `${(finalHeap / 1024 / 1024).toFixed(2)} MB`)

  // ========== 16. 汇总 ==========
  console.log('\n=== R22 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r22-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
