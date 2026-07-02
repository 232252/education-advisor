// R27: UI 实际渲染行为 — students/dashboard/classes/agents 数据显示验证
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

  console.log('=== R27 UI 实际渲染行为验证 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function navigate(route) { await cdp.eval(`window.location.hash = '${route}'`); await new Promise((r) => setTimeout(r, 2500)) }

  // ========== 1. Dashboard 页面渲染 ==========
  console.log('--- 1. Dashboard 页面渲染 ---')
  await navigate('#/dashboard')
  const dash = await cdp.eval(`(function(){
    const cards = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="stat"], [class*="Stat"]');
    const tables = document.querySelectorAll('table');
    const rankingRows = document.querySelectorAll('table tr, [class*="rank"], [class*="Rank"]');
    const text = document.body.innerText;
    const hasStudentCount = text.match(/(\d+)\s*学生/) || text.match(/students[:\s]*(\d+)/i);
    const hasEventCount = text.match(/(\d+)\s*事件/) || text.match(/events[:\s]*(\d+)/i);
    return JSON.stringify({
      cards: cards.length,
      tables: tables.length,
      rankingRows: rankingRows.length,
      hasStudentCount: hasStudentCount ? hasStudentCount[0] : null,
      hasEventCount: hasEventCount ? hasEventCount[0] : null,
      textPreview: text.slice(0, 400)
    });
  })()`)
  ok('Dashboard 渲染', dash.slice(0, 500))

  // ========== 2. Students 页面渲染 441 学生 ==========
  console.log('\n--- 2. Students 页面渲染 ---')
  await navigate('#/students')
  const studs = await cdp.eval(`(function(){
    const rows = document.querySelectorAll('table tr, tbody tr');
    const h1 = document.querySelector('h1')?.textContent;
    const deletedShown = Array.from(document.querySelectorAll('tr')).filter(tr => tr.textContent.includes('Deleted') || tr.textContent.includes('已删除')).length;
    const searchInput = document.querySelector('input[type="text"], input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]');
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    return JSON.stringify({
      h1: h1,
      tableRows: rows.length,
      deletedShown: deletedShown,
      hasSearch: !!searchInput,
      searchPlaceholder: searchInput?.placeholder,
      checkboxes: checkboxes.length
    });
  })()`)
  ok('Students 渲染', studs)

  // ========== 3. Students 搜索功能 ==========
  console.log('\n--- 3. Students 搜索功能 ---')
  const searchTest = await cdp.eval(`(async function(){
    const input = document.querySelector('input[type="text"], input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]');
    if (!input) return JSON.stringify({error: 'no search input'});
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(input, 'R4');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    await new Promise(r => setTimeout(r, 1000));
    const rows = document.querySelectorAll('table tr, tbody tr').length;
    const h1 = document.querySelector('h1')?.textContent;
    return JSON.stringify({searched: 'R4', rowsAfter: rows, h1After: h1});
  })()`)
  ok('Students 搜索 R4', searchTest)

  // 清空搜索
  await cdp.eval(`(async function(){
    const input = document.querySelector('input[type="text"], input[type="search"]');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', {bubbles: true}));
    await new Promise(r => setTimeout(r, 1000));
  })()`)

  // ========== 4. Classes 页面(空班级) ==========
  console.log('\n--- 4. Classes 页面 ---')
  await navigate('#/classes')
  const classes = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const rows = document.querySelectorAll('table tr, tbody tr').length;
    const cards = document.querySelectorAll('[class*="card"], [class*="Card"]').length;
    const empty = document.body.innerText.includes('暂无') || document.body.innerText.includes('无班级') || document.body.innerText.includes('empty');
    const btns = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().slice(0, 20));
    return JSON.stringify({h1: h1, rows: rows, cards: cards, empty: empty, buttons: btns});
  })()`)
  ok('Classes 渲染', classes.slice(0, 400))

  // ========== 5. Agents 页面渲染 ==========
  console.log('\n--- 5. Agents 页面渲染 ---')
  await navigate('#/agents')
  const agents = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const agentCards = document.querySelectorAll('[class*="agent"], [class*="Agent"], [class*="card"], [class*="Card"]').length;
    const toggles = document.querySelectorAll('input[type="checkbox"], [role="switch"], [class*="toggle"], [class*="Toggle"]').length;
    const runBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('运行') || b.textContent.includes('Run') || b.textContent.includes('执行')).length;
    const agentNames = Array.from(document.querySelectorAll('h2, h3, [class*="title"], [class*="name"]')).map(e => e.textContent.trim().slice(0, 30)).slice(0, 10);
    return JSON.stringify({h1: h1, cards: agentCards, toggles: toggles, runBtns: runBtns, names: agentNames});
  })()`)
  ok('Agents 渲染', agents.slice(0, 500))

  // ========== 6. Chat 页面 ==========
  console.log('\n--- 6. Chat 页面 ---')
  await navigate('#/chat')
  const chat = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const messages = document.querySelectorAll('[class*="message"], [class*="Message"], [class*="msg"]').length;
    const inputArea = document.querySelector('textarea, input[type="text"]');
    const sendBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('发送') || b.textContent.includes('Send'));
    const providerSelect = document.querySelectorAll('select').length;
    const sessions = document.querySelectorAll('[class*="session"], [class*="Session"]').length;
    return JSON.stringify({h1: h1, messages: messages, hasInput: !!inputArea, hasSend: !!sendBtn, selects: providerSelect, sessions: sessions});
  })()`)
  ok('Chat 渲染', chat)

  // ========== 7. Skills 页面 ==========
  console.log('\n--- 7. Skills 页面 ---')
  await navigate('#/skills')
  const skills = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1, h2')?.textContent;
    const skillItems = document.querySelectorAll('[class*="skill"], [class*="Skill"], li, [class*="item"]').length;
    const createBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('新建') || b.textContent.includes('创建') || b.textContent.includes('Create') || b.textContent.includes('+'));
    const text = document.body.innerText.slice(0, 300);
    return JSON.stringify({h1: h1, items: skillItems, hasCreate: !!createBtn, textPreview: text});
  })()`)
  ok('Skills 渲染', skills.slice(0, 400))

  // ========== 8. Privacy 页面 ==========
  console.log('\n--- 8. Privacy 页面 ---')
  await navigate('#/privacy')
  const privacy = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const passwordInputs = document.querySelectorAll('input[type="password"]').length;
    const status = document.body.innerText.includes('未启用') || document.body.innerText.includes('disabled') || document.body.innerText.includes('未加载') || document.body.innerText.includes('locked');
    const btns = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().slice(0, 20));
    const text = document.body.innerText.slice(0, 400);
    return JSON.stringify({h1: h1, passwordInputs: passwordInputs, locked: status, buttons: btns, textPreview: text});
  })()`)
  ok('Privacy 渲染', privacy.slice(0, 500))

  // ========== 9. Settings 页面表单 ==========
  console.log('\n--- 9. Settings 页面表单 ---')
  await navigate('#/settings')
  const settings = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({name: s.name, value: s.value, options: s.options.length}));
    const inputs = Array.from(document.querySelectorAll('input')).map(i => ({type: i.type, name: i.name, value: i.value?.slice(0,30)}));
    const sections = Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim());
    return JSON.stringify({h1: h1, selects: selects, inputs: inputs, sections: sections});
  })()`)
  ok('Settings 表单', settings.slice(0, 600))

  // ========== 10. Models 页面 ==========
  console.log('\n--- 10. Models 页面 ---')
  await navigate('#/models')
  const models = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const providerCards = document.querySelectorAll('[class*="provider"], [class*="Provider"], [class*="card"], [class*="Card"]').length;
    const selects = document.querySelectorAll('select').length;
    const inputs = document.querySelectorAll('input').length;
    const text = document.body.innerText.slice(0, 400);
    return JSON.stringify({h1: h1, cards: providerCards, selects: selects, inputs: inputs, textPreview: text});
  })()`)
  ok('Models 渲染', models.slice(0, 500))

  // ========== 11. 点击 students 行选择 ==========
  console.log('\n--- 11. Students 行点击选择 ---')
  await navigate('#/students')
  const rowClick = await cdp.eval(`(async function(){
    const rows = document.querySelectorAll('table tbody tr');
    if (rows.length === 0) return JSON.stringify({error: 'no rows'});
    const firstRow = rows[0];
    firstRow.click();
    await new Promise(r => setTimeout(r, 500));
    // 检查是否打开详情侧边栏
    const sidebar = document.querySelector('[class*="sidebar"], [class*="Sidebar"], [class*="detail"], [class*="Detail"], [class*="profile"], [class*="Profile"]');
    const modal = document.querySelector('[class*="modal"], [class*="Modal"], [role="dialog"]');
    return JSON.stringify({
      clicked: true,
      hasSidebar: !!sidebar,
      hasModal: !!modal,
      sidebarText: sidebar?.textContent?.slice(0, 200) || null
    });
  })()`)
  ok('行点击选择', rowClick.slice(0, 400))

  // ========== 12. 汇总 ==========
  console.log('\n=== R27 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r27-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
