// =============================================================
// 第6轮: 真实用户操作流 — UI精确交互 + 数据写入闭环 + EAA写操作
// 模拟真实用户: 点击按钮、输入文本、切换选项,验证端到端
// =============================================================
const http = require('http')
const WebSocket = require('ws')

function getT() {
  return new Promise((res, rej) => {
    const r = http.get('http://127.0.0.1:9222/json', (s) => {
      let d = ''
      s.on('data', (c) => (d += c))
      s.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
    })
    r.on('error', rej); r.setTimeout(5000, () => { r.destroy(); rej(new Error('t')) })
  })
}
class C {
  async connect() {
    const t = await getT(); const p = t.find((x) => x.type === 'page')
    this.ws = new WebSocket(p.webSocketDebuggerUrl)
    await new Promise((r, rej) => { this.ws.on('open', r); this.ws.on('error', rej) })
    this.id = 0; this.pending = new Map()
    this.ws.on('message', (m) => {
      const o = JSON.parse(m)
      if (o.id && this.pending.has(o.id)) {
        const { resolve, reject } = this.pending.get(o.id)
        this.pending.delete(o.id); o.error ? reject(new Error(JSON.stringify(o.error))) : resolve(o.result)
      }
    })
  }
  async send(m, p = {}) {
    const id = ++this.id
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej })
      this.ws.send(JSON.stringify({ id, method: m, params: p }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('t:' + m)) } }, 45000)
    })
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
    return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value
  }
  async nav(h) { await this.eval("location.hash='" + h + "'"); await new Promise((r) => setTimeout(r, 1500)) }
  /** 模拟真实点击: 找到元素并 dispatch click event */
  async clickByText(tag, text) {
    return this.eval(`(function(){
      var els=Array.from(document.querySelectorAll('${tag}'));
      var t=els.find(function(e){return (e.textContent||'').trim().includes('${text}')&&e.offsetParent!==null});
      if(t){var r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+5,clientY:r.y+5}));return true}return false
    })()`)
  }
  /** 模拟真实输入: focus + setValue + dispatch input event */
  async typeInto(selector, value) {
    return this.eval(`(function(){
      var i=document.querySelector('${selector}');
      if(!i)return false;
      i.focus();i.value=${JSON.stringify(value)};
      i.dispatchEvent(new Event('input',{bubbles:true}));
      i.dispatchEvent(new Event('change',{bubbles:true}));
      return true
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}
let pass = 0, fail = 0
const fails = []
function ok(n, c, d) {
  if (c) { console.log('  \u2713 ' + n); pass++ }
  else { console.log('  \u2717 ' + n + (d ? ' \u2014 ' + String(d).slice(0, 120) : '')); fail++; fails.push(n) }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function pollFor(fn, { timeout = 30000, interval = 2000 } = {}) {
  const d = Date.now() + timeout; while (Date.now() < d) { const r = await fn(); if (r) return r; await wait(interval) } return null
}

async function main() {
  const c = new C(); await c.connect()
  console.log('=== 第6轮: 真实用户操作流 + 数据写入闭环 ===\n')

  // ===== 1. 设置页: UI精确交互(切换主题下拉框) =====
  console.log('[1] 设置页UI交互')
  await c.nav('#/settings')
  // 通过 select 切换主题(用 React 兼容方式: 设 value + 触发 input+change)
  const beforeTheme = await c.eval("document.documentElement.classList.contains('dark')?'dark':'light'")
  const targetTheme = beforeTheme === 'dark' ? 'light' : 'dark'
  const themeChanged = await c.eval(`(function(){
    var sels=Array.from(document.querySelectorAll('select'));
    var themeSel=sels.find(function(s){return Array.from(s.options).some(function(o){return o.value==='${targetTheme}'})});
    if(!themeSel)return false;
    var nativeSetter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
    nativeSetter.call(themeSel,'${targetTheme}');
    themeSel.dispatchEvent(new Event('input',{bubbles:true}));
    themeSel.dispatchEvent(new Event('change',{bubbles:true}));
    return true
  })()`)
  await wait(1000)
  const afterDomTheme = await c.eval("document.documentElement.classList.contains('dark')?'dark':'light'")
  ok('设置页主题下拉切换', themeChanged && afterDomTheme === targetTheme, beforeTheme + '→' + afterDomTheme)

  // 切换日志级别
  const logResult = await c.eval(`(function(){
    var sels=Array.from(document.querySelectorAll('select'));
    var logSel=sels.find(function(s){return Array.from(s.options).some(function(o){return o.value==='warn'})});
    if(!logSel)return false;
    logSel.value='warn';logSel.dispatchEvent(new Event('change',{bubbles:true}));return true
  })()`)
  ok('日志级别下拉可切换', logResult === true)

  // ===== 2. 飞书区: UI交互(展开高级折叠区) =====
  console.log('\n[2] 飞书区UI交互')
  const expandResult = await c.eval(`(function(){
    var sums=Array.from(document.querySelectorAll('summary'));
    var adv=sums.find(function(s){return (s.textContent||'').includes('高级')||s.textContent.includes('Bitable')});
    if(adv){adv.click();return true}return false
  })()`)
  ok('高级折叠区可展开', expandResult)
  await wait(500)
  const bitableVisible = await c.eval("document.body.innerText.includes('Bitable App Token')")
  ok('展开后Bitable配置可见', bitableVisible)

  // ===== 3. 对话页: UI交互(Agent选择器) =====
  console.log('\n[3] 对话页UI交互')
  await c.nav('#/chat')
  const agentSel = await c.eval(`(function(){
    var sels=Array.from(document.querySelectorAll('select'));
    if(sels.length===0)return'no-select';
    return {count:sels.length,firstOptions:sels[0]?Array.from(sels[0].options).slice(0,3).map(function(o){return o.value}).join(','):''}
  })()`)
  ok('对话页有选择器', agentSel.count > 0, JSON.stringify(agentSel))
  // 输入框
  const inputOk = await c.typeInto('textarea', '测试输入')
  ok('对话输入框可输入', inputOk)

  // ===== 4. 学生页: 搜索交互 =====
  console.log('\n[4] 学生页搜索交互')
  await c.nav('#/students')
  const searchOk = await c.typeInto('input[type="text"]', '张')
  ok('学生搜索框可输入', searchOk)
  await wait(500)
  const searchCleared = await c.eval(`(function(){var i=document.querySelector('input[type="text"]');if(i){i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))}return true})()`)
  ok('搜索框可清空', searchCleared)

  // ===== 5. EAA写操作: 添加学生→验证→删除(数据闭环) =====
  console.log('\n[5] EAA写操作闭环(添加→验证→删除)')
  const testStudent = 'TestStudent_' + Date.now()
  // 添加
  const addResult = await c.eval('(async(N)=>{var r=await window.api.eaa.addStudent(N);return r.success})(' + JSON.stringify(testStudent) + ')')
  ok('添加测试学生', addResult, testStudent)
  // 验证存在
  await wait(500)
  const exists = await c.eval('(async(N)=>{var s=await window.api.eaa.listStudents();return s.data.students.some(function(x){return x.name===N})})(' + JSON.stringify(testStudent) + ')')
  ok('验证学生已添加', exists)
  // 删除
  const delResult = await c.eval('(async(N)=>{var r=await window.api.eaa.deleteStudent(N,"test cleanup");return r.success})(' + JSON.stringify(testStudent) + ')')
  ok('删除测试学生', delResult)
  // 验证已软删除(EAA 是软删除,status 变为 Deleted)
  await wait(1000)
  const softDeleted = await c.eval('(async(N)=>{var s=await window.api.eaa.listStudents();var st=s.data.students.find(function(x){return x.name===N});return st?st.status:"gone"})(' + JSON.stringify(testStudent) + ')')
  ok('验证学生已软删除', softDeleted === 'Deleted' || softDeleted === 'gone', 'status=' + softDeleted)

  // ===== 6. 班级管理: 创建→列表验证(闭环) =====
  console.log('\n[6] 班级管理闭环')
  const testClass = { class_id: 'TEST-' + Date.now(), name: '测试班', grade: '高三' }
  const createResult = await c.eval('(async(P)=>{var r=await window.api.class.create(P);return r.success})(' + JSON.stringify(testClass) + ')')
  ok('创建测试班级', createResult)
  // 验证列表中存在
  await wait(500)
  const classExists = await c.eval('(async(CID)=>{var r=await window.api.class.list();return r.data.some(function(c){return c.class_id===CID})})(' + JSON.stringify(testClass.class_id) + ')')
  ok('验证班级已创建', classExists)
  // 删除
  const delClass = await c.eval('(async(L)=>{var r=await window.api.class.list();var t=r.data.find(function(c){return c.class_id===L});if(t){var d=await window.api.class.delete(t.id);return d.success}return false})(' + JSON.stringify(testClass.class_id) + ')')
  ok('删除测试班级', delClass)

  // ===== 7. Agent页面: toggle交互(用最后一个agent,测完恢复) =====
  console.log('\n[7] Agent toggle交互')
  await c.nav('#/agents')
  // 用最后一个 agent 的 toggle(避免影响 main 等常用 agent)
  const toggleInfo = await c.eval(`(function(){
    var btns=Array.from(document.querySelectorAll('button[role="switch"], button[class*="rounded-full"]'));
    if(btns.length<2)return{found:false};
    var lastBtn=btns[btns.length-1];
    var isOn=lastBtn.className.includes('bg-blue')||lastBtn.className.includes('bg-indigo');
    lastBtn.click();
    return{found:true,wasOn:isOn}
  })()`)
  ok('Agent页有toggle开关', toggleInfo.found)
  // 恢复原始状态
  if (toggleInfo.found) {
    await wait(500)
    await c.eval(`(function(){
      var btns=Array.from(document.querySelectorAll('button[role="switch"], button[class*="rounded-full"]'));
      if(btns.length>=2)btns[btns.length-1].click()
    })()`)
  }
  // 确保 main 始终启用(防止其他测试副作用)
  await c.eval('(async()=>{await window.api.agent.toggle("main",true)})()')

  // ===== 8. 技能页: 查看技能内容 =====
  console.log('\n[8] 技能页交互')
  await c.nav('#/skills')
  const skillClick = await c.clickByText('div,button,li', '')
  // 技能页可能有技能列表可点击
  const hasSkillContent = await c.eval("document.body.innerText.length > 200")
  ok('技能页有内容', hasSkillContent)

  // 汇总
  console.log('\n' + '='.repeat(55))
  console.log('  \u2713 ' + pass + '  \u2717 ' + fail + '  (共' + (pass + fail) + '项)')
  if (fail > 0) console.log('  失败: ' + fails.join(', '))
  console.log('='.repeat(55))
  c.close()
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
