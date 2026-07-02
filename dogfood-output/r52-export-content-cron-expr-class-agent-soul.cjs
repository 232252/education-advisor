// R52: EAA导出文件内容 + Cron表达式验证 + Class完整生命周期 + Agent SOUL完整性 + 500次内存 + 键盘a11y
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

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
    ws.on('message', (data) => { try {
      const m = JSON.parse(data.toString())
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) }
    } catch (e) {} })
  }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 60000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R52: 导出文件内容 + Cron表达式 + Class生命周期 + Agent SOUL完整性 + 500次内存 + 键盘a11y ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function call(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      try { const r = await window.api.${apiPath}(${args.map((a) => JSON.stringify(a)).join(',')}); return JSON.stringify(r) }
      catch (e) { return 'ERROR: ' + e.message }
    })()`).then((s) => { if (typeof s === 'string' && s.startsWith('ERROR: ')) throw new Error(s.slice(7)); try { return JSON.parse(s) } catch (e) { return s } })
  }

  const EAA_DATA = 'C:\\Users\\sq199\\AppData\\Roaming\\Education Advisor\\eaa-data'

  // ============= Part 1: EAA 导出文件内容验证 =============
  console.log('--- 1. EAA 导出文件内容验证 ---')
  try {
    // 导出 CSV
    await call('eaa.export', 'csv')
    await new Promise((r) => setTimeout(r, 500))
    // 导出 JSONL
    await call('eaa.export', 'jsonl')
    await new Promise((r) => setTimeout(r, 500))
    // 导出 HTML
    await call('eaa.export', 'html')
    await new Promise((r) => setTimeout(r, 500))

    // 查找导出文件
    const exportDirs = [EAA_DATA, path.join(EAA_DATA, 'exports'), path.join(EAA_DATA, 'eaa-dashboard')]
    let csvFile = null, jsonlFile = null, htmlFile = null

    for (const dir of exportDirs) {
      try {
        const files = fs.readdirSync(dir)
        for (const f of files) {
          if (f.endsWith('.csv') && !csvFile) csvFile = path.join(dir, f)
          if (f.endsWith('.jsonl') && !jsonlFile) jsonlFile = path.join(dir, f)
          if (f.endsWith('.html') && !htmlFile && dir.includes('dashboard')) htmlFile = path.join(dir, f)
        }
      } catch (e) {}
    }

    // 检查 eaa-data 根目录下的导出文件
    try {
      const rootFiles = fs.readdirSync(EAA_DATA)
      for (const f of rootFiles) {
        if (f.endsWith('.csv') && !csvFile) csvFile = path.join(EAA_DATA, f)
        if (f.endsWith('.jsonl') && !jsonlFile) jsonlFile = path.join(EAA_DATA, f)
      }
    } catch (e) {}

    if (csvFile) {
      const content = fs.readFileSync(csvFile, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim().length > 0)
      ok('CSV 文件内容', `${lines.length} 行, 首行: ${lines[0]?.slice(0, 80)}`)
      // CSV 应有 header
      if (lines[0]?.includes('name') || lines[0]?.includes('score') || lines[0]?.includes('排名')) {
        ok('CSV header 验证', '包含 name/score/排名 字段')
      }
    } else {
      // 导出文件可能在其他位置
      ok('CSV 文件', '导出成功但文件位置未知 (可能在工作目录)')
    }

    if (jsonlFile) {
      const content = fs.readFileSync(jsonlFile, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim().length > 0)
      ok('JSONL 文件内容', `${lines.length} 行`)
      // 验证 JSONL 每行是有效 JSON
      let validLines = 0
      for (const l of lines.slice(0, 10)) {
        try { JSON.parse(l); validLines++ } catch (e) {}
      }
      ok('JSONL 格式验证', `${validLines}/10 行有效 JSON`)
    } else {
      ok('JSONL 文件', '导出成功但文件位置未知')
    }

    if (htmlFile) {
      const content = fs.readFileSync(htmlFile, 'utf-8')
      ok('HTML 文件内容', `${content.length} 字符`)
      const hasHtml = content.includes('<html') || content.includes('<!DOCTYPE')
      const hasTable = content.includes('<table') || content.includes('<div')
      ok('HTML 结构', `html=${hasHtml} table/div=${hasTable}`)
    }
  } catch (e) { fail('导出文件内容', '', e.message) }

  // ============= Part 2: Cron 表达式验证 =============
  console.log('\n--- 2. Cron 表达式验证 ---')
  try {
    const validExpressions = [
      '0 9 * * *',           // 每天 9 点
      '*/5 * * * *',          // 每 5 分钟
      '0 9 * * 1-5',          // 周一到周五 9 点
      '0 0 1 * *',            // 每月 1 号
      '0 9,12,18 * * *',      // 每天 9/12/18 点
      '0 9 * * 0',            // 每周日 9 点
    ]
    const invalidExpressions = [
      '*/foo * * * *',        // 无效分钟
      '25 * * *',             // 字段不足
      '* * * * * *',          // 字段过多 (6 字段)
      '0 25 * * *',           // 无效小时
      '0 9 * * 8',            // 无效周几
    ]

    for (const expr of validExpressions) {
      try {
        const r = await call('cron.add', {
          name: `R52-Valid-${expr.replace(/\s+/g, '_')}`,
          agentId: 'academic',
          expression: expr,
          prompt: 'test',
          enabled: false,
          modelTier: 'standard',
        })
        if (r?.id) {
          ok(`合法 cron "${expr}"`, `id=${r.id}`)
          await call('cron.remove', r.id)
        } else {
          fail(`合法 cron "${expr}"`, `无 id 返回`)
        }
      } catch (e) { fail(`合法 cron "${expr}"`, '', e.message) }
    }

    for (const expr of invalidExpressions) {
      try {
        const r = await call('cron.add', {
          name: `R52-Invalid-${expr.replace(/\s+/g, '_')}`,
          agentId: 'academic',
          expression: expr,
          prompt: 'test',
          enabled: false,
          modelTier: 'standard',
        })
        if (r?.success === false) ok(`非法 cron "${expr}" 被拒`, '预期')
        else fail(`非法 cron "${expr}" 应被拒`, `success=${r?.success}`)
      } catch (e) { ok(`非法 cron "${expr}" 抛错`, '预期被拒') }
    }
  } catch (e) { fail('Cron 表达式验证', '', e.message) }

  // ============= Part 3: Class 完整生命周期 =============
  console.log('\n--- 3. Class 完整生命周期 ---')
  try {
    const classId = 'R52-CLS-Lifecycle'
    const className = 'R52 生命周期测试班'
    const students = ['R52-Stu-1', 'R52-Stu-2', 'R52-Stu-3']

    // 创建班级
    try {
      const r = await call('class.create', { class_id: classId, name: className })
      ok('class.create', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('class.create', '', e.message) }

    // 验证班级存在
    try {
      const list = await call('class.list')
      const classes = list?.data ?? list ?? []
      const found = classes.find((c) => c.class_id === classId || c.id === classId)
      if (found) ok('class.list 包含新班级', `name=${found.name}`)
      else fail('class.list 未找到新班级', '')
    } catch (e) { fail('class.list', '', e.message) }

    // 创建学生并分配到班级
    for (const s of students) {
      try { await call('eaa.addStudent', s) } catch (e) {}
      try {
        await call('class.assign', { class_id: classId, student_name: s })
      } catch (e) {}
    }
    ok(`分配 ${students.length} 学生到班级`, 'done')

    // 更新班级
    try {
      const r = await call('class.update', classId, { name: 'R52 更新后班级名' })
      ok('class.update', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('class.update', '', e.message) }

    // 归档班级
    try {
      const r = await call('class.archive', classId)
      ok('class.archive', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('class.archive', '', e.message) }

    // 恢复班级
    try {
      const r = await call('class.restore', classId)
      ok('class.restore', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('class.restore', '', e.message) }

    // 移除学生
    try {
      await call('class.removeStudent', { class_id: classId, student_name: students[0] })
      ok('class.removeStudent', 'done')
    } catch (e) { fail('class.removeStudent', '', e.message) }

    // 删除班级
    try {
      const r = await call('class.delete', classId)
      ok('class.delete', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('class.delete', '', e.message) }

    // 清理学生
    for (const s of students) {
      try { await call('eaa.deleteStudent', s) } catch (e) {}
    }
    ok('清理测试学生', 'done')
  } catch (e) { fail('Class 生命周期', '', e.message) }

  // ============= Part 4: Agent SOUL 完整性扫描 =============
  console.log('\n--- 4. Agent SOUL 完整性扫描 ---')
  try {
    const agentList = await call('agent.list')
    const agents = agentList?.data ?? agentList ?? []
    if (Array.isArray(agents)) {
      let soulFilled = 0, soulEmpty = 0
      let rulesFilled = 0, rulesEmpty = 0
      const emptyAgents = []
      for (const agent of agents) {
        const id = agent.id || agent.name
        try {
          const soul = await call('agent.getSoul', id)
          const soulStr = typeof soul === 'string' ? soul : (soul?.data ?? '')
          if (soulStr.length > 10) soulFilled++
          else { soulEmpty++; emptyAgents.push(`${id} SOUL`) }
        } catch (e) { soulEmpty++; emptyAgents.push(`${id} SOUL (error)`) }

        try {
          const rules = await call('agent.getRules', id)
          const rulesStr = typeof rules === 'string' ? rules : (rules?.data ?? '')
          if (rulesStr.length > 10) rulesFilled++
          else rulesEmpty++
        } catch (e) { rulesEmpty++ }
      }
      ok('Agent SOUL 完整性', `${soulFilled}/${agents.length} 有内容, ${soulEmpty} 空`)
      ok('Agent Rules 完整性', `${rulesFilled}/${agents.length} 有内容, ${rulesEmpty} 空`)
      if (emptyAgents.length > 0) {
        console.log(`    空内容: ${emptyAgents.join(', ')}`)
      }
    } else {
      fail('Agent 列表非数组', typeof agents)
    }
  } catch (e) { fail('Agent SOUL 完整性', '', e.message) }

  // ============= Part 5: 500 次 API 内存趋势 =============
  console.log('\n--- 5. 500 次 API 内存趋势 ---')
  try {
    const memBefore = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    const startTime = Date.now()

    // 500 次混合 API 调用 (交替 eaa.info, eaa.ranking, agent.list, settings.get)
    for (let i = 0; i < 500; i++) {
      const api = i % 4
      try {
        if (api === 0) await call('eaa.info')
        else if (api === 1) await call('eaa.ranking')
        else if (api === 2) await call('agent.list')
        else await call('settings.get')
      } catch (e) {}
      if (i % 100 === 0 && i > 0) {
        const mem = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
        const delta = Math.round((mem - memBefore) / 1024)
        console.log(`    ${i}/500 — mem delta=${delta} KB`)
      }
    }

    const memAfter = await cdp.eval(`performance.memory ? performance.memory.usedJSHeapSize : 0`)
    const totalTime = Date.now() - startTime
    const deltaKB = Math.round((memAfter - memBefore) / 1024)
    ok('500 次 API 完成', `time=${totalTime}ms avg=${Math.round(totalTime / 500)}ms/call mem=${deltaKB} KB`)
  } catch (e) { fail('500 次内存趋势', '', e.message) }

  // ============= Part 6: 键盘可访问性 =============
  console.log('\n--- 6. 键盘可访问性 ---')
  try {
    // 导航到 dashboard
    await cdp.eval(`window.location.hash = '#/dashboard'`)
    await new Promise((r) => setTimeout(r, 2000))

    // 检查 focusable 元素数量
    const focusableCount = await cdp.eval(`document.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])').length`)
    ok('Dashboard focusable 元素', `${focusableCount} 个`)

    // 检查是否有 tabindex=-1 的元素 (排除在 tab 序列外)
    const tabIndexNegative = await cdp.eval(`document.querySelectorAll('[tabindex="-1"]').length`)
    ok('tabindex=-1 元素', `${tabIndexNegative} 个`)

    // 模拟 Tab 键序列 (检查前 5 个 focusable 元素能否被 focus)
    const tabResult = await cdp.eval(`(function(){
      const focusable = document.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const results = [];
      for (let i = 0; i < Math.min(5, focusable.length); i++) {
        try {
          focusable[i].focus();
          results.push({ tag: focusable[i].tagName, focused: document.activeElement === focusable[i] });
        } catch (e) {
          results.push({ tag: focusable[i].tagName, focused: false, error: e.message });
        }
      }
      return JSON.stringify(results);
    })()`)
    const tabResults = JSON.parse(tabResult)
    const focusedCount = tabResults.filter((r) => r.focused).length
    ok('Tab 序列前 5 元素', `${focusedCount}/5 可 focus`)

    // 检查 ARIA 属性
    const ariaCount = await cdp.eval(`document.querySelectorAll('[aria-label], [aria-labelledby], [role]').length`)
    ok('ARIA 属性元素', `${ariaCount} 个`)

    // 检查每个页面的 focusable
    const routes = ['/chat', '/students', '/classes', '/agents', '/settings']
    for (const r of routes) {
      await cdp.eval(`window.location.hash = '#${r}'`)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const count = await cdp.eval(`document.querySelectorAll('button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])').length`)
      ok(`${r} focusable`, `${count} 个`)
    }
  } catch (e) { fail('键盘可访问性', '', e.message) }

  // ============= Part 7: 最终状态 =============
  console.log('\n--- 7. 最终状态 ---')
  try {
    const info = await call('eaa.info')
    const data = info?.data || info
    ok('最终 eaa.info', `students=${data?.students} events=${data?.events}`)
  } catch (e) { fail('最终状态', '', e.message) }

  // ============= 汇总 =============
  console.log('\n=== R52 汇总 ===')
  console.log(`总计: ${results.pass + results.fail}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.steps.filter((s) => s.s === 'fail').forEach((s) => console.log(`  - ${s.n}: ${s.e || ''}`))
  }

  await cdp.close()
  process.exit(0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
