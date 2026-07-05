// =============================================================
// 终极深度测试 — 整合所有角度,一次跑完
// 1. 全页面+UI完整性  2. EAA全命令  3. Agent多场景
// 4. 飞书全链路  5. 本地模型API  6. 设置+keystore
// 7. 边界/并发/压力  8. 跨模块联动  9. 稳定性
// =============================================================
const http = require('http')
const WebSocket = require('ws')

function getT() {
  return new Promise((res, rej) => {
    const r = http.get('http://127.0.0.1:9222/json', (s) => {
      let d = ''
      s.on('data', (c) => (d += c))
      s.on('end', () => {
        try { res(JSON.parse(d)) } catch (e) { rej(e) }
      })
    })
    r.on('error', rej)
    r.setTimeout(5000, () => { r.destroy(); rej(new Error('t')) })
  })
}
class C {
  async connect() {
    const t = await getT()
    const p = t.find((x) => x.type === 'page')
    this.ws = new WebSocket(p.webSocketDebuggerUrl)
    await new Promise((r, rej) => { this.ws.on('open', r); this.ws.on('error', rej) })
    this.id = 0; this.pending = new Map()
    this.ws.on('message', (m) => {
      const o = JSON.parse(m)
      if (o.id && this.pending.has(o.id)) {
        const { resolve, reject } = this.pending.get(o.id)
        this.pending.delete(o.id)
        o.error ? reject(new Error(JSON.stringify(o.error))) : resolve(o.result)
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
  close() { if (this.ws) this.ws.close() }
}
let pass = 0, fail = 0
const fails = []
function ok(n, c, d) {
  if (c) { console.log('  \u2713 ' + n); pass++ }
  else { console.log('  \u2717 ' + n + (d ? ' \u2014 ' + String(d).slice(0, 100) : '')); fail++; fails.push(n) }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// 轮询等待条件满足(解决异步时序不稳定)
async function pollFor(fn, { timeout = 30000, interval = 2000 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await fn()
    if (result) return result
    await wait(interval)
  }
  return null
}

async function main() {
  const c = new C(); await c.connect()
  console.log('=== 终极深度测试 (9大模块) ===\n')

  // ===== 1. 全页面 + UI完整性 =====
  console.log('[1/9] 全页面遍历 + UI完整性')
  const PAGES = [['#/dashboard','仪表盘'],['#/chat','对话'],['#/students','学生'],['#/classes','班级'],['#/agents','Agent'],['#/models','模型'],['#/skills','技能'],['#/scheduler','任务'],['#/privacy','隐私'],['#/settings','设置']]
  for (const [h, n] of PAGES) {
    await c.nav(h)
    const len = await c.eval('document.body.innerHTML.length')
    ok(n + '页加载', len > 500, 'len=' + len)
  }
  // UI关键元素
  await c.nav('#/dashboard')
  const ui = await c.eval(`(function(){return{
    nav: document.querySelectorAll('aside a,aside button').length>=5,
    themeBtn: !!Array.from(document.querySelectorAll('button')).find(b=>{var t=b.getAttribute('title')||'';return t.includes('主题')}),
    localModels: document.body.innerText.includes('本地模型'),
  }})()`)
  ok('侧边栏导航完整', ui.nav)
  ok('ThemeToggle存在', ui.themeBtn)

  // ===== 2. EAA全命令 =====
  console.log('\n[2/9] EAA全命令覆盖')
  const eaaCmds = {
    info: '(async()=>{var r=await window.api.eaa.info();return r.success})()',
    validate: '(async()=>{var r=await window.api.eaa.validate();return r.success})()',
    ranking: '(async()=>{var r=await window.api.eaa.ranking(5);return r.success})()',
    stats: '(async()=>{var r=await window.api.eaa.stats();return r.success})()',
    listStudents: '(async()=>{var r=await window.api.eaa.listStudents();return r.success})()',
    codes: '(async()=>{var r=await window.api.eaa.codes();return r.success})()',
    doctor: '(async()=>{var r=await window.api.eaa.doctor();return r.success})()',
    summary: '(async()=>{var r=await window.api.eaa.summary();return r.success})()',
    dashboard: '(async()=>{var r=await window.api.eaa.dashboard();return r.success})()',
  }
  for (const [name, expr] of Object.entries(eaaCmds)) {
    const r = await c.eval(expr)
    ok('eaa.' + name, r === true)
  }

  // ===== 3. Agent多场景 =====
  console.log('\n[3/9] Agent多场景')
  // 3a. main Agent (轮询等完成)
  await c.eval("(async()=>{await window.api.agent.runManual('main','回复:测试')})()")
  const agentDone = await pollFor(async () => {
    return await c.eval('(async()=>{var h=await window.api.agent.getHistory("main");var l=h[h.length-1];return (l&&l.status==="success"&&l.output&&l.output.length>0)?l.output.length:null})()')
  }, { timeout: 40000, interval: 3000 })
  ok('main Agent对话', agentDone !== null && agentDone > 0, 'len=' + agentDone)
  // 3b. supervisor Agent(跨模块调EAA工具,轮询等完成)
  await c.eval("(async()=>{await window.api.agent.runManual('supervisor','一句话总结系统状态')})()")
  const supDone = await pollFor(async () => {
    return await c.eval('(async()=>{var h=await window.api.agent.getHistory("supervisor");var l=h[h.length-1];return (l&&l.status==="success"&&l.output&&l.output.length>5)?l.output.length:null})()')
  }, { timeout: 50000, interval: 3000 })
  ok('supervisor Agent(调EAA工具)', supDone !== null && supDone > 5, 'len=' + supDone)
  // 3c. abort
  await c.eval("(async()=>{await window.api.agent.runManual('main','写5000字')})()")
  await wait(1500)
  const abortOk = await c.eval("(async()=>{try{await window.api.agent.abort('main');return true}catch(e){return false}})()")
  ok('Agent可中断', abortOk)
  await wait(3000)

  // ===== 4. 飞书全链路 =====
  console.log('\n[4/9] 飞书全链路')
  const botSt = await c.eval("(async()=>{var s=await window.api.feishu.botStatus();return s.status})()")
  ok('飞书bot状态有效', ['idle', 'connecting', 'connected', 'error'].includes(botSt))
  // start→stop (connecting 也算启动成功,WSClient 握手需要时间)
  const startR = await c.eval("(async()=>{var r=await window.api.feishu.botStart();return r.success||r.status?.status})()")
  ok('飞书bot可启动', startR === true || startR === 'connecting' || startR === 'connected', startR)
  // 等 bot 真正连上再 stop(避免 connecting 中 stop 导致时序问题)
  const connectedOk = await pollFor(async () => {
    const st = await c.eval("(async()=>{var s=await window.api.feishu.botStatus();return s.status})()")
    return st === 'connected' ? true : null
  }, { timeout: 10000, interval: 2000 })
  console.log('    bot连接状态:', connectedOk ? 'connected' : '未连上')
  const stopRet = await c.eval("(async()=>{var r=await window.api.feishu.botStop();return JSON.stringify(r)})()")
  console.log('    botStop返回:', stopRet)
  const stopDone = await pollFor(async () => {
    const st = await c.eval("(async()=>{var s=await window.api.feishu.botStatus();return s.status})()")
    console.log('    poll状态:', st)
    return st === 'idle' ? true : null
  }, { timeout: 15000, interval: 2000 })
  ok('飞书bot可停止', stopDone !== null)
  // test连接
  const ft = await c.eval("(async()=>{var s=await window.api.settings.get();var r=await window.api.feishu.test(s.feishu.appId);return r.success})()")
  ok('飞书test连接成功', ft)

  // ===== 5. 本地模型API =====
  console.log('\n[5/9] 本地模型(Ollama) API')
  const oMethods = await c.eval('Object.keys(window.api.ollama).length')
  ok('ollama 7方法', oMethods === 7)
  const oDet = await c.eval('(async()=>{var d=await window.api.ollama.detect();return typeof d==="object"&&"available" in d})()')
  ok('detect返回对象', oDet)
  const oList = await c.eval('(async()=>{var m=await window.api.ollama.listModels();return Array.isArray(m)})()')
  ok('listModels返回数组', oList)
  const oSub = await c.eval('(function(){var u=window.api.ollama.onPullProgress(function(){});var ok=typeof u==="function";u();return ok})()')
  ok('onPullProgress订阅', oSub)
  // 模型页UI
  await c.nav('#/models')
  const mText = await c.eval('document.body.innerText')
  ok('模型页有本地模型区', mText.includes('本地模型'))
  ok('模型页有Qwen3.6', mText.includes('Qwen3.6'))
  ok('模型页有硬件分级', mText.includes('CPU'))

  // ===== 6. 设置 + keystore =====
  console.log('\n[6/9] 设置 + keystore')
  // 设置读写
  await c.eval("(async()=>{await window.api.settings.set('chat.maxTokens',4096)})()")
  const sBack = await c.eval("(async()=>{var s=await window.api.settings.get();return s.chat.maxTokens})()")
  ok('设置读写一致', sBack === 4096)
  // keystore(deepseek)
  await c.eval("(async()=>{await window.api.ai.setApiKey('deepseek','sk-test')})()")
  await wait(1000)
  const kBack = await c.eval("(async()=>{var p=await window.api.ai.listProviders();var d=p.find(x=>x.id==='deepseek');return d?d.hasApiKey:false})()")
  ok('keystore加密读写', kBack)
  await c.eval("(async()=>{await window.api.ai.deleteApiKey('deepseek')})()")
  // 主题
  const tb = await c.eval("document.documentElement.classList.contains('dark')?'dark':'light'")
  await c.eval("(function(){var b=Array.from(document.querySelectorAll('button')).find(function(b){var t=b.getAttribute('title')||'';return t.indexOf('主题')>=0});if(b)b.click()})()")
  await wait(1000)
  const ta = await c.eval("document.documentElement.classList.contains('dark')?'dark':'light'")
  ok('主题切换生效', tb !== ta, tb + '→' + ta)

  // ===== 7. 边界/并发/压力 =====
  console.log('\n[7/9] 边界/并发/压力')
  // 并发8个API
  const conc = await c.eval(`(async()=>{
    var t=[window.api.eaa.listStudents(),window.api.eaa.ranking(5),window.api.eaa.stats(),
      window.api.agent.list(),window.api.cron.list(),window.api.class.list(),
      window.api.skill.list(),window.api.settings.get()];
    var r=await Promise.allSettled(t);return r.every(x=>x.status==='fulfilled')
  })()`)
  ok('8API并发成功', conc)
  // 超长输入
  const longOk = await c.eval('(async(T)=>{try{await window.api.eaa.search(T,1);return true}catch(e){return false}})(' + JSON.stringify('x'.repeat(5000)) + ')')
  ok('5000字符搜索不崩溃', longOk)
  // 20次快速页面切换
  let fastNav = true
  for (let i = 0; i < 20; i++) {
    await c.eval("location.hash='#/" + ['dashboard', 'chat', 'students', 'models'][i % 4] + "'")
    await wait(150)
    const l = await c.eval('document.body.innerHTML.length')
    if (l < 100) { fastNav = false; break }
  }
  ok('20次快速切换不崩溃', fastNav)

  // ===== 8. 数据一致性 =====
  console.log('\n[8/9] 数据一致性')
  const counts = []
  for (let i = 0; i < 5; i++) {
    const n = await c.eval('(async()=>{var s=await window.api.eaa.listStudents();return s.data.students.length})()')
    counts.push(n)
  }
  ok('5次读取学生数一致', counts.every((x) => x === counts[0]), counts.join(','))

  // ===== 9. 内存稳定性 =====
  console.log('\n[9/9] 内存稳定性')
  const m1 = await c.eval('performance.memory?performance.memory.usedJSHeapSize:0')
  for (let i = 0; i < 20; i++) {
    await c.nav('#/' + ['dashboard', 'students', 'models'][i % 3])
    await c.eval('(async()=>{await window.api.eaa.listStudents()})()')
  }
  const m2 = await c.eval('performance.memory?performance.memory.usedJSHeapSize:0')
  const growth = ((m2 - m1) / 1024 / 1024).toFixed(1)
  ok('20轮操作内存增长<80MB', m2 - m1 < 80 * 1024 * 1024, '+' + growth + 'MB')

  // ===== 汇总 =====
  console.log('\n' + '='.repeat(55))
  console.log('  \u2713 ' + pass + '  \u2717 ' + fail + '  (共' + (pass + fail) + '项)')
  if (fail > 0) console.log('  失败: ' + fails.join(', '))
  console.log('='.repeat(55))
  c.close()
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
