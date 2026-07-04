// =============================================================
// 多角度压力测试 — 边界/并发/错误处理/压力/连续操作
// =============================================================
const http = require('http')
const WebSocket = require('ws')

function getT() {
  return new Promise((res, rej) => {
    const r = http.get('http://127.0.0.1:9222/json', (s) => {
      let d = ''
      s.on('data', (c) => (d += c))
      s.on('end', () => {
        try {
          res(JSON.parse(d))
        } catch (e) {
          rej(e)
        }
      })
    })
    r.on('error', rej)
    r.setTimeout(5000, () => {
      r.destroy()
      rej(new Error('t'))
    })
  })
}
class C {
  async connect() {
    const t = await getT()
    const p = t.find((x) => x.type === 'page')
    this.ws = new WebSocket(p.webSocketDebuggerUrl)
    await new Promise((r, rej) => {
      this.ws.on('open', r)
      this.ws.on('error', rej)
    })
    this.id = 0
    this.pending = new Map()
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
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          rej(new Error('t:' + m))
        }
      }, 30000)
    })
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', {
      expression: e,
      awaitPromise: true,
      returnByValue: true,
    })
    return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description } : r.result.value
  }
  close() {
    if (this.ws) this.ws.close()
  }
}
let pass = 0,
  fail = 0
