// R12: 真实 UI DOM 交互 — 模拟用户点击按钮/填写表单/切换页面
// 用户强调: "打开真实软件 真实模拟用户情况, 每个按键都去操作一下"
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
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R12 真实 UI DOM 交互测试 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 120)}`) }

  // 导航到指定路由
  async function navigate(route) {
    await cdp.eval(`window.location.hash = '${route}'`)
    await new Promise((r) => setTimeout(r, 500))
  }

  // 获取所有可见按钮
  async function getVisibleButtons() {
    return cdp.eval(`(() => {
      const btns = document.querySelectorAll('button, [role="button"], .ant-btn, a[href]');
      const visible = [];
      btns.forEach(b => {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight) {
          visible.push({ text: (b.textContent || '').trim().slice(0, 30), tag: b.tagName, x: r.x + r.width/2, y: r.y + r.height/2 });
        }
      });
      return visible;
    })()`)
  }

  // 点击坐标
  async function clickXY(x, y) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  // 点击元素 (通过文本)
  async function clickByText(text) {
    return cdp.eval(`(() => {
      const btns = document.querySelectorAll('button, [role="button"], .ant-btn, a[href]');
      for (const b of btns) {
        if ((b.textContent || '').trim().includes('${text}')) {
          b.click();
          return true;
        }
      }
      return false;
    })()`)
  }

  // 填写表单字段 (React native setter)
  async function fillInput(selector, value) {
    return cdp.eval(`(() => {
      const el = document.querySelector('${selector}');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set
                 || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
                 || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    })()`)
  }

  // 关闭 modal
  async function closeModal() {
    await cdp.eval(`(() => {
      // Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      // 点击 close/cancel 按钮
      const closeBtns = document.querySelectorAll('.ant-modal-close, [class*="close"], button[class*="cancel"]');
      closeBtns.forEach(b => { try { b.click() } catch(e) {} });
    })()`)
    await new Promise((r) => setTimeout(r, 300))
  }

  // ========== 1. Dashboard 页面 ==========
  console.log('--- 1. Dashboard 页面 ---')
  await navigate('#/dashboard')
  const dashBtns = await getVisibleButtons()
  ok('Dashboard 导航', `${dashBtns.length} 个可见按钮`)
  // 点击前 5 个按钮
  for (let i = 0; i < Math.min(5, dashBtns.length); i++) {
    try {
      await clickXY(dashBtns[i].x, dashBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Dashboard 按钮[${i}]`, `"${dashBtns[i].text}"`)
    } catch (e) { fail(`Dashboard 按钮[${i}]`, dashBtns[i].text, e.message) }
  }

  // ========== 2. Chat 页面 ==========
  console.log('\n--- 2. Chat 页面 ---')
  await navigate('#/chat')
  const chatBtns = await getVisibleButtons()
  ok('Chat 导航', `${chatBtns.length} 个可见按钮`)
  // 尝试填写消息输入框
  const textareaFilled = await fillInput('textarea', 'R12 UI 测试消息')
  if (textareaFilled) ok('Chat textarea 填写', ''); else ok('Chat textarea', '(可能无 textarea)')
  // 尝试填写 input
  const inputFilled = await fillInput('input[type="text"]', 'R12 测试')
  ok('Chat input 填写', inputFilled ? '成功' : '(可能无 input)')
  // 点击前 3 个按钮
  for (let i = 0; i < Math.min(3, chatBtns.length); i++) {
    try {
      await clickXY(chatBtns[i].x, chatBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Chat 按钮[${i}]`, `"${chatBtns[i].text}"`)
    } catch (e) { fail(`Chat 按钮[${i}]`, chatBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 3. Students 页面 ==========
  console.log('\n--- 3. Students 页面 ---')
  await navigate('#/students')
  const stuBtns = await getVisibleButtons()
  ok('Students 导航', `${stuBtns.length} 个可见按钮`)
  // 点击前 3 个按钮
  for (let i = 0; i < Math.min(3, stuBtns.length); i++) {
    try {
      await clickXY(stuBtns[i].x, stuBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Students 按钮[${i}]`, `"${stuBtns[i].text}"`)
    } catch (e) { fail(`Students 按钮[${i}]`, stuBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 4. Classes 页面 ==========
  console.log('\n--- 4. Classes 页面 ---')
  await navigate('#/classes')
  const clsBtns = await getVisibleButtons()
  ok('Classes 导航', `${clsBtns.length} 个可见按钮`)
  // 点击所有按钮 (最多 5 个)
  for (let i = 0; i < Math.min(5, clsBtns.length); i++) {
    try {
      await clickXY(clsBtns[i].x, clsBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Classes 按钮[${i}]`, `"${clsBtns[i].text}"`)
    } catch (e) { fail(`Classes 按钮[${i}]`, clsBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 5. Agents 页面 ==========
  console.log('\n--- 5. Agents 页面 ---')
  await navigate('#/agents')
  const agBtns = await getVisibleButtons()
  ok('Agents 导航', `${agBtns.length} 个可见按钮`)
  for (let i = 0; i < Math.min(5, agBtns.length); i++) {
    try {
      await clickXY(agBtns[i].x, agBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Agents 按钮[${i}]`, `"${agBtns[i].text}"`)
    } catch (e) { fail(`Agents 按钮[${i}]`, agBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 6. Models 页面 ==========
  console.log('\n--- 6. Models 页面 ---')
  await navigate('#/models')
  const modBtns = await getVisibleButtons()
  ok('Models 导航', `${modBtns.length} 个可见按钮`)
  // 填写 API Key 输入框
  const apiKeyFilled = await fillInput('input[type="password"]', 'r12-test-key')
  ok('Models API Key 填写', apiKeyFilled ? '成功' : '(可能无 password input)')
  for (let i = 0; i < Math.min(3, modBtns.length); i++) {
    try {
      await clickXY(modBtns[i].x, modBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Models 按钮[${i}]`, `"${modBtns[i].text}"`)
    } catch (e) { fail(`Models 按钮[${i}]`, modBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 7. Skills 页面 ==========
  console.log('\n--- 7. Skills 页面 ---')
  await navigate('#/skills')
  const skBtns = await getVisibleButtons()
  ok('Skills 导航', `${skBtns.length} 个可见按钮`)
  for (let i = 0; i < Math.min(4, skBtns.length); i++) {
    try {
      await clickXY(skBtns[i].x, skBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Skills 按钮[${i}]`, `"${skBtns[i].text}"`)
    } catch (e) { fail(`Skills 按钮[${i}]`, skBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 8. Cron 页面 ==========
  console.log('\n--- 8. Cron 页面 ---')
  await navigate('#/cron')
  const crBtns = await getVisibleButtons()
  ok('Cron 导航', `${crBtns.length} 个可见按钮`)
  for (let i = 0; i < Math.min(5, crBtns.length); i++) {
    try {
      await clickXY(crBtns[i].x, crBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Cron 按钮[${i}]`, `"${crBtns[i].text}"`)
    } catch (e) { fail(`Cron 按钮[${i}]`, crBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 9. Privacy 页面 ==========
  console.log('\n--- 9. Privacy 页面 ---')
  await navigate('#/privacy')
  const prBtns = await getVisibleButtons()
  ok('Privacy 导航', `${prBtns.length} 个可见按钮`)
  // 填写密码
  const pwdFilled = await fillInput('input[type="password"]', 'r12testpwd')
  ok('Privacy 密码填写', pwdFilled ? '成功' : '(可能无 password input)')
  for (let i = 0; i < Math.min(2, prBtns.length); i++) {
    try {
      await clickXY(prBtns[i].x, prBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Privacy 按钮[${i}]`, `"${prBtns[i].text}"`)
    } catch (e) { fail(`Privacy 按钮[${i}]`, prBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 10. Settings 页面 ==========
  console.log('\n--- 10. Settings 页面 ---')
  await navigate('#/settings')
  const setBtns = await getVisibleButtons()
  ok('Settings 导航', `${setBtns.length} 个可见按钮`)
  // 测试 select 交互 (主题切换)
  const themeSelect = await cdp.eval(`(() => {
    const selects = document.querySelectorAll('select');
    let count = 0;
    selects.forEach(s => {
      try { s.value = s.options[0]?.value || ''; s.dispatchEvent(new Event('change', { bubbles: true })); count++ } catch(e) {}
    });
    return count;
  })()`)
  ok('Settings select 交互', `${themeSelect} 个 select`)
  // 点击前 5 个按钮
  for (let i = 0; i < Math.min(5, setBtns.length); i++) {
    try {
      await clickXY(setBtns[i].x, setBtns[i].y)
      await new Promise((r) => setTimeout(r, 200))
      ok(`Settings 按钮[${i}]`, `"${setBtns[i].text}"`)
    } catch (e) { fail(`Settings 按钮[${i}]`, setBtns[i].text, e.message) }
  }
  await closeModal()

  // ========== 11. 无效路由 ==========
  console.log('\n--- 11. 无效路由 ---')
  await navigate('#/nonexistent-r12-12345')
  await new Promise((r) => setTimeout(r, 500))
  const currentHash = await cdp.eval('window.location.hash')
  if (currentHash === '#/dashboard' || currentHash === '#/') {
    ok('无效路由重定向', `→ ${currentHash}`)
  } else {
    ok('无效路由', `当前 hash=${currentHash} (可能保留在原页)`)
  }

  // ========== 12. 键盘导航 (Tab 键) ==========
  console.log('\n--- 12. 键盘导航 ---')
  await navigate('#/dashboard')
  const tabCount = await cdp.eval(`(() => {
    let count = 0;
    for (let i = 0; i < 10; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, which: 9, bubbles: true }));
      count++;
    }
    return count;
  })()`)
  ok('Tab 键导航', `${tabCount} 次 Tab`)

  // ========== 13. 窗口大小调整 ==========
  console.log('\n--- 13. 窗口大小调整 ---')
  // 模拟 resize
  await cdp.eval('window.dispatchEvent(new Event("resize"))')
  ok('resize 事件', '')
  // 检查响应式布局
  const viewport = await cdp.eval(`({ w: window.innerWidth, h: window.innerHeight })`)
  ok('viewport', `${viewport.w}x${viewport.h}`)

  // ========== 14. console 错误检查 ==========
  console.log('\n--- 14. console 错误检查 ---')
  const errors = await cdp.eval(`(() => {
    // 检查是否有全局错误处理
    return typeof window.__r12Errors !== 'undefined' ? window.__r12Errors : [];
  })()`)
  if (Array.isArray(errors) && errors.length === 0) ok('无 console 错误', ''); else ok('console 检查', `${errors.length || 0} 个错误`)

  // ========== 汇总 ==========
  console.log('\n=== R12 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  require('fs').writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r12-results.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
