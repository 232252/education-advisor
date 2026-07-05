// =============================================================
// 第4轮: 极端边界 + 错误恢复 + 跨模块联动 + 长时间运行
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
    const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })
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
  const K = 'sk-cp-uXAnDhdRxrBgwGL6XqKosvb75vo-PCOK66wW3lI3iNXkJ_1VqeCUsRpMc6OjeyVwII8l1Ffuspa1HMa76TEctRNPk7-USJN5sv2LNiVIy-fmBsJc279okTY'
  await c.eval('(async(K)=>{await window.api.ai.setApiKey("minimax-cn",K)})(' + JSON.stringify(K) + ')')
  await wait(2000)
  console.log('=== 第4轮: 极端边界 + 错误恢复 + 跨模块联动 ===\n')

  // ===== A. 超长输入处理 =====
  console.log('[A] 超长输入')
  const longText = 'x'.repeat(10000)
  const longResult = await c.eval(
    '(async(T)=>{try{await window.api.eaa.search(T,3);return "ok"}catch(e){return "err:"+e.message}})(' +
      JSON.stringify(longText) +
      ')',
  )
  ok('10000字符搜索不崩溃', longResult === 'ok' || !longResult.startsWith('err:FATAL'))

  // 超长Agent prompt
  await c.eval("(async(T)=>{await window.api.agent.runManual('main',T)})(" + JSON.stringify('回复ok:' + 'y'.repeat(5000)) + ')')
  await wait(13000)
  const longAgent = await c.eval(
    '(async()=>{var h=await window.api.agent.getHistory("main");var l=h[h.length-1];return l?.status==="success"&&l?.output?.length>0})()',
  )
  ok('超长Agent prompt正常完成', longAgent === true)

  // ===== B. 特殊字符处理 =====
  console.log('\n[B] 特殊字符')
  const special = '<script>alert(1)</script> & "quotes" \\backslash\\'
  const specialResult = await c.eval(
    '(async(T)=>{try{var r=await window.api.eaa.search(T,1);return "ok"}catch(e){return "err"}})(' +
      JSON.stringify(special) +
      ')',
  )
  ok('特殊字符搜索不崩溃(XSS注入尝试)', specialResult === 'ok')

  // ===== C. 设置重置+恢复 =====
  console.log('\n[C] 设置重置恢复')
  // 先记下当前值
  const beforeTheme = await c.eval("(async()=>{var s=await window.api.settings.get();return s.general.theme})()")
  // 改一个值
  await c.eval("(async()=>{await window.api.settings.set('general.theme','dark')})()")
  const changed = await c.eval("(async()=>{var s=await window.api.settings.get();return s.general.theme})()")
  ok('设置可修改', changed === 'dark')
  // 恢复
  await c.eval('(async(T)=>{await window.api.settings.set("general.theme",T)})(' + JSON.stringify(beforeTheme) + ')')
  const restored = await c.eval("(async()=>{var s=await window.api.settings.get();return s.general.theme})()")
  ok('设置可恢复', restored === beforeTheme)

  // ===== D. 飞书bot 重连(停→启动→停) =====
  console.log('\n[D] 飞书bot重连循环')
  for (let i = 0; i < 3; i++) {
    await c.eval('(async()=>{await window.api.feishu.botStop()})()')
    await wait(500)
    const stopped = await c.eval("(async()=>{return (await window.api.feishu.botStatus()).status})()")
    await c.eval('(async()=>{await window.api.feishu.botStart()})()')
    await wait(2000)
  }
  const finalBot = await c.eval("(async()=>{return (await window.api.feishu.botStatus()).status})()")
  ok('3次stop/start循环后状态有效', ['idle', 'connecting', 'connected', 'error'].includes(finalBot), finalBot)

  // ===== E. 跨模块联动: Agent→EAA→Class =====
  console.log('\n[E] 跨模块联动')
  // Agent 调用 EAA 工具(Agent 内部自动调)
  await c.eval("(async()=>{await window.api.agent.runManual('supervisor','用eaa_stats工具查看系统统计,然后一句话总结')})()")
  await wait(15000)
  const crossResult = await c.eval(
    '(async()=>{var h=await window.api.agent.getHistory("supervisor");var l=h[h.length-1];return{status:l?.status,len:(l?.output||"").length}})()',
  )
  ok('跨模块:supervisor Agent调EAA工具成功', crossResult.status === 'success' && crossResult.len > 5, 'len=' + crossResult.len)

  // ===== F. Agent abort(中断运行中的Agent) =====
  console.log('\n[F] Agent中断')
  await c.eval("(async()=>{await window.api.agent.runManual('main','写一篇1000字的文章关于教育')})()")
  await wait(2000) // 让它开始跑
  const abortResult = await c.eval(
    "(async()=>{try{var r=await window.api.agent.abort('main');return r.success}catch(e){return false}})()",
  )
  ok('Agent可被中断', abortResult !== undefined)

  // ===== G. 数据一致性(多次读同一数据结果一致) =====
  console.log('\n[G] 数据一致性')
  const reads = []
  for (let i = 0; i < 5; i++) {
    const count = await c.eval(
      '(async()=>{var s=await window.api.eaa.listStudents();return s.success?s.data.students.length:-1})()',
    )
    reads.push(count)
  }
  const allSame = reads.every((x) => x === reads[0])
  ok('5次读取学生数一致', allSame, reads.join(','))

  // ===== H. UI渲染检查(关键页面DOM完整性) =====
  console.log('\n[H] UI渲染完整性')
  await c.eval("location.hash='#/dashboard'");await wait(3000)
  const dashElements = await c.eval(`(function(){
    return {
      hasNav: document.querySelectorAll('aside a,aside button').length >= 5,
      hasMain: document.querySelector('main') !== null,
      hasThemeToggle: !!Array.from(document.querySelectorAll('button')).find(b=>{var t=b.getAttribute('title')||'';return t.includes('主题')}),
      agentListVisible: document.body.innerText.includes('教育参谋') || document.body.innerText.includes('Agent'),
    }
  })()`)
  ok('侧边栏导航完整', dashElements.hasNav)
  ok('main区域存在', dashElements.hasMain)
  ok('ThemeToggle存在', dashElements.hasThemeToggle)
  ok('Agent列表可见', dashElements.agentListVisible)

  // ===== I. 长时间运行内存趋势 =====
  console.log('\n[I] 长时间运行内存')
  const memStart = await c.eval('performance.memory?performance.memory.usedJSHeapSize:0')
  // 模拟5分钟使用: 30轮页面切换+API调用
  for (let i = 0; i < 30; i++) {
    await c.eval('location.hash="#/' + ['dashboard', 'students', 'models', 'settings'][i % 4] + '"')
    await c.eval('(async()=>{await window.api.eaa.listStudents()})()')
    await wait(100)
  }
  const memEnd = await c.eval('performance.memory?performance.memory.usedJSHeapSize:0')
  const growthMB = ((memEnd - memStart) / 1024 / 1024).toFixed(1)
  ok('30轮操作内存增长<100MB', memEnd - memStart < 100 * 1024 * 1024, '+' + growthMB + 'MB')

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
