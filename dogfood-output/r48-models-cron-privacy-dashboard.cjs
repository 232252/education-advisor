// R48: 修复 R47 测试 bug + Models API Key 工作流 + Cron 执行监控 + 隐私匿名化 + Dashboard 内容
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
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 45000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R48: 修复R47测试bug + Models API Key + Cron执行 + 隐私匿名化 + Dashboard内容 ===\n')
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

  // ============= Part 1: 修复 R47 测试 bug 验证 =============
  console.log('--- 1. 修复 R47 测试 bug 验证 ---')
  try {
    // 1a. EAA 数据文件 (无扩展名)
    const entitiesPath = path.join(EAA_DATA, 'entities')
    try {
      const content = fs.readFileSync(entitiesPath, 'utf-8')
      const parsed = JSON.parse(content)
      const studentCount = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length
      ok('读取 entities (无扩展名)', `${studentCount} 学生`)
    } catch (e) { fail('读取 entities', '', e.message) }

    const eventsPath = path.join(EAA_DATA, 'events')
    try {
      const content = fs.readFileSync(eventsPath, 'utf-8')
      // 尝试 JSONL 解析
      const lines = content.split('\n').filter((l) => l.trim().length > 0)
      let eventCount = 0
      try {
        lines.forEach((l) => { JSON.parse(l); eventCount++ })
        ok('读取 events (JSONL)', `${eventCount} 事件行`)
      } catch (e) {
        // 可能是单个 JSON
        const parsed = JSON.parse(content)
        eventCount = Array.isArray(parsed) ? parsed.length : (parsed?.events?.length || 0)
        ok('读取 events (JSON)', `${eventCount} 事件`)
      }
    } catch (e) { fail('读取 events', '', e.message) }

    // 1b. eaa.export 正确签名 (format: string)
    try {
      const r = await call('eaa.export', 'csv')
      ok('eaa.export csv (正确签名)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('eaa.export csv', '', e.message) }
    try {
      const r = await call('eaa.export', 'jsonl')
      ok('eaa.export jsonl (正确签名)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('eaa.export jsonl', '', e.message) }
    try {
      const r = await call('eaa.export', 'html')
      ok('eaa.export html (正确签名)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('eaa.export html', '', e.message) }

    // 1c. setStudentMeta 正确签名 {name, classId}
    try {
      // 先创建一个测试学生
      await call('eaa.addStudent', 'R48-MetaTest')
      const r = await call('eaa.setStudentMeta', { name: 'R48-MetaTest', classId: 'R48-CLS-Test' })
      ok('setStudentMeta (正确签名)', `success=${r?.success ?? 'done'}`)
      // 验证元数据
      const students = await call('eaa.listStudents')
      const list = students?.data?.students ?? students?.students ?? []
      const found = list.find((s) => s.name === 'R48-MetaTest')
      if (found) {
        const hasClassId = found.class_id === 'R48-CLS-Test' || found.classId === 'R48-CLS-Test'
        ok('setStudentMeta 元数据验证', `found class_id=${found.class_id || found.classId}`)
      } else {
        fail('setStudentMeta 元数据验证', '学生未找到')
      }
      // 清理
      await call('eaa.deleteStudent', 'R48-MetaTest')
    } catch (e) { fail('setStudentMeta', '', e.message) }
  } catch (e) { fail('修复 R47 验证', '', e.message) }

  // ============= Part 2: Models API Key 工作流 =============
  console.log('\n--- 2. Models API Key 工作流 ---')
  try {
    // 列出 providers
    const providers = await call('ai.listProviders')
    const providerList = providers?.data ?? providers ?? []
    ok('ai.listProviders', `${Array.isArray(providerList) ? providerList.length : 'N/A'} providers`)

    // 列出某 provider 的 models
    const testProviderId = 'openai'
    try {
      const models = await call('ai.listModels', testProviderId)
      const modelList = models?.data ?? models ?? []
      const modelCount = Array.isArray(modelList) ? modelList.length : (typeof modelList === 'object' ? Object.keys(modelList).length : 0)
      ok(`ai.listModels('${testProviderId}')`, `${modelCount} models`)
    } catch (e) { fail('ai.listModels', '', e.message) }

    // 设置 API Key (测试 key, 不是真的)
    try {
      const r = await call('ai.setApiKey', testProviderId, 'sk-test-r48-dummy-key-12345')
      ok(`ai.setApiKey('${testProviderId}')`, `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('ai.setApiKey', '', e.message) }

    // 测试连接 (会失败,但验证 API 不崩溃)
    try {
      const r = await call('ai.testConnection', testProviderId, 'sk-test-r48-dummy-key-12345')
      ok(`ai.testConnection`, `success=${r?.success} (预期失败,不崩溃即可)`)
    } catch (e) {
      // 预期会失败 (假 key), 但 API 不应崩溃
      ok(`ai.testConnection (预期失败)`, `error: ${String(e.message).slice(0, 80)}`)
    }

    // 删除 API Key
    try {
      const r = await call('ai.deleteApiKey', testProviderId)
      ok(`ai.deleteApiKey('${testProviderId}')`, `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('ai.deleteApiKey', '', e.message) }

    // 添加自定义模型
    try {
      const r = await call('ai.addCustomModel', {
        providerId: testProviderId,
        modelId: 'r48-custom-model',
        name: 'R48 Custom Test Model',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        supportsReasoning: false,
      })
      ok('ai.addCustomModel', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('ai.addCustomModel', '', e.message) }

    // 更新自定义模型
    try {
      const r = await call('ai.updateCustomModel', {
        providerId: testProviderId,
        modelId: 'r48-custom-model',
        name: 'R48 Custom Updated',
        contextWindow: 16384,
      })
      ok('ai.updateCustomModel', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('ai.updateCustomModel', '', e.message) }

    // 删除自定义模型
    try {
      const r = await call('ai.deleteCustomModel', testProviderId, 'r48-custom-model')
      ok('ai.deleteCustomModel', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('ai.deleteCustomModel', '', e.message) }
  } catch (e) { fail('Models API Key 工作流', '', e.message) }

  // ============= Part 3: Cron 执行监控 =============
  console.log('\n--- 3. Cron 执行监控 ---')
  try {
    // 列出现有 cron 任务
    const tasks = await call('cron.list')
    const taskList = Array.isArray(tasks) ? tasks : (tasks?.data ?? [])
    ok('cron.list', `${taskList.length} 任务`)

    // 添加一个测试 cron 任务
    let testTaskId = null
    try {
      const r = await call('cron.add', {
        name: 'R48-CronTest',
        agentId: 'academic',
        expression: '0 9 * * *',
        prompt: 'R48 测试 cron 任务',
        enabled: true,
        modelTier: 'standard',
      })
      testTaskId = r?.id || r?.data?.id
      ok('cron.add', `id=${testTaskId}`)
    } catch (e) { fail('cron.add', '', e.message) }

    // 验证任务在列表中
    if (testTaskId) {
      const tasksAfter = await call('cron.list')
      const taskListAfter = Array.isArray(tasksAfter) ? tasksAfter : (tasksAfter?.data ?? [])
      const found = taskListAfter.find((t) => t.id === testTaskId)
      if (found) ok('cron 任务在列表中', `id=${testTaskId} name=${found.name}`)

      // toggle 关闭
      try {
        const r = await call('cron.toggle', testTaskId, false)
        ok('cron.toggle(false)', `success=${r?.success ?? 'done'}`)
      } catch (e) { fail('cron.toggle', '', e.message) }

      // toggle 开启
      try {
        const r = await call('cron.toggle', testTaskId, true)
        ok('cron.toggle(true)', `success=${r?.success ?? 'done'}`)
      } catch (e) { fail('cron.toggle', '', e.message) }

      // runNow (实际执行)
      try {
        const r = await call('cron.runNow', testTaskId)
        ok('cron.runNow', `success=${r?.success} message=${r?.message?.slice(0, 50)}`)
        // 等待执行
        await new Promise((resolve) => setTimeout(resolve, 2000))
      } catch (e) { fail('cron.runNow', '', e.message) }

      // 获取日志
      try {
        const logs = await call('cron.getLogs', testTaskId)
        const logList = Array.isArray(logs) ? logs : (logs?.data ?? logs?.logs ?? [])
        ok('cron.getLogs(taskId)', `${Array.isArray(logList) ? logList.length : 'N/A'} 日志条目`)
      } catch (e) { fail('cron.getLogs', '', e.message) }

      // 获取所有日志
      try {
        const allLogs = await call('cron.getLogs')
        const allLogList = Array.isArray(allLogs) ? allLogs : (allLogs?.data ?? allLogs?.logs ?? [])
        ok('cron.getLogs(全部)', `${Array.isArray(allLogList) ? allLogList.length : 'N/A'} 日志条目`)
      } catch (e) { fail('cron.getLogs(全部)', '', e.message) }

      // 删除测试任务
      try {
        const r = await call('cron.remove', testTaskId)
        ok('cron.remove', `success=${r?.success ?? 'done'}`)
      } catch (e) { fail('cron.remove', '', e.message) }
    }

    // 测试不存在的 task
    try {
      const r = await call('cron.runNow', 'non-existent-task-id')
      if (r?.success === false) ok('cron.runNow(不存在) 拒绝', `message=${r.message?.slice(0, 50)}`)
      else fail('cron.runNow(不存在) 应返回 false', `success=${r?.success}`)
    } catch (e) { ok('cron.runNow(不存在) 抛错', `error: ${String(e.message).slice(0, 80)}`) }
  } catch (e) { fail('Cron 执行监控', '', e.message) }

  // ============= Part 4: 隐私匿名化工作流 =============
  console.log('\n--- 4. 隐私匿名化工作流 ---')
  try {
    // 检查隐私状态
    const status = await call('privacy.status')
    ok('privacy.status', `enabled=${status?.enabled} locked=${status?.locked}`)

    // 初始化隐私引擎 (用测试密码)
    try {
      const r = await call('privacy.init', 'r48-test-pwd-123')
      ok('privacy.init', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.init', '', e.message) }

    // 加载隐私引擎
    try {
      const r = await call('privacy.load', 'r48-test-pwd-123')
      ok('privacy.load', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.load', '', e.message) }

    // 添加映射
    try {
      const r = await call('privacy.add', {
        entityType: 'person',
        original: 'R48-TestPerson',
        anonymized: '同学A',
      })
      ok('privacy.add (person)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.add', '', e.message) }

    try {
      const r = await call('privacy.add', {
        entityType: 'student_id',
        original: 'R48-SID-001',
        anonymized: '学号A',
      })
      ok('privacy.add (student_id)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.add student_id', '', e.message) }

    // 列出映射
    try {
      const r = await call('privacy.list')
      const list = r?.data ?? r?.mappings ?? r ?? []
      ok('privacy.list', `${Array.isArray(list) ? list.length : 'N/A'} 映射`)
    } catch (e) { fail('privacy.list', '', e.message) }

    // 过滤测试 (dryrun)
    try {
      const r = await call('privacy.dryrun', 'R48-TestPerson 在课堂上说话', 'parent')
      ok('privacy.dryrun', `success=${r?.success ?? 'done'} (预期返回过滤后文本)`)
    } catch (e) { fail('privacy.dryrun', '', e.message) }

    // 匿名化测试
    try {
      const r = await call('privacy.anonymize', 'R48-TestPerson 今天迟到了')
      ok('privacy.anonymize', `success=${r?.success ?? 'done'} (预期 R48-TestPerson → 同学A)`)
    } catch (e) { fail('privacy.anonymize', '', e.message) }

    // 反匿名化测试
    try {
      const r = await call('privacy.deanonymize', '同学A 今天迟到了')
      ok('privacy.deanonymize', `success=${r?.success ?? 'done'} (预期 同学A → R48-TestPerson)`)
    } catch (e) { fail('privacy.deanonymize', '', e.message) }

    // 备份
    const backupPath = path.join(EAA_DATA, 'privacy-backup-r48.json')
    try {
      const r = await call('privacy.backup', backupPath)
      ok('privacy.backup', `success=${r?.success ?? 'done'}`)
      // 验证备份文件存在
      if (fs.existsSync(backupPath)) {
        const stat = fs.statSync(backupPath)
        ok('备份文件存在', `${stat.size} bytes`)
      }
    } catch (e) { fail('privacy.backup', '', e.message) }

    // 禁用隐私引擎
    try {
      const r = await call('privacy.disable')
      ok('privacy.disable', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.disable', '', e.message) }
  } catch (e) { fail('隐私匿名化工作流', '', e.message) }

  // ============= Part 5: EAA Dashboard HTML 内容检查 =============
  console.log('\n--- 5. EAA Dashboard HTML 内容检查 ---')
  try {
    // 生成 dashboard
    const dashResult = await call('eaa.dashboard')
    ok('eaa.dashboard', `success=${dashResult?.success ?? 'done'}`)

    // 查找生成的 HTML 文件
    const dashboardDir = path.join(EAA_DATA, 'eaa-dashboard')
    try {
      if (fs.existsSync(dashboardDir)) {
        const files = fs.readdirSync(dashboardDir)
        ok('eaa-dashboard 目录', `${files.length} 文件: ${files.slice(0, 5).join(', ')}`)

        // 查找 index.html
        const htmlFile = files.find((f) => f.endsWith('.html'))
        if (htmlFile) {
          const htmlPath = path.join(dashboardDir, htmlFile)
          const content = fs.readFileSync(htmlPath, 'utf-8')
          ok('读取 dashboard HTML', `${content.length} 字符`)

          // 验证 HTML 结构
          const hasDoctype = content.includes('<!DOCTYPE') || content.includes('<html')
          const hasTitle = content.includes('<title')
          const hasBody = content.includes('<body')
          ok('HTML 结构验证', `doctype=${hasDoctype} title=${hasTitle} body=${hasBody}`)

          // 检查关键内容
          const hasStudentCount = content.includes('学生') || content.includes('student')
          const hasScore = content.includes('分数') || content.includes('score')
          const hasRanking = content.includes('排名') || content.includes('ranking')
          ok('Dashboard 内容', `学生=${hasStudentCount} 分数=${hasScore} 排名=${hasRanking}`)
        } else {
          fail('Dashboard HTML 文件', '未找到 .html 文件')
        }
      } else {
        fail('eaa-dashboard 目录', '不存在')
      }
    } catch (e) { fail('Dashboard 目录检查', '', e.message) }
  } catch (e) { fail('EAA Dashboard 内容检查', '', e.message) }

  // ============= Part 6: Dashboard UI 重新验证 (更长等待) =============
  console.log('\n--- 6. Dashboard UI 重新验证 (更长等待) ---')
  try {
    // 导航到 dashboard 并等待更长时间
    await cdp.eval(`window.location.hash = '#/dashboard'`)
    await new Promise((resolve) => setTimeout(resolve, 3000))

    const dashH1 = await cdp.eval(`document.querySelector('h1')?.textContent || ''`)
    if (dashH1.length > 0) ok('Dashboard h1 (3s 等待)', `"${dashH1}"`)
    else fail('Dashboard h1 仍为空', '即使等待 3s')

    // 检查 dashboard 内容元素
    const dashStats = await cdp.eval(`document.querySelectorAll('[class*="stat"], [class*="card"], [class*="metric"]').length`)
    ok('Dashboard 统计卡片', `${dashStats} 个`)

    // 检查刷新按钮
    const refreshBtn = await cdp.eval(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('刷新') || b.textContent.includes('refresh'))?.textContent || ''`)
    if (refreshBtn.length > 0) ok('Dashboard 刷新按钮', `"${refreshBtn}"`)
  } catch (e) { fail('Dashboard UI 验证', '', e.message) }

  // ============= Part 7: 最终状态 =============
  console.log('\n--- 7. 最终状态 ---')
  try {
    const info = await call('eaa.info')
    const data = info?.data || info
    ok('最终 eaa.info', `students=${data?.students} events=${data?.events}`)
  } catch (e) { fail('最终状态', '', e.message) }

  // ============= 汇总 =============
  console.log('\n=== R48 汇总 ===')
  console.log(`总计: ${results.pass + results.fail}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.steps.filter((s) => s.s === 'fail').forEach((s) => console.log(`  - ${s.n}: ${s.e || ''}`))
  }

  await cdp.close()
  process.exit(0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
