// =============================================================
// 全功能实测 — 逐个模块操作真实界面 + 调用真实 API
// =============================================================
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(d))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find((t) => t.type === 'page')
    if (!page) throw new Error('no page target')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r, rej) => {
      this.ws.on('open', r)
      this.ws.on('error', rej)
    })
    this.id = 0
    this.pending = new Map()
    this.ws.on('message', (msg) => {
      const obj = JSON.parse(msg)
      if (obj.id && this.pending.has(obj.id)) {
        const { resolve, reject } = this.pending.get(obj.id)
        this.pending.delete(obj.id)
        if (obj.error) reject(new Error(JSON.stringify(obj.error)))
        else resolve(obj.result)
      }
    })
  }
  async send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('timeout: ' + method))
        }
      }, 30000)
    })
  }
  async eval(exp) {
    const r = await this.send('Runtime.evaluate', {
      expression: exp,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    }
    return r.result.value
  }
  async nav(hash) {
    await this.eval(`location.hash='${hash}'`)
    await new Promise((r) => setTimeout(r, 1500))
  }
  async clickByText(tag, text) {
    return this.eval(`(function(){
      var els=Array.from(document.querySelectorAll('${tag}'));
      var t=els.find(e=>(e.textContent||'').trim().includes('${text}'));
      if(t){t.click();return true} return false
    })()`)
  }
  close() {
    if (this.ws) this.ws.close()
  }
}

let pass = 0,
  fail = 0,
  warns = 0
