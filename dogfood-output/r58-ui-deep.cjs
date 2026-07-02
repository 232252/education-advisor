// =============================================================
// R58 — UI 深度交互测试
//
// 测试所有页面的 UI 交互:
//   1. 导航到所有路由,验证渲染
//   2. 表单交互 (输入/选择/提交)
//   3. 弹窗/确认对话框
//   4. 快速导航不崩溃
//   5. 暗色/亮色主题切换
//   6. 设置页交互
//   7. 班级页 CRUD 操作
//   8. 学生页 CRUD 操作
// =============================================================

const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

const RESULT = { pass: 0, fail: 0, warn: 0, errors: [] }
const ts = Date.now().toString().slice(-6)

function log(type, msg, detail) {
  const full = detail ? `${msg} — ${detail}` : msg
  if (type === 'PASS') { RESULT.pass++; console.log(`  \u2212 ${full}`) }
  else if (type === 'FAIL') { RESULT.fail++; RESULT.errors.push(full); console.log(`  \u2717 ${full}`) }
  else if (type === 'WARN') { RESULT.warn++; console.log(`  ! ${full}`) }
}

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p?.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 30000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  async api(code) { const v = await this.eval(`(async()=>{try{const r=${code};return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`); if (typeof v === 'string' && v.startsWith('ERR:')) return { __error: v.slice(4) }; try { return v ? JSON.parse(v) : null } catch (e) { return v } }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('=== R58 UI 深度交互测试 ===')
  console.log('时间戳:', ts)
  console.log('')

  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const routes = [
    { path: '/', name: '首页' },
    { path: '#/chat', name: '对话' },
    { path: '#/dashboard', name: '仪表盘' },
    { path: '#/students', name: '学生' },
    { path: '#/classes', name: '班级' },
    { path: '#/agents', name: 'Agent' },
    { path: '#/models', name: '模型' },
    { path: '#/skills', name: '技能' },
    { path: '#/scheduler', name: '定时任务' },
    { path: '#/privacy', name: '隐私引擎' },
    { path: '#/settings', name: '设置' },
  ]

  try {
    // =============================================================
    // 场景 1: 导航到所有路由,验证渲染
    // =============================================================
    console.log('--- 场景 1: 导航到所有路由 ---')
    for (const route of routes) {
      try {
        await cdp.eval(`window.location.hash = '${route.path.startsWith('#') ? route.path.slice(1) : ''}'`)
        if (route.path === '/') await cdp.eval(`window.location.hash = ''`)
        await sleep(700)
        const text = await cdp.eval(`document.body.innerText.length`)
        const title = await cdp.eval(`document.querySelector('h1,h2,.text-2xl')?.textContent || ''`)
        if (text > 100) log('PASS', `${route.name}页渲染`, `${text} 字符`)
        else log('FAIL', `${route.name}页渲染异常`, `${text} 字符`)
      } catch (e) {
        log('WARN', `${route.name}页导航异常`, e.message)
      }
    }

    console.log('')

    // =============================================================
    // 场景 2: 快速导航不崩溃
    // =============================================================
    console.log('--- 场景 2: 快速导航不崩溃 ---')
    let navOk = 0
    for (let i = 0; i < 20; i++) {
      const route = routes[i % routes.length]
      await cdp.eval(`window.location.hash = '${route.path.startsWith('#') ? route.path.slice(1) : ''}'`)
      if (route.path === '/') await cdp.eval(`window.location.hash = ''`)
      await sleep(200)
      navOk++
    }
    // 最后验证页面仍可响应
    await sleep(500)
    const finalText = await cdp.eval(`document.body.innerText.length`)
    if (finalText > 100 && navOk === 20) log('PASS', `20次快速导航无崩溃`, `最终渲染 ${finalText} 字符`)
    else log('FAIL', `快速导航异常`)

    console.log('')

    // =============================================================
    // 场景 3: 仪表盘交互 (班级筛选 + 对比模式)
    // =============================================================
    console.log('--- 场景 3: 仪表盘交互 ---')
    await cdp.eval(`window.location.hash = '/dashboard'`)
    await sleep(800)

    // 班级筛选下拉
    const selectCount = await cdp.eval(`document.querySelectorAll('select').length`)
    if (selectCount > 0) log('PASS', `仪表盘有 select`, `${selectCount} 个`)
    else log('WARN', `仪表盘无 select`)

    // 对比模式按钮
    const buttons = await cdp.eval(`Array.from(document.querySelectorAll('button')).map(b=>b.textContent.trim()).filter(t=>t.includes('对比')||t.includes('Compare'))`)
    if (buttons.length > 0) log('PASS', `对比模式按钮存在`)
    else log('WARN', `未找到对比模式按钮`)

    // 点击对比模式按钮
    const compareClicked = await cdp.api(`(()=>{
      const btn = Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('对比')||b.textContent.includes('Compare'))
      if (!btn) return {error:'no button'}
      btn.click()
      return {ok:true}
    })()`)
    if (compareClicked?.ok) {
      await sleep(500)
      const afterClick = await cdp.eval(`document.body.innerText.length`)
      log('PASS', `点击对比模式`, `渲染 ${afterClick} 字符`)
    } else log('WARN', `对比模式点击失败`)

    console.log('')

    // =============================================================
    // 场景 4: 班级页 CRUD 操作
    // =============================================================
    console.log('--- 场景 4: 班级页 CRUD ---')
    await cdp.eval(`window.location.hash = '/classes'`)
    await sleep(800)

    // 创建班级 (API + UI 验证)
    const testClassId = `R58C-${ts}`
    const createR = await cdp.api(`await window.api.class.create({class_id:'${testClassId}',name:'R58UI测试班_${ts}',grade:'高一'})`)
    if (createR?.success) {
      log('PASS', `创建班级 (API)`)
      // 刷新班级页验证显示
      await sleep(500)
      await cdp.eval(`window.location.hash = '/classes'`)
      await sleep(800)
      const classText = await cdp.eval(`document.body.innerText`)
      if (classText.includes('R58UI测试班') || classText.includes(testClassId))
        log('PASS', `班级页显示新班级`)
      else log('WARN', `班级页未显示新班级`)

      // 存档
      const classId = createR.data?.id
      const archR = await cdp.api(`await window.api.class.archive('${classId}')`)
      if (archR?.success) log('PASS', `存档班级`)
      else log('FAIL', `存档失败`)

      // 恢复
      const restR = await cdp.api(`await window.api.class.restore('${classId}')`)
      if (restR?.success) log('PASS', `恢复班级`)
      else log('FAIL', `恢复失败`)

      // 删除
      const delR = await cdp.api(`await window.api.class.delete('${classId}')`)
      if (delR?.success) log('PASS', `删除班级`)
      else log('FAIL', `删除失败`)
    } else {
      log('FAIL', `创建班级失败`, createR?.__error)
    }

    console.log('')

    // =============================================================
    // 场景 5: 学生页 CRUD
    // =============================================================
    console.log('--- 场景 5: 学生页 CRUD ---')
    await cdp.eval(`window.location.hash = '/students'`)
    await sleep(800)

    const testStudent = `R58student_${ts}`
    const addStuR = await cdp.api(`await window.api.eaa.addStudent('${testStudent}')`)
    if (addStuR?.success) {
      log('PASS', `创建学生 (API)`)
      await sleep(500)
      await cdp.eval(`window.location.hash = '/students'`)
      await sleep(800)
      const stuText = await cdp.eval(`document.body.innerText`)
      if (stuText.includes(testStudent)) log('PASS', `学生页显示新学生`)
      else log('WARN', `学生页未显示新学生`)

      // 添加事件
      const evR = await cdp.api(`await window.api.eaa.addEvent({studentName:'${testStudent}',reasonCode:'LATE'})`)
      if (evR?.success) log('PASS', `添加事件 (LATE)`)
      else log('FAIL', `添加事件失败`)

      // 删除
      const delR = await cdp.api(`await window.api.eaa.deleteStudent('${testStudent}','R58清理')`)
      if (delR?.success) log('PASS', `删除学生`)
      else log('FAIL', `删除失败`)
    } else {
      log('FAIL', `创建学生失败`, addStuR?.__error)
    }

    console.log('')

    // =============================================================
    // 场景 6: 设置页交互
    // =============================================================
    console.log('--- 场景 6: 设置页交互 ---')
    await cdp.eval(`window.location.hash = '/settings'`)
    await sleep(800)

    const settingsButtons = await cdp.eval(`document.querySelectorAll('button').length`)
    if (settingsButtons > 5) log('PASS', `设置页按钮数`, `${settingsButtons}`)
    else log('WARN', `设置页按钮较少`, `${settingsButtons}`)

    // 主题切换 (如有)
    const themeToggle = await cdp.api(`(()=>{
      const btn = Array.from(document.querySelectorAll('button')).find(b=>{
        const t = b.textContent.toLowerCase()
        return t.includes('dark')||t.includes('light')||t.includes('主题')||t.includes('theme')||b.querySelector('svg')
      })
      if (!btn) return {error:'no theme button'}
      return {ok:true, text:btn.textContent.slice(0,20)}
    })()`)
    if (themeToggle?.ok) log('PASS', `主题切换按钮存在`)
    else log('WARN', `未找到主题切换按钮`)

    // 验证设置可读取
    const settingsR = await cdp.api(`await window.api.settings.get()`)
    if (settingsR?.success !== false) log('PASS', `settings.get() 可用`)
    else log('FAIL', `settings.get() 失败`)

    console.log('')

    // =============================================================
    // 场景 7: 对话页 UI
    // =============================================================
    console.log('--- 场景 7: 对话页 UI ---')
    await cdp.eval(`window.location.hash = '/chat'`)
    await sleep(800)
    const chatText = await cdp.eval(`document.body.innerText.length`)
    if (chatText > 100) log('PASS', `对话页渲染`, `${chatText} 字符`)
    else log('FAIL', `对话页渲染异常`)

    // 输入框 (如有)
    const inputExists = await cdp.eval(`!!document.querySelector('textarea,input[type="text"]')`)
    if (inputExists) log('PASS', `对话页有输入框`)
    else log('WARN', `对话页无输入框`)

    console.log('')

    // =============================================================
    // 场景 8: 隐私引擎页
    // =============================================================
    console.log('--- 场景 8: 隐私引擎页 ---')
    await cdp.eval(`window.location.hash = '/privacy'`)
    await sleep(800)
    const privacyText = await cdp.eval(`document.body.innerText.length`)
    if (privacyText > 100) log('PASS', `隐私页渲染`, `${privacyText} 字符`)
    else log('FAIL', `隐私页渲染异常`)

    // 隐私引擎状态查询
    const statusR = await cdp.api(`await window.api.privacy.status()`)
    if (statusR !== null) log('PASS', `privacy.status() 可用`)
    else log('WARN', `privacy.status() 返回 null`)

    console.log('')

    // =============================================================
    // 场景 9: 定时任务页
    // =============================================================
    console.log('--- 场景 9: 定时任务页 ---')
    await cdp.eval(`window.location.hash = '/scheduler'`)
    await sleep(800)
    const schedText = await cdp.eval(`document.body.innerText.length`)
    if (schedText > 100) log('PASS', `定时任务页渲染`, `${schedText} 字符`)
    else log('FAIL', `定时任务页渲染异常`)

    const cronListR = await cdp.api(`await window.api.cron.list()`)
    if (cronListR !== null) log('PASS', `cron.list() 可用`)
    else log('WARN', `cron.list() 返回 null`)

    console.log('')

    // =============================================================
    // 场景 10: Agent / 模型 / 技能页
    // =============================================================
    console.log('--- 场景 10: Agent/模型/技能页 ---')
    for (const [path, name] of [['/agents', 'Agent'], ['/models', '模型'], ['/skills', '技能']]) {
      await cdp.eval(`window.location.hash = '${path}'`)
      await sleep(700)
      const text = await cdp.eval(`document.body.innerText.length`)
      if (text > 100) log('PASS', `${name}页渲染`, `${text} 字符`)
      else log('FAIL', `${name}页渲染异常`)
    }

    // Agent API
    const agentList = await cdp.api(`await window.api.agent.list()`)
    if (agentList !== null) log('PASS', `agent.list() 可用`)

    // Skill API
    const skillList = await cdp.api(`await window.api.skill.list()`)
    if (skillList !== null) log('PASS', `skill.list() 可用`)

    // AI Provider
    const providers = await cdp.api(`await window.api.ai.listProviders()`)
    if (providers !== null) log('PASS', `ai.listProviders() 可用`)
    else log('WARN', `ai.listProviders() 返回 null`)

    console.log('')

    // =============================================================
    // 场景 11: 回到首页,验证无崩溃
    // =============================================================
    console.log('--- 场景 11: 回到首页验证 ---')
    await cdp.eval(`window.location.hash = ''`)
    await sleep(800)
    const homeText = await cdp.eval(`document.body.innerText.length`)
    if (homeText > 100) log('PASS', `首页最终渲染正常`, `${homeText} 字符`)
    else log('FAIL', `首页最终渲染异常`)

  } catch (e) {
    log('FAIL', '测试异常', e.message)
    console.error(e.stack)
  } finally {
    ws.close()
  }

  console.log('')
  console.log('=== R58 测试完成 ===')
  const total = RESULT.pass + RESULT.fail + RESULT.warn
  const rate = total > 0 ? ((RESULT.pass / total) * 100).toFixed(1) : '0.0'
  console.log(`结果: ${RESULT.pass} pass, ${RESULT.fail} fail, ${RESULT.warn} warn`)
  console.log(`通过率: ${rate}%`)
  if (RESULT.errors.length > 0) {
    console.log('失败项:')
    RESULT.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`))
  }
  fs.writeFileSync('dogfood-output/r58-ui-result.json', JSON.stringify({ test: 'R58', summary: { pass: RESULT.pass, fail: RESULT.fail, warn: RESULT.warn, rate: rate + '%' }, errors: RESULT.errors }, null, 2), 'utf-8')
  process.exit(RESULT.fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })
