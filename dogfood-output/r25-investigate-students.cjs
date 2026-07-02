// R25: 调查 students 页面 0 学生 + UI 数据加载行为 + 真实用户交互
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

  console.log('=== R25 调查 students 0 学生 + UI 数据加载 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 100)}`) }

  async function navigate(route) { await cdp.eval(`window.location.hash = '${route}'`); await new Promise((r) => setTimeout(r, 1000)) }

  // ========== 1. 调查 eaa.listStudents 原始返回结构 ==========
  console.log('--- 1. eaa.listStudents 原始返回结构 ---')
  const raw = await cdp.eval(`(async()=>{const r=await window.api.eaa.listStudents();return JSON.stringify({type:typeof r,keys:r?Object.keys(r):null,success:r?.success,dataType:r?.data?typeof r.data:null,dataKeys:r?.data?Object.keys(r.data):null,dataStudentsLen:r?.data?.students?r.data.students.length:null,dataIsArray:Array.isArray(r?.data),dataLen:Array.isArray(r?.data)?r.data.length:null,stderr:r?.stderr,exitCode:r?.exitCode})})()`)
  ok('listStudents 原始结构', raw)

  // ========== 2. eaa.info 原始返回结构 ==========
  console.log('\n--- 2. eaa.info 原始返回结构 ---')
  const rawInfo = await cdp.eval(`(async()=>{const r=await window.api.eaa.info();return JSON.stringify({success:r?.success,dataKeys:r?.data?Object.keys(r.data):null,students:r?.data?.students,events:r?.data?.events,version:r?.data?.version})})()`)
  ok('info 原始结构', rawInfo)

  // ========== 3. 导航到 students 页面, 检查 React state ==========
  console.log('\n--- 3. students 页面 React state 检查 ---')
  await navigate('#/students')
  // 检查页面实际渲染的学生行数
  const studentsDom = await cdp.eval(`(function(){
    const rows = document.querySelectorAll('tr, [class*="row"], [class*="student"], [data-student]');
    const list = document.querySelector('[class*="list"], [class*="students"], ul, tbody');
    const h1 = document.querySelector('h1')?.textContent;
    const body = document.body.innerText.slice(0, 500);
    return JSON.stringify({rows: rows.length, h1: h1, hasList: !!list, bodyPreview: body});
  })()`)
  ok('students 页面 DOM', studentsDom.slice(0, 300))

  // ========== 4. 检查 students 页面是否显示空状态/错误 ==========
  console.log('\n--- 4. students 页面空状态检查 ---')
  const emptyState = await cdp.eval(`(function(){
    const text = document.body.innerText;
    const hasEmpty = text.includes('暂无') || text.includes('无学生') || text.includes('空') || text.includes('empty') || text.includes('没有') || text.includes('0 学生') || text.includes('(0)');
    const errorMsg = document.querySelector('[class*="error"], [class*="Error"]');
    const loadingMsg = document.querySelector('[class*="loading"], [class*="Loading"], [class*="spinner"]');
    return JSON.stringify({hasEmpty, hasError: !!errorMsg, errorText: errorMsg?.textContent?.slice(0,100), hasLoading: !!loadingMsg});
  })()`)
  ok('students 空状态', emptyState)

  // ========== 5. 等待 2 秒后再次检查(可能加载中) ==========
  console.log('\n--- 5. 等待 2 秒后重新检查 ---')
  await new Promise((r) => setTimeout(r, 2000))
  const afterWait = await cdp.eval(`(function(){
    const h1 = document.querySelector('h1')?.textContent;
    const studentRows = document.querySelectorAll('tr').length;
    const allText = document.body.innerText;
    return JSON.stringify({h1: h1, trCount: studentRows, textPreview: allText.slice(0, 300)});
  })()`)
  ok('等待后状态', afterWait.slice(0, 300))

  // ========== 6. 触发刷新按钮(如果有) ==========
  console.log('\n--- 6. 触发刷新 ---')
  const refreshResult = await cdp.eval(`(async function(){
    // 找刷新按钮
    const btns = Array.from(document.querySelectorAll('button'));
    const refreshBtn = btns.find(b => b.textContent.includes('刷新') || b.textContent.includes('refresh') || b.textContent.includes('Reload') || b.querySelector('svg[class*="refresh"]'));
    if (refreshBtn) {
      refreshBtn.click();
      await new Promise(r => setTimeout(r, 1500));
      const h1 = document.querySelector('h1')?.textContent;
      return JSON.stringify({clicked: true, btnText: refreshBtn.textContent.slice(0,30), h1After: h1});
    }
    return JSON.stringify({clicked: false, btnTexts: btns.map(b=>b.textContent.slice(0,20))});
  })()`)
  ok('刷新按钮', refreshResult.slice(0, 400))

  // ========== 7. 检查 console 错误 ==========
  console.log('\n--- 7. 检查 console 错误 ---')
  // 启用 console 捕获
  await cdp.send('Runtime.enable')
  const consoleErrors = []
  const consoleHandler = (params) => {
    if (params.type === 'error') consoleErrors.push(params.args?.[0]?.value || params.text)
  }
  cdp.ws.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString())
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(m.params.args?.[0]?.value || 'unknown error')
      }
    } catch (e) {}
  })
  await navigate('#/dashboard')
  await navigate('#/students')
  await new Promise((r) => setTimeout(r, 2000))
  ok('console 错误', `${consoleErrors.length} 个错误: ${consoleErrors.slice(0, 3).join(' | ').slice(0, 150)}`)

  // ========== 8. 检查 class.list 数据 ==========
  console.log('\n--- 8. class.list 数据 ---')
  const classRaw = await cdp.eval(`(async()=>{const r=await window.api.class.list();return JSON.stringify({success:r?.success,dataLen:Array.isArray(r?.data)?r.data.length:null,data:r?.data})})()`)
  ok('class.list 原始', classRaw.slice(0, 400))

  // ========== 9. 检查 eaa.ranking 数据(看是否有学生) ==========
  console.log('\n--- 9. eaa.ranking 数据 ---')
  const rankRaw = await cdp.eval(`(async()=>{const r=await window.api.eaa.ranking(10);return JSON.stringify({success:r?.success,dataType:typeof r?.data,dataIsArray:Array.isArray(r?.data),dataLen:Array.isArray(r?.data)?r.data.length:null,firstItem:r?.data&&r.data[0]?JSON.stringify(r.data[0]).slice(0,200):null})})()`)
  ok('ranking 原始', rankRaw.slice(0, 400))

  // ========== 10. 检查 eaa.score 某学生 ==========
  console.log('\n--- 10. eaa.score 第一个学生 ---')
  const scoreRaw = await cdp.eval(`(async()=>{const r=await window.api.eaa.listStudents();const first=r?.data?.students?.[0]||r?.data?.[0];if(!first)return JSON.stringify({error:'no student'});const name=typeof first==='string'?first:(first?.name||first?.entity_id||first?.id);const s=await window.api.eaa.score(name);return JSON.stringify({name:name,success:s?.success,scoreData:s?.data})})()`)
  ok('score 第一个学生', scoreRaw.slice(0, 300))

  // ========== 11. 实际点击 students 页面的按钮 ==========
  console.log('\n--- 11. students 页面按钮交互 ---')
  await navigate('#/students')
  const btnInteract = await cdp.eval(`(async function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const results = [];
    for (const b of btns.slice(0, 5)) {
      const text = b.textContent.trim().slice(0, 30);
      const before = document.body.innerText.length;
      try {
        b.click();
        await new Promise(r => setTimeout(r, 500));
        const after = document.body.innerText.length;
        results.push({text: text, clicked: true, domChanged: after !== before});
      } catch (e) {
        results.push({text: text, clicked: false, error: e.message.slice(0, 50)});
      }
    }
    return JSON.stringify(results);
  })()`)
  ok('按钮交互', btnInteract.slice(0, 500))

  // ========== 12. 汇总 ==========
  console.log('\n=== R25 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r25-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
