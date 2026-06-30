// =============================================================
// 第四轮:UI 级表单交互测试
// 通过 CDP 模拟真实用户操作:点击导航、填写表单、提交、验证 UI 更新
// 重点测试:学生添加/班级创建/技能编辑/隐私初始化/对话输入/logLevel 切换
// =============================================================
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('timeout')))
  })
}

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    if (!page) throw new Error('No page target')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => this.ws.on('open', r))
    this.id = 0; this.pending = new Map()
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.id && this.pending.has(obj.id)) {
        const { resolve, reject } = this.pending.get(obj.id)
        this.pending.delete(obj.id)
        if (obj.error) reject(new Error(JSON.stringify(obj.error)))
        else resolve(obj.result)
      }
    })
    // 启用 console 和 runtime
    await this.send('Runtime.enable')
    await this.send('Log.enable')
    this.consoleMessages = []
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.method === 'Runtime.consoleAPICalled' || obj.method === 'Log.entryAdded') {
        this.consoleMessages.push(obj)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 15000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  async navigate(hash) {
    await this.eval(`window.location.hash = '${hash}'`)
    await new Promise(r => setTimeout(r, 1500)) // 等待页面渲染
  }
  async clickByText(tag, text) {
    return this.eval(`(function() {
      const els = document.querySelectorAll('${tag}');
      for (const el of els) {
        if (el.textContent.includes('${text}')) {
          el.click();
          return true;
        }
      }
      return false;
    })()`)
  }
  async fillInput(selector, value) {
    return this.eval(`(function() {
      const el = document.querySelector('${selector}');
      if (!el) return false;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(el, '${value}');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
  }
  async fillTextarea(selector, value) {
    return this.eval(`(function() {
      const el = document.querySelector('${selector}');
      if (!el) return false;
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
  }
  async getVisibleInputs() {
    return this.eval(`(function() {
      const inputs = document.querySelectorAll('input, textarea, select');
      return Array.from(inputs).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        id: el.id || '',
        name: el.name || '',
        placeholder: el.placeholder || '',
        value: el.value || '',
        className: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
      }));
    })()`)
  }
  async getVisibleButtons() {
    return this.eval(`(function() {
      const btns = document.querySelectorAll('button, [role="button"], a[href]');
      return Array.from(btns).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).map(el => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().slice(0, 60),
        href: el.getAttribute('href') || '',
      })).slice(0, 30);
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(name, result) {
  const ok = result !== false && !result.__error
  results.push({ name, ok, error: result.__error || (result === false ? 'element not found' : null) })
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${name}${!ok ? ' :: ' + (result.__error || 'not found') : ''}`)
  return result
}

async function main() {
  const cdp = new CDPClient()
  await cdp.connect()
  console.log('CDP connected. UI interaction tests...\n')

  // =========================================================
  // 1. 仪表盘 - 验证初始加载
  // =========================================================
  console.log('=== 1. 仪表盘 ===')
  await cdp.navigate('#/dashboard')
  const dashText = await cdp.eval('document.body.innerText.slice(0, 500)')
  console.log('  Dashboard text:', dashText?.slice(0, 200))
  record('dashboard.load', dashText ? true : false)

  // =========================================================
  // 2. 学生页面 - 测试添加学生表单
  // =========================================================
  console.log('\n=== 2. 学生页面 ===')
  await cdp.navigate('#/students')
  const studentsText = await cdp.eval('document.body.innerText.slice(0, 300)')
  console.log('  Students page text:', studentsText?.slice(0, 150))

  // 查找输入框
  let inputs = await cdp.getVisibleInputs()
  console.log(`  Found ${inputs?.length || 0} inputs`)
  if (inputs) inputs.slice(0, 5).forEach(i => console.log(`    - ${i.tag} type=${i.type} placeholder="${i.placeholder}"`))

  // 尝试查找"添加学生"按钮
  const addBtnFound = await cdp.clickByText('button', '添加')
  console.log('  Add button found:', addBtnFound)
  if (addBtnFound) {
    await new Promise(r => setTimeout(r, 1000))
    // 查找弹出的表单
    inputs = await cdp.getVisibleInputs()
    console.log(`  After click: ${inputs?.length || 0} inputs`)
    if (inputs) inputs.slice(0, 5).forEach(i => console.log(`    - ${i.tag} type=${i.type} placeholder="${i.placeholder}"`))

    // 填写学生姓名
    if (inputs && inputs.length > 0) {
      const nameInput = inputs.find(i => i.placeholder?.includes('名') || i.placeholder?.includes('学生') || i.type === 'text')
      if (nameInput) {
        // 用 selector 填写
        const fillResult = await cdp.eval(`(function() {
          const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
          for (const el of inputs) {
            if (el.getBoundingClientRect().width > 0 && el.placeholder.includes('名')) {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(el, 'UI测试学生');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
          return false;
        })()`)
        record('students.fill_name', fillResult)
      }
    }
  }
  record('students.page_load', studentsText ? true : false)

  // =========================================================
  // 3. 班级页面 - 测试创建班级表单
  // =========================================================
  console.log('\n=== 3. 班级页面 ===')
  await cdp.navigate('#/classes')
  const classesText = await cdp.eval('document.body.innerText.slice(0, 300)')
  console.log('  Classes page text:', classesText?.slice(0, 150))

  inputs = await cdp.getVisibleInputs()
  console.log(`  Found ${inputs?.length || 0} inputs`)
  if (inputs) inputs.forEach(i => console.log(`    - ${i.tag} type=${i.type} placeholder="${i.placeholder}" id="${i.id}"`))

  // 尝试填写班级编号
  if (inputs && inputs.length >= 2) {
    // 找 class_id 输入框
    const classIdInput = inputs.find(i => i.placeholder?.includes('编号') || i.name?.includes('class_id') || i.id?.includes('class_id'))
    if (classIdInput) {
      const sel = classIdInput.id ? `#${classIdInput.id}` : `input[placeholder="${classIdInput.placeholder}"]`
      record('classes.fill_class_id', await cdp.fillInput(sel, 'UI-TEST-001'))
    }

    // 找班级名称输入框
    const nameInput = inputs.find(i => i.placeholder?.includes('名称') || i.placeholder?.includes('班级'))
    if (nameInput) {
      const sel = nameInput.id ? `#${nameInput.id}` : `input[placeholder="${nameInput.placeholder}"]`
      record('classes.fill_name', await cdp.fillInput(sel, 'UI测试班级'))
    }

    // 找提交按钮
    const submitResult = await cdp.clickByText('button', '创建')
    record('classes.submit', submitResult)
    await new Promise(r => setTimeout(r, 1000))
  }
  record('classes.page_load', classesText ? true : false)

  // =========================================================
  // 4. 技能页面 - 测试技能编辑
  // =========================================================
  console.log('\n=== 4. 技能页面 ===')
  await cdp.navigate('#/skills')
  await new Promise(r => setTimeout(r, 1000))
  const skillsText = await cdp.eval('document.body.innerText.slice(0, 300)')
  console.log('  Skills page text:', skillsText?.slice(0, 150))

  // 查找技能列表和新建按钮
  const skillBtns = await cdp.getVisibleButtons()
  console.log(`  Found ${skillBtns?.length || 0} buttons`)
  if (skillBtns) skillBtns.slice(0, 10).forEach(b => console.log(`    - ${b.tag}: "${b.text}"`))

  // 尝试点击"新建"或"创建"按钮
  const newSkillBtn = await cdp.clickByText('button', '新建')
  if (!newSkillBtn) await cdp.clickByText('button', '创建')
  await new Promise(r => setTimeout(r, 1000))

  // 查找 textarea
  const textareas = await cdp.eval(`(function() {
    const tas = document.querySelectorAll('textarea');
    return Array.from(tas).filter(el => el.getBoundingClientRect().width > 0).map(el => ({
      id: el.id, name: el.name, placeholder: el.placeholder,
      className: (typeof el.className === 'string' ? el.className : '').slice(0, 80)
    }));
  })()`)
  console.log(`  Found ${textareas?.length || 0} textareas`)
  record('skills.page_load', skillsText ? true : false)

  // =========================================================
  // 5. 设置页面 - logLevel 切换(调查循环 bug)
  // =========================================================
  console.log('\n=== 5. 设置页面 - logLevel 切换 ===')
  await cdp.navigate('#/settings')
  await new Promise(r => setTimeout(r, 2000))
  const settingsText = await cdp.eval('document.body.innerText.slice(0, 300)')
  console.log('  Settings page loaded')

  // 查找 logLevel select
  const logLevelSelect = await cdp.eval(`(function() {
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const label = sel.closest('label, div')?.textContent || '';
      if (label.includes('日志') || label.includes('logLevel') || label.includes('Log Level')) {
        return {
          found: true,
          value: sel.value,
          options: Array.from(sel.options).map(o => o.value + ':' + o.text),
          id: sel.id,
        };
      }
    }
    return { found: false };
  })()`)
  console.log('  logLevel select:', JSON.stringify(logLevelSelect).slice(0, 200))
  record('settings.find_logLevel', logLevelSelect?.found || false)

  if (logLevelSelect?.found) {
    // 切换到 debug
    const switchToDebug = await cdp.eval(`(function() {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const label = sel.closest('label, div')?.textContent || '';
        if (label.includes('日志') || label.includes('logLevel')) {
          sel.value = 'debug';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return sel.value;
        }
      }
      return false;
    })()`)
    console.log('  Switched to debug:', switchToDebug)
    record('settings.logLevel.debug', switchToDebug === 'debug')

    await new Promise(r => setTimeout(r, 2000))

    // 检查是否有循环(检查 console 消息数量)
    const msgCount = cdp.consoleMessages.length
    console.log(`  Console messages after switch: ${msgCount}`)
    record('settings.logLevel.no_loop', msgCount < 50) // 如果 > 50 条消息,可能有循环

    // 切换回 info
    const switchToInfo = await cdp.eval(`(function() {
      const selects = document.querySelectorAll('select');
      for (const sel of selects) {
        const label = sel.closest('label, div')?.textContent || '';
        if (label.includes('日志') || label.includes('logLevel')) {
          sel.value = 'info';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return sel.value;
        }
      }
      return false;
    })()`)
    record('settings.logLevel.info', switchToInfo === 'info')

    await new Promise(r => setTimeout(r, 1000))
    const msgCount2 = cdp.consoleMessages.length
    console.log(`  Console messages after switch back: ${msgCount2}`)
  }

  // =========================================================
  // 6. 隐私页面 - 测试初始化表单
  // =========================================================
  console.log('\n=== 6. 隐私页面 ===')
  await cdp.navigate('#/privacy')
  await new Promise(r => setTimeout(r, 1500))
  const privacyText = await cdp.eval('document.body.innerText.slice(0, 300)')
  console.log('  Privacy page text:', privacyText?.slice(0, 150))

  inputs = await cdp.getVisibleInputs()
  console.log(`  Found ${inputs?.length || 0} inputs`)
  if (inputs) inputs.forEach(i => console.log(`    - ${i.tag} type=${i.type} placeholder="${i.placeholder}"`))

  // 查找密码输入框
  if (inputs) {
    const pwdInput = inputs.find(i => i.type === 'password')
    if (pwdInput) {
      record('privacy.find_password_input', true)
      // 填写密码
      const sel = pwdInput.id ? `#${pwdInput.id}` : `input[type="password"]`
      record('privacy.fill_password', await cdp.fillInput(sel, 'test1234'))

      // 点击初始化按钮
      const initBtn = await cdp.clickByText('button', '初始化')
      record('privacy.click_init', initBtn)
      await new Promise(r => setTimeout(r, 1500))
    } else {
      record('privacy.find_password_input', false)
    }
  }
  record('privacy.page_load', privacyText ? true : false)

  // =========================================================
  // 7. Agent 页面 - 测试 toggle
  // =========================================================
  console.log('\n=== 7. Agent 页面 ===')
  await cdp.navigate('#/agents')
  await new Promise(r => setTimeout(r, 1500))
  const agentsText = await cdp.eval('document.body.innerText.slice(0, 500)')
  console.log('  Agents page text:', agentsText?.slice(0, 200))

  // 查找 agent toggle 按钮/开关
  const toggleBtns = await cdp.eval(`(function() {
    const btns = document.querySelectorAll('button, [role="switch"], [role="button"]');
    return Array.from(btns).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).filter(el => {
      const text = el.textContent || '';
      const cls = typeof el.className === 'string' ? el.className : '';
      return text.includes('启用') || text.includes('停用') || text.includes('开启') ||
             cls.includes('toggle') || cls.includes('switch') || el.getAttribute('role') === 'switch';
    }).map(el => ({
      text: (el.textContent || '').trim().slice(0, 40),
      role: el.getAttribute('role') || '',
      className: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
    })).slice(0, 5);
  })()`)
  console.log(`  Found ${toggleBtns?.length || 0} toggle buttons`)
  record('agents.page_load', agentsText ? true : false)

  // =========================================================
  // 8. 对话页面 - 测试消息输入
  // =========================================================
  console.log('\n=== 8. 对话页面 ===')
  await cdp.navigate('#/chat')
  await new Promise(r => setTimeout(r, 1500))
  const chatText = await cdp.eval('document.body.innerText.slice(0, 300)')
  console.log('  Chat page text:', chatText?.slice(0, 150))

  inputs = await cdp.getVisibleInputs()
  console.log(`  Found ${inputs?.length || 0} inputs`)
  // 查找 textarea(对话输入通常是 textarea)
  const chatTextareas = await cdp.eval(`(function() {
    const tas = document.querySelectorAll('textarea');
    return Array.from(tas).filter(el => el.getBoundingClientRect().width > 0).map(el => ({
      placeholder: el.placeholder || '',
      className: (typeof el.className === 'string' ? el.className : '').slice(0, 80),
    }));
  })()`)
  console.log(`  Found ${chatTextareas?.length || 0} textareas`)
  if (chatTextareas && chatTextareas.length > 0) {
    console.log(`  Chat textarea placeholder: "${chatTextareas[0].placeholder}"`)
    // 填写消息(不发送,因为没有配置 API key)
    record('chat.find_input', true)
  } else {
    record('chat.find_input', false)
  }
  record('chat.page_load', chatText ? true : false)

  // =========================================================
  // 9. 任务页面 - 验证加载
  // =========================================================
  console.log('\n=== 9. 任务页面 ===')
  await cdp.navigate('#/scheduler')
  await new Promise(r => setTimeout(r, 1500))
  const cronText = await cdp.eval('document.body.innerText.slice(0, 300)')
  console.log('  Scheduler page text:', cronText?.slice(0, 150))
  record('scheduler.page_load', cronText ? true : false)

  // =========================================================
  // 10. 模型页面 - 验证加载
  // =========================================================
  console.log('\n=== 10. 模型页面 ===')
  await cdp.navigate('#/models')
  await new Promise(r => setTimeout(r, 1500))
  const modelsText = await cdp.eval('document.body.innerText.slice(0, 300)')
  console.log('  Models page text:', modelsText?.slice(0, 150))
  record('models.page_load', modelsText ? true : false)

  // =========================================================
  // 汇总
  // =========================================================
  console.log('\n\n============================================================')
  console.log('UI INTERACTION TEST SUMMARY')
  console.log('============================================================')
  let ok = 0, fail = 0
  for (const r of results) { if (r.ok) ok++; else { fail++; console.log(`  FAIL: ${r.name} :: ${r.error}`) } }
  console.log(`\nTotal: ${ok} ok, ${fail} fail, ${results.length} tests`)
  console.log(`Console messages captured: ${cdp.consoleMessages.length}`)

  const fs = require('fs')
  fs.writeFileSync('C:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round4-ui.json', JSON.stringify({
    summary: { ok, fail, total: results.length, consoleMessages: cdp.consoleMessages.length },
    results,
  }, null, 2))

  cdp.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