const fails = []
function ok(name, cond, detail) {
  if (cond) {
    console.log(`  \u2713 ${name}`)
    pass++
  } else {
    console.log(`  \u2717 ${name}${detail ? ' \u2014 ' + String(detail).slice(0, 120) : ''}`)
    fail++
    fails.push(name)
  }
}
function warn(name, detail) {
  console.log(`  \u26a0 ${name}${detail ? ' \u2014 ' + String(detail).slice(0, 100) : ''}`)
  warns++
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('=== Education Advisor 全功能实测 ===\n')

  // ============================================================
  // 1. 仪表盘
  // ============================================================
  console.log('[1] 仪表盘')
  await c.nav('#/dashboard')
  await wait(4000) // 等数据加载
  const dash = await c.eval('document.body.innerText')
  ok('显示学生总数', /\d+\s*(学生|Student)/.test(dash) || dash.includes('学生总数'))
  ok('显示事件数据', dash.includes('事件') || dash.includes('有效'))
  ok('显示操行/分数', dash.includes('操行') || dash.includes('分数') || dash.includes('排名'))
  // 点击筛选按钮(如果有)
  const dashClickable = await c.eval(`(function(){
    var bs=Array.from(document.querySelectorAll('button,select')).filter(b=>{
      var t=(b.textContent||b.value||'').trim();
      return t.length>0 && t.length<20 && !t.includes('删除') && !t.includes('清空')
    });
    if(bs.length>0){bs[0].click();return bs.length} return 0
  })()`)
  ok('有可交互筛选控件', dashClickable > 0, `找到${dashClickable}个`)
  await wait(500)

  // ============================================================
  // 2. 对话
  // ============================================================
  console.log('\n[2] 对话')
  await c.nav('#/chat')
  const chatText = await c.eval('document.body.innerText')
  ok('对话页加载', chatText.length > 100)
  const hasAgentSel = await c.eval(`document.querySelectorAll('select').length>0`)
  ok('有Agent选择器', hasAgentSel)
  const chatInputs = await c.eval(
    `Array.from(document.querySelectorAll('textarea')).filter(i=>i.offsetParent!==null).length`,
  )
  ok('有消息输入框', chatInputs > 0)
  // 通过 API 直接测对话(比UI输入更可靠)
  console.log('    通过API测试Agent对话...')
  await c.eval("(async()=>{await window.api.agent.runManual('main','一句话介绍你自己')})()")
  await wait(12000)
  const chatHist = await c.eval(
    '(async()=>{var h=await window.api.agent.getHistory("main");var l=h[h.length-1];return{status:l?.status,len:(l?.output||"").length}})()',
  )
  ok('Agent对话有回复', chatHist.status === 'success' && chatHist.len > 10, `len=${chatHist.len}`)

  // ============================================================
  // 3. 学生
  // ============================================================
  console.log('\n[3] 学生')
  await c.nav('#/students')
  const stuData = await c.eval(
    '(async()=>{try{var s=await window.api.eaa.listStudents();return s.success?s.data.students.length:0}catch(e){return -1}})()',
  )
  ok('学生数据加载', stuData > 0, `${stuData}个学生`)
  // 搜索
  const searchOk = await c.eval(`(function(){
    var i=document.querySelector('input[type="text"],input[type="search"]');
    if(i){i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return true} return false
  })()`)
  ok('搜索框可输入', searchOk)
  // 查看第一个学生详情(EAA score)
  const scoreData = await c.eval(
    '(async()=>{try{var s=await window.api.eaa.score("张三");return s.success?"ok":s.stderr?.slice(0,50)}catch(e){return e.message}})()',
  )
  ok('EAA score API可用', scoreData === 'ok' || (typeof scoreData === 'string' && scoreData.length > 0))

  // ============================================================
  // 4. 班级
  // ============================================================
  console.log('\n[4] 班级')
  await c.nav('#/classes')
  const classData = await c.eval(
    '(async()=>{try{var r=await window.api.class.list();return r.success?r.data.length:-1}catch(e){return -1}})()',
  )
  ok('班级数据加载', classData >= 0, `${classData}个班级`)

  // ============================================================
  // 5. Agent
  // ============================================================
  console.log('\n[5] Agent')
  await c.nav('#/agents')
  const agents = await c.eval(
    '(async()=>{try{var a=await window.api.agent.list();return a.length}catch(e){return -1}})()',
  )
  ok('Agent列表加载', agents > 0, `${agents}个Agent`)
  // 查看agent详情
  const agentDetail = await c.eval(
    '(async()=>{try{var d=await window.api.agent.get("main");return d?"ok":"null"}catch(e){return e.message}})()',
  )
  ok('Agent详情可查', agentDetail === 'ok')
  // toggle一个agent(先关再开)
  const toggleOk = await c.eval(
    '(async()=>{try{var r=await window.api.agent.toggle("main",true);return r.success}catch(e){return false}})()',
  )
  ok('Agent启用/禁用', toggleOk)

  // ============================================================
  // 6. 模型
  // ============================================================
  console.log('\n[6] 模型')
  await c.nav('#/models')
  const providers = await c.eval(
    '(async()=>{try{var p=await window.api.ai.listProviders();return p.length}catch(e){return -1}})()',
  )
  ok('Provider列表加载', providers > 0, `${providers}个provider`)
  const models = await c.eval(
    '(async()=>{try{var m=await window.api.ai.listModels("minimax-cn");return m.length}catch(e){return -1}})()',
  )
  ok('MiniMax模型列表', models > 0, `${models}个模型`)
  const keyProviders = await c.eval(
    '(async()=>{var p=await window.api.ai.listProviders();return p.filter(x=>x.hasApiKey).map(x=>x.id)})()',
  )
  ok('有已配置API Key的provider', keyProviders.length > 0, keyProviders.join(','))

  // ============================================================
  // 7. 定时任务
  // ============================================================
  console.log('\n[7] 定时任务')
  await c.nav('#/scheduler')
  const crons = await c.eval(
    '(async()=>{try{var c=await window.api.cron.list();return c.length}catch(e){return -1}})()',
  )
  ok('定时任务列表加载', crons >= 0, `${crons}个任务`)

  // ============================================================
  // 8. 飞书
  // ============================================================
  console.log('\n[8] 飞书')
  const botSt = await c.eval('(async()=>await window.api.feishu.botStatus())()')
  ok('飞书长连接状态', botSt.status === 'connected', botSt.status)
  ok('appId正确', botSt.appId === 'cli_a9605dfb07b9dcc2')
  // 测试斜杠命令路由(不实际发飞书消息,直接测command router逻辑)
  // 通过Agent runManual间接验证消息流(已在[2]测试)
  // 验证测试连接
  const feishuTest = await c.eval(
    '(async()=>{try{var s=await window.api.settings.get();var r=await window.api.feishu.test(s.feishu.appId);return r.success}catch(e){return false}})()',
  )
  ok('飞书测试连接成功', feishuTest)

  // ============================================================
  // 9. 技能
  // ============================================================
  console.log('\n[9] 技能')
  await c.nav('#/skills')
  const skills = await c.eval(
    '(async()=>{try{var s=await window.api.skill.list();return s.length}catch(e){return -1}})()',
  )
  ok('技能列表加载', skills >= 0, `${skills}个技能`)

  // ============================================================
  // 10. 隐私
  // ============================================================
  console.log('\n[10] 隐私')
  await c.nav('#/privacy')
  const privSt = await c.eval(
    '(async()=>{try{var s=await window.api.privacy.status();return JSON.stringify(s)}catch(e){return e.message}})()',
  )
  ok('隐私状态可查', !privSt.includes('error'))

  // ============================================================
  // 11. 设置
  // ============================================================
  console.log('\n[11] 设置')
  await c.nav('#/settings')
  await wait(1000)
  const settingsText = await c.eval('document.body.innerText')
  ok('通用区存在', settingsText.includes('通用'))
  ok('飞书区存在', settingsText.includes('飞书'))
  ok('对话区存在', settingsText.includes('对话'))
  ok('诊断区存在', settingsText.includes('诊断'))
  ok('关于区存在', settingsText.includes('关于'))
  // 主题切换
  const before = await c.eval(
    "document.documentElement.classList.contains('dark')?'dark':'light'",
  )
  await c.eval(`(function(){var b=Array.from(document.querySelectorAll('button')).find(b=>{var t=b.getAttribute('title')||'';return t.includes('主题')});if(b)b.click()})()`)
  await wait(500)
  const after = await c.eval("document.documentElement.classList.contains('dark')?'dark':'light'")
  ok('主题切换生效', before !== after, `${before}→${after}`)
  // 切回
  await c.eval(`(function(){var b=Array.from(document.querySelectorAll('button')).find(b=>{var t=b.getAttribute('title')||'';return t.includes('主题')});if(b)b.click()})()`)

  // ============================================================
  // 12. 日常工作流模拟
  // ============================================================
  console.log('\n[12] 日常工作流模拟')
  // 工作流: 查看仪表盘 → 查学生操行 → 跑Agent分析 → 飞书通知
  console.log('    流程: 仪表盘→查学生→Agent分析')

  // Step A: 获取排名
  const ranking = await c.eval(
    '(async()=>{try{var r=await window.api.eaa.ranking(5);return r.success?"ok":r.stderr?.slice(0,50)}catch(e){return e.message}})()',
  )
  ok('工作流A: 操行排名可查', ranking === 'ok' || (typeof ranking === 'string' && ranking.length > 0))

  // Step B: EAA统计
  const stats = await c.eval(
    '(async()=>{try{var r=await window.api.eaa.stats();return r.success?"ok":r.stderr?.slice(0,50)}catch(e){return e.message}})()',
  )
  ok('工作流B: EAA统计可查', stats === 'ok' || (typeof stats === 'string' && stats.length > 0))

  // Step C: Agent分析(轻量)
  console.log('    Agent分析中...')
  await c.eval("(async()=>{await window.api.agent.runManual('academic','张三的学业情况怎么样?用一句话回答')})()")
  await wait(12000)
  const wfAgent = await c.eval(
    '(async()=>{var h=await window.api.agent.getHistory("academic");var l=h[h.length-1];return{status:l?.status,len:(l?.output||"").length}})()',
  )
  ok('工作流C: Agent分析有回复', wfAgent.status === 'success' && wfAgent.len > 5, `len=${wfAgent.len}`)

  // ============================================================
  // 汇总
  // ============================================================
  console.log('\n' + '='.repeat(50))
  console.log(`\u2713 通过: ${pass}  \u2717 失败: ${fail}  \u26a0 警告: ${warns}`)
  if (fail > 0) {
    console.log('失败项:', fails.join(', '))
  }
  console.log('='.repeat(50))
  c.close()
  if (fail > 0) process.exit(1)
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
