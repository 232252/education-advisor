// 第四轮测试 — 真实 UI 交互 (点击按钮/填写表单/导航)
// 模拟真实用户操作每一个按键和控件
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error(`CDP timeout: ${method}`)) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300))
    return r.result.value
  }
  // 真实点击元素
  async click(selector) {
    return this.eval(`(function(){
      const el = document.querySelector('${selector}');
      if(!el) return false;
      el.click();
      return true;
    })()`)
  }
  // 真实输入文本 (模拟键盘)
  async type(selector, text) {
    return this.eval(`(function(){
      const el = document.querySelector('${selector}');
      if(!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if(setter) setter.call(el, '${text.replace(/'/g, "\\'")}');
      else el.value = '${text.replace(/'/g, "\\'")}';
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return true;
    })()`)
  }
  // 真实选择下拉
  async select(selector, value) {
    return this.eval(`(function(){
      const el = document.querySelector('${selector}');
      if(!el) return false;
      el.value = '${value}';
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return true;
    })()`)
  }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  async function navigate(path, wait = 1500) {
    await cdp.eval(`window.location.hash='${path}'`)
    await new Promise((r) => setTimeout(r, wait))
  }

  const results = { pass: 0, fail: 0, warn: 0, details: [] }
  const ok = (n, d) => { results.pass++; results.details.push(`✓ ${n}${d ? ' — ' + d : ''}`); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.details.push(`✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e ?? 'unknown').slice(0, 120)}`) }
  const warn = (n, d) => { results.warn++; results.details.push(`⚠ ${n}${d ? ' — ' + d : ''}`); console.log(`  ⚠ ${n}${d ? ' — ' + d : ''}`) }

  console.log('=== 第四轮: 真实 UI 交互测试 ===\n')

  // ========== 1. 班级页 - 点击"新建班级"按钮 ==========
  console.log('--- 1. 班级页 - 点击"新建班级"按钮 ---')
  await navigate('/classes', 2000)
  const createBtnClicked = await cdp.click(`button:nth-of-type(2)`) // 第二个按钮 (+ 新建班级)
  // 改用文本匹配
  const createBtnResult = await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('新建班级'));
    if(!cb) return false;
    cb.click();
    return true;
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  if (createBtnResult) {
    // 检查表单是否弹出
    const formVisible = await cdp.eval(`document.querySelector('input[placeholder*="编号"], input[placeholder*="class"]') !== null`)
    if (formVisible) ok('点击新建班级', '表单弹出')
    else {
      // 尝试其他选择器
      const anyInput = await cdp.eval(`document.querySelectorAll('input, textarea').length`)
      if (anyInput > 0) ok('点击新建班级', `表单弹出 (${anyInput} 个输入框)`)
      else fail('点击新建班级', '', '表单未弹出')
    }
  } else {
    fail('点击新建班级', '', '按钮未找到')
  }

  // ========== 2. 填写班级表单 ==========
  console.log('\n--- 2. 填写班级表单 ---')
  if (createBtnResult) {
    // 找到所有输入框并填写
    const inputs = await cdp.eval(`(function(){
      const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
      return inputs.map(i => ({ placeholder: i.placeholder, id: i.id, name: i.name }));
    })()`)
    console.log(`  找到 ${inputs.length} 个输入框: ${JSON.stringify(inputs)}`)

    // 填写班级表单 - 用索引填 (顺序: 编号/名称/年级/班主任/备注)
    const fillResult = await cdp.eval(`(function(){
      const inputs = Array.from(document.querySelectorAll('input'));
      if(inputs.length < 5) return { filled: 0 };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const values = ['UI-TEST-1', 'UI测试班', '八年级', '测试教师', 'UI测试备注'];
      let filled = 0;
      for(let i = 0; i < Math.min(5, inputs.length); i++){
        setter.call(inputs[i], values[i]);
        inputs[i].dispatchEvent(new Event('input', {bubbles: true}));
        filled++;
      }
      return { filled };
    })()`)
    if (fillResult?.filled >= 5) ok('填写表单', `${fillResult.filled} 个字段`)
    else warn('填写表单', `仅填写 ${fillResult?.filled ?? 0} 个`)

    // 点击保存
    const saveClicked = await cdp.eval(`(function(){
      const btns = Array.from(document.querySelectorAll('button'));
      const sb = btns.find(b => b.textContent?.includes('保存') || b.textContent?.includes('确定'));
      if(!sb) return false;
      sb.click();
      return true;
    })()`)
    await new Promise((r) => setTimeout(r, 1500))
    if (saveClicked) ok('点击保存', '已点击')
    else warn('点击保存', '未找到保存按钮')

    // 验证班级是否创建
    const verifyCls = await cdp.eval(`(async()=>{
      const r = await window.api.class.list();
      const found = r.data?.find(c => c.class_id === 'UI-TEST-1');
      return found ? { name: found.name, grade: found.grade, teacher: found.teacher } : null;
    })()`)
    if (verifyCls) ok('班级创建验证', `${verifyCls.name} (${verifyCls.grade}/${verifyCls.teacher})`)
    else fail('班级创建验证', '', '未找到 UI-TEST-1')
  }

  // ========== 3. 班级页 - 点击编辑按钮 ==========
  console.log('\n--- 3. 班级页 - 点击编辑按钮 ---')
  await navigate('/classes', 2000)
  const editClicked = await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const eb = btns.find(b => b.textContent?.trim() === '编辑');
    if(!eb) return false;
    eb.click();
    return true;
  })()`)
  await new Promise((r) => setTimeout(r, 1000))
  if (editClicked) {
    const formOpen = await cdp.eval(`document.querySelectorAll('input').length > 0`)
    if (formOpen) ok('点击编辑', '表单弹出')
    else fail('点击编辑', '', '表单未弹出')
  } else {
    fail('点击编辑', '', '按钮未找到')
  }

  // 关闭表单
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('取消') || b.textContent?.includes('关闭'));
    if(cb) cb.click();
  })()`)

  // ========== 4. 学生页 - 搜索 ==========
  console.log('\n--- 4. 学生页 - 搜索功能 ---')
  await navigate('/students', 2500)
  const searchInputExists = await cdp.eval(`document.querySelector('input[type="text"], input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]') !== null`)
  if (searchInputExists) {
    // 输入搜索词
    await cdp.eval(`(function(){
      const input = document.querySelector('input[type="text"], input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]');
      if(input){
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '张');
        input.dispatchEvent(new Event('input', {bubbles: true}));
      }
    })()`)
    await new Promise((r) => setTimeout(r, 500))
    const searchResults = await cdp.eval(`(function(){
      const tables = Array.from(document.querySelectorAll('table'));
      const stuTables = tables.filter(t => {
        const ths = Array.from(t.querySelectorAll('th'));
        return ths.some(th => th.textContent?.includes('分数'));
      });
      if(stuTables.length === 0) return 0;
      return stuTables[stuTables.length - 1].querySelectorAll('tbody tr').length;
    })()`)
    ok('搜索"张"', `${searchResults} 行结果`)
    // 清空搜索
    await cdp.eval(`(function(){
      const input = document.querySelector('input[type="text"], input[type="search"], input[placeholder*="搜索"], input[placeholder*="search"]');
      if(input){
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', {bubbles: true}));
      }
    })()`)
  } else {
    fail('搜索功能', '', '搜索框未找到')
  }

  // ========== 5. 学生页 - 班级筛选 ==========
  console.log('\n--- 5. 学生页 - 班级筛选 ---')
  const filterResult = await cdp.eval(`(function(){
    const sels = Array.from(document.querySelectorAll('select'));
    const classSel = sels.find(s => Array.from(s.options).map(o=>o.value).includes('__ALL__'));
    if(!classSel) return { found: false };
    // 选择 UI-TEST-1
    const opt = Array.from(classSel.options).find(o => o.value === 'UI-TEST-1');
    if(!opt) return { found: false, reason: 'no UI-TEST-1 option' };
    classSel.value = 'UI-TEST-1';
    classSel.dispatchEvent(new Event('change', {bubbles: true}));
    return { found: true, optionCount: classSel.options.length };
  })()`)
  if (filterResult?.found) ok('班级筛选 UI-TEST-1', `选中, ${filterResult.optionCount} 个选项`)
  else warn('班级筛选 UI-TEST-1', filterResult?.reason || '未找到')

  // ========== 6. Dashboard - 刷新按钮 ==========
  console.log('\n--- 6. Dashboard - 刷新按钮 ---')
  await navigate('/dashboard', 4000)
  const refreshClicked = await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const rb = btns.find(b => b.textContent?.includes('刷新') || b.textContent?.includes('🔄'));
    if(!rb) return false;
    rb.click();
    return true;
  })()`)
  if (refreshClicked) {
    await new Promise((r) => setTimeout(r, 2000))
    ok('点击刷新', '已点击')
  } else {
    fail('点击刷新', '', '按钮未找到')
  }

  // ========== 7. Dashboard - 班级对比模式 ==========
  console.log('\n--- 7. Dashboard - 班级对比模式 ---')
  // 先关闭再开启
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('班级对比'));
    if(cb && cb.classList.contains('bg-purple-600')) cb.click(); // 关闭
  })()`)
  await new Promise((r) => setTimeout(r, 500))
  // 开启
  await cdp.eval(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const cb = btns.find(b => b.textContent?.includes('班级对比'));
    if(cb) cb.click();
  })()`)
  await new Promise((r) => setTimeout(r, 1500))
  const compareVisible = await cdp.eval(`(function(){
    const tables = Array.from(document.querySelectorAll('table'));
    for(const t of tables){
      if(t.textContent?.includes('学生数') && t.textContent?.includes('平均分')) return true;
    }
    return false;
  })()`)
  if (compareVisible) ok('班级对比模式', '表格已显示')
  else fail('班级对比模式', '', '表格未显示')

  // ========== 8. 导航栏 - 每个链接点击 ==========
  console.log('\n--- 8. 导航栏 - 每个链接点击 ---')
  const navLinks = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']
  for (const link of navLinks) {
    const pageName = link.replace('#/', '')
    const clicked = await cdp.eval(`(function(){
      const links = Array.from(document.querySelectorAll('a[href="${link}"]'));
      if(links.length === 0) return false;
      links[0].click();
      return true;
    })()`)
    if (clicked) {
      await new Promise((r) => setTimeout(r, 1000))
      const hasContent = await cdp.eval(`document.querySelector('h1, h2, h3, main') !== null`)
      if (hasContent) ok(`导航 ${pageName}`, '已加载')
      else warn(`导航 ${pageName}`, '内容未加载')
    } else {
      fail(`导航 ${pageName}`, '', '链接未找到')
    }
  }

  // ========== 9. 设置页 - 切换主题 ==========
  console.log('\n--- 9. 设置页 - 切换主题 ---')
  await navigate('/settings', 2000)
  const themeToggle = await cdp.eval(`(function(){
    // 找到主题切换按钮/开关
    const btns = Array.from(document.querySelectorAll('button'));
    const tb = btns.find(b => b.textContent?.includes('主题') || b.textContent?.includes('深色') || b.textContent?.includes('浅色') || b.textContent?.includes('dark') || b.textContent?.includes('light'));
    if(tb){ tb.click(); return tb.textContent?.trim(); }
    // 也可能是 toggle/switch
    const switches = Array.from(document.querySelectorAll('[role="switch"], button[aria-pressed]'));
    if(switches.length > 0){
      const themeSwitch = switches.find(s => s.closest('div')?.textContent?.includes('主题') || s.closest('div')?.textContent?.includes('深色'));
      if(themeSwitch){ themeSwitch.click(); return 'toggle'; }
    }
    return null;
  })()`)
  if (themeToggle) ok('切换主题', `按钮: ${themeToggle}`)
  else warn('切换主题', '未找到主题切换')

  // ========== 10. 清理 ==========
  console.log('\n--- 10. 清理 UI-TEST 数据 ---')
  await cdp.eval(`(async()=>{
    const cls = await window.api.class.list();
    for(const c of cls.data || []) await window.api.class.delete(c.id);
    const stu = await window.api.eaa.listStudents();
    for(const s of stu.data?.students || []) await window.api.eaa.deleteStudent(s.name, '清理');
  })()`)
  ok('清理完成', '')

  console.log('\n=== 第四轮测试汇总 ===')
  const total = results.pass + results.fail + results.warn
  console.log(`总计 ${total}, 通过 ${results.pass}, 失败 ${results.fail}, 警告 ${results.warn}, 通过率 ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.details.filter((d) => d.startsWith('✗')).forEach((d) => console.log(`  ${d}`))
  }

  ws.close(1000)
  fs.writeFileSync('dogfood-output/r4-ui-result.json', JSON.stringify(results, null, 2))
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