const fails = []
function ok(n, c, d) {
  if (c) {
    console.log('  \u2713 ' + n)
    pass++
  } else {
    console.log('  \u2717 ' + n + (d ? ' \u2014 ' + String(d).slice(0, 120) : ''))
    fail++
    fails.push(n)
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const c = new C()
  await c.connect()
  console.log('=== 多角度压力测试 ===\n')

  // ===== A. 快速连续页面切换(不崩溃) =====
  console.log('[A] 快速连续页面切换(20次随机跳转)')
  const pages = ['#/dashboard', '#/chat', '#/students', '#/models', '#/settings', '#/agents']
  let navOk = true
  for (let i = 0; i < 20; i++) {
    const h = pages[i % pages.length]
    await c.eval("location.hash='" + h + "'")
    await wait(200)
    const len = await c.eval('document.body.innerHTML.length')
    if (len < 100) {
      navOk = false
      break
    }
  }
  ok('20次快速切换不崩溃', navOk)

  // ===== B. 并发 API 调用(不冲突) =====
  console.log('\n[B] 并发 API 调用')
  const concurrentResults = await c.eval(`(async()=>{
    var tasks = [
      window.api.eaa.listStudents(),
      window.api.eaa.ranking(5),
      window.api.eaa.stats(),
      window.api.agent.list(),
      window.api.cron.list(),
      window.api.class.list(),
      window.api.skill.list(),
      window.api.settings.get(),
    ];
    var results = await Promise.allSettled(tasks);
    return results.map(function(r){return r.status==='fulfilled'?'ok':'reject:'+r.reason});
  })()`)
  let allOk = true
  concurrentResults.forEach((r, i) => {
    if (r !== 'ok') allOk = false
  })
  ok('8个API并发调用全部成功', allOk, JSON.stringify(concurrentResults))

  // ===== C. 边界: 空数据/不存在的查询 =====
  console.log('\n[C] 边界情况')
  const emptyScore = await c.eval(
    `(async()=>{try{var r=await window.api.eaa.score("不存在的学生名_xyz");return r.success?'success':'fail'}catch(e){return 'throw:'+e.message}})()`,
  )
  ok('查不存在的学生不崩溃', emptyScore === 'success' || emptyScore === 'fail')

  const emptySearch = await c.eval(
    `(async()=>{try{var r=await window.api.eaa.search("zzzznotexist",5);return r.success?'success':'fail'}catch(e){return 'throw'}})()`,
  )
  ok('空搜索不崩溃', emptySearch === 'success' || emptySearch === 'fail')

  // ===== D. 设置读写一致性 =====
  console.log('\n[D] 设置读写一致性')
  await c.eval("(async()=>{await window.api.settings.set('general.logLevel','debug')})()")
  const readBack = await c.eval(
    "(async()=>{var s=await window.api.settings.get();return s.general.logLevel})()",
  )
  ok('设置写入后读回一致', readBack === 'debug', readBack)

  // ===== E. keystore 读写一致性(用内置provider,非内置的不出现在listProviders) =====
  console.log('\n[E] keystore 读写一致性')
  await c.eval("(async()=>{await window.api.ai.setApiKey('deepseek','test-value-123')})()")
  await wait(1000)
  const keyBack = await c.eval(
    "(async()=>{var p=await window.api.ai.listProviders();var t=p.find(x=>x.id==='deepseek');return t?t.hasApiKey:false})()",
  )
  ok('keystore写入后可读到', keyBack === true)
  // 清理测试provider
  await c.eval("(async()=>{await window.api.ai.deleteApiKey('deepseek')})()")

  // ===== F. 飞书状态切换(start/stop) =====
  console.log('\n[F] 飞书状态切换')
  const botBefore = await c.eval("(async()=>await window.api.feishu.botStatus())()")
  ok('飞书初始状态有效', ['idle', 'connecting', 'connected', 'error'].includes(botBefore.status))
  await c.eval('(async()=>await window.api.feishu.botStop())()')
  await wait(1000)
  const botAfterStop = await c.eval("(async()=>await window.api.feishu.botStatus())()")
  ok('飞书停止后状态为idle', botAfterStop.status === 'idle')

  // ===== G. Agent连续运行(2次) =====
  console.log('\n[G] Agent连续运行')
  // 第一次
  await c.eval("(async()=>{await window.api.agent.runManual('main','回复:1')})()")
  await wait(12000)
  const h1 = await c.eval(
    '(async()=>{var h=await window.api.agent.getHistory("main");var l=h[h.length-1];return{status:l?.status,len:(l?.output||"").length}})()',
  )
  ok('Agent第1次运行', h1.status === 'success' && h1.len > 0, 'len=' + h1.len)
  // 第二次
  await c.eval("(async()=>{await window.api.agent.runManual('main','回复:2')})()")
  await wait(12000)
  const h2 = await c.eval(
    '(async()=>{var h=await window.api.agent.getHistory("main");var l=h[h.length-1];return{status:l?.status,len:(l?.output||"").length}})()',
  )
  ok('Agent第2次运行', h2.status === 'success' && h2.len > 0, 'len=' + h2.len)

  // ===== H. 本地模型API健壮性 =====
  console.log('\n[H] 本地模型API健壮性')
  const ollamaMethods = await c.eval("Object.keys(window.api.ollama).length")
  ok('ollama API 方法数正确', ollamaMethods === 7)
  // detect不崩溃
  const det = await c.eval("(async()=>{try{await window.api.ollama.detect();return true}catch(e){return false}})()")
  ok('ollama detect 不崩溃', det)
  // listModels不崩溃(即使没运行)
  const listM = await c.eval("(async()=>{try{var m=await window.api.ollama.listModels();return Array.isArray(m)}catch(e){return false}})()")
  ok('ollama listModels 返回数组', listM)
  // onPullProgress订阅+取消
  const sub = await c.eval("(function(){var u=window.api.ollama.onPullProgress(function(){});var ok=typeof u==='function';if(ok)u();return ok})()")
  ok('ollama onPullProgress 订阅/取消', sub)

  // ===== I. 主题多次切换 =====
  console.log('\n[I] 主题多次切换(5次)')
  let themeOk = true
  for (let i = 0; i < 5; i++) {
    const b = await c.eval(
      "document.documentElement.classList.contains('dark')?'dark':'light'",
    )
    await c.eval(
      "(function(){var b=Array.from(document.querySelectorAll('button')).find(function(b){var t=b.getAttribute('title')||'';return t.indexOf('主题')>=0||t.indexOf('theme')>=0});if(b)b.click()})()",
    )
    await wait(300)
    const a = await c.eval(
      "document.documentElement.classList.contains('dark')?'dark':'light'",
    )
    if (b === a) themeOk = false
  }
  ok('5次主题切换每次都生效', themeOk)

  // ===== J. 内存泄漏检查(操作前后对比) =====
  console.log('\n[J] 内存检查')
  const mem1 = await c.eval(
    "performance.memory?performance.memory.usedJSHeapSize:0",
  )
  // 做一堆操作
  for (let i = 0; i < 10; i++) {
    await c.eval("(async()=>{await window.api.eaa.listStudents()})()")
    await c.eval("location.hash='#/dashboard'")
    await wait(100)
    await c.eval("location.hash='#/models'")
    await wait(100)
  }
  const mem2 = await c.eval(
    "performance.memory?performance.memory.usedJSHeapSize:0",
  )
  const memGrowthMB = ((mem2 - mem1) / 1024 / 1024).toFixed(1)
  ok('10轮操作内存增长<50MB', mem2 - mem1 < 50 * 1024 * 1024, '+' + memGrowthMB + 'MB')

  // ===== 汇总 =====
  console.log('\n' + '='.repeat(50))
  console.log('\u2713 ' + pass + '  \u2717 ' + fail)
  if (fail > 0) console.log('失败: ' + fails.join(', '))
  console.log('='.repeat(50))
  c.close()
  if (fail > 0) process.exit(1)
}
main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
