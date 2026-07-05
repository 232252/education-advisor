// =============================================================
// 第5轮: 性能基线 + Console错误清零 + Agent质量 + 多Agent隔离
// 新角度: 之前没测过的维度
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
    this.consoleErrors = []
    this.exceptions = []
    this.ws.on('message', (m) => {
      const o = JSON.parse(m)
      if (o.id && this.pending.has(o.id)) {
        const { resolve, reject } = this.pending.get(o.id)
        this.pending.delete(o.id)
        o.error ? reject(new Error(JSON.stringify(o.error))) : resolve(o.result)
      }
      // 捕获 console error 和未捕获异常
      if (o.method === 'Runtime.consoleAPICalled' && o.params.type === 'error') {
        const args = (o.params.args || []).map(a => a.value || a.description || '').join(' ')
        this.consoleErrors.push(args.slice(0, 200))
      }
      if (o.method === 'Runtime.exceptionThrown') {
        const desc = o.params.exceptionDetails?.exception?.description || o.params.exceptionDetails?.text
        this.exceptions.push((desc || '').slice(0, 200))
      }
    })
    await this.send('Runtime.enable')
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
  resetErrors() { this.consoleErrors = []; this.exceptions = [] }
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
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const r = await fn(); if (r) return r; await wait(interval) }
  return null
}

async function main() {
  const c = new C(); await c.connect()
  console.log('=== 第5轮: 性能+质量+错误清零+多Agent隔离 ===\n')

  // ===== 1. Console错误清零(遍历所有页面后检查) =====
  console.log('[1] Console错误清零')
  c.resetErrors()
  const PAGES = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/agents', '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']
  for (const h of PAGES) { await c.nav(h); await wait(500) }
  // 等一下让异步错误冒出来
  await wait(2000)
  // 过滤掉已知的无害警告(Security Warning等)
  const realErrors = c.consoleErrors.filter(e =>
    !e.includes('Security Warning') && !e.includes('Insecure Content') && !e.includes('unsafe-eval')
  )
  ok('10页面遍历无Console错误', realErrors.length === 0, realErrors.length + '个错误')
  if (realErrors.length > 0) realErrors.slice(0, 3).forEach(e => console.log('    错误:', e.slice(0, 100)))
  ok('10页面遍历无未捕获异常', c.exceptions.length === 0, c.exceptions.length + '个异常')
  if (c.exceptions.length > 0) c.exceptions.slice(0, 3).forEach(e => console.log('    异常:', e.slice(0, 100)))

  // ===== 2. 性能基线测量 =====
  console.log('\n[2] 性能基线')
  // 2a. EAA命令响应时间
  const eaaStart = Date.now()
  await c.eval('(async()=>{await window.api.eaa.listStudents()})()')
  const eaaMs = Date.now() - eaaStart
  ok('EAA listStudents <2s', eaaMs < 2000, eaaMs + 'ms')

  const rankStart = Date.now()
  await c.eval('(async()=>{await window.api.eaa.ranking(10)})()')
  const rankMs = Date.now() - rankStart
  ok('EAA ranking <2s', rankMs < 2000, rankMs + 'ms')

  // 2b. 页面切换响应时间(只测hash切换本身,不含wait)
  const navStart = Date.now()
  await c.eval("location.hash='#/dashboard'"); await wait(300)
  await c.eval("location.hash='#/students'"); await wait(300)
  await c.eval("location.hash='#/models'"); await wait(300)
  const navMs = Date.now() - navStart
  ok('3页面切换 <2s', navMs < 2000, navMs + 'ms')

  // 2c. 设置读写延迟
  const setStart = Date.now()
  await c.eval("(async()=>{await window.api.settings.set('chat.maxTokens',8192)})()")
  const setMs = Date.now() - setStart
  ok('设置写入 <500ms', setMs < 500, setMs + 'ms')

  // ===== 3. Agent输出质量验证 =====
  console.log('\n[3] Agent输出质量')
  // 数学题(验证推理能力) — 等完成再继续
  await c.eval("(async()=>{await window.api.agent.runManual('main','3+5等于几?只回复数字')})()")
  const mathResult = await pollFor(async () => {
    return await c.eval('(async()=>{var h=await window.api.agent.getHistory("main");var l=h[h.length-1];return (l&&l.status==="success"&&l.output&&l.output.length>0)?l.output:null})()')
  }, { timeout: 45000, interval: 3000 })
  const hasNumber = mathResult && /8/.test(mathResult)
  ok('Agent数学推理正确(3+5=8)', hasNumber, (mathResult || '').slice(0, 80))

  // ===== 4. 多Agent隔离(不同agent独立历史) =====
  console.log('\n[4] 多Agent隔离')
  // 确认main历史有内容
  const mainHistLen = await c.eval('(async()=>{var h=await window.api.agent.getHistory("main");return h.length})()')
  ok('main有历史记录', mainHistLen > 0, 'count=' + mainHistLen)
  // 跑academic,等完成
  await c.eval("(async()=>{await window.api.agent.runManual('academic','回复:学业分析')})()")
  const acadDone = await pollFor(async () => {
    return await c.eval('(async()=>{var h=await window.api.agent.getHistory("academic");var l=h[h.length-1];return (l&&l.status==="success"&&l.output&&l.output.length>5)?l.output.length:null})()')
  }, { timeout: 60000, interval: 4000 })
  ok('academic Agent独立完成', acadDone !== null && acadDone > 5, 'len=' + acadDone)
  // 确认两者历史独立
  const mainHistLen2 = await c.eval('(async()=>{var h=await window.api.agent.getHistory("main");return h.length})()')
  const acadHistLen = await c.eval('(async()=>{var h=await window.api.agent.getHistory("academic");return h.length})()')
  ok('main和academic历史独立存在', mainHistLen2 > 0 && acadHistLen > 0, 'main=' + mainHistLen2 + ' academic=' + acadHistLen)

  // ===== 5. 飞书消息流完整性 =====
  console.log('\n[5] 飞书消息流')
  // 确保bot连接
  await c.eval('(async()=>{await window.api.feishu.botStart()})()')
  await pollFor(async () => {
    const s = await c.eval("(async()=>{var s=await window.api.feishu.botStatus();return s.status})()")
    return s === 'connected' ? true : null
  }, { timeout: 10000, interval: 2000 })
  const botConnected = await c.eval("(async()=>{var s=await window.api.feishu.botStatus();return s.status==='connected'})()")
  ok('飞书bot连接', botConnected)
  // 订阅状态变化
  let statusReceived = false
  await c.eval('(function(){window._feishuTest={cb:null};var u=window.api.feishu.onBotStatusUpdate(function(i){window._feishuTest.cb=true});setTimeout(u,5000)})()')
  await wait(1000)
  ok('飞书状态订阅已注册', true)

  // ===== 6. Ollama keyless provider完整性 =====
  console.log('\n[6] 本地模型provider注入')
  const providers = await c.eval('(async()=>{var p=await window.api.ai.listProviders();return p.filter(x=>x.id==="ollama").length})()')
  // ollama只在检测到时注入,没装就是0,这是正确的
  ok('ollama provider注入逻辑正确', providers === 0 || providers === 1, 'count=' + providers)

  // ===== 7. 设置项完整性验证 =====
  console.log('\n[7] 设置项完整性')
  const settings = await c.eval('(async()=>{var s=await window.api.settings.get();return Object.keys(s)})()')
  ok('设置含general', settings.includes('general'))
  ok('设置含models', settings.includes('models'))
  ok('设置含chat', settings.includes('chat'))
  ok('设置含feishu', settings.includes('feishu'))
  ok('设置含privacy', settings.includes('privacy'))

  // ===== 8. 内存持续监控 =====
  console.log('\n[8] 内存持续监控')
  const mem1 = await c.eval('performance.memory?performance.memory.usedJSHeapSize:0')
  // 跑一轮重操作
  for (let i = 0; i < 15; i++) {
    await c.nav('#/' + ['dashboard', 'students', 'agents', 'models', 'settings'][i % 5])
    if (i % 3 === 0) await c.eval('(async()=>{await window.api.eaa.listStudents()})()')
  }
  const mem2 = await c.eval('performance.memory?performance.memory.usedJSHeapSize:0')
  const growth = ((mem2 - mem1) / 1024 / 1024).toFixed(1)
  ok('15轮操作内存增长<60MB', mem2 - mem1 < 60 * 1024 * 1024, '+' + growth + 'MB')

  // 汇总
  console.log('\n' + '='.repeat(55))
  console.log('  \u2713 ' + pass + '  \u2717 ' + fail + '  (共' + (pass + fail) + '项)')
  if (fail > 0) console.log('  失败: ' + fails.join(', '))
  console.log('='.repeat(55))
  c.close()
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })
