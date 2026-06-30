// ============================================================
// 第十轮：Privacy 模块 + EAA 高级命令 + Agent 全量 + 系统更新
// 覆盖：
//   1. Privacy init/load/status/lock/add/list/anonymize/deanonymize/filter/dryrun/backup
//   2. EAA export formats / dashboard / tag / range / replay / validate / summary / doctor
//   3. Agent list (18 个) + get + getSoul + getRules
//   4. sys.checkUpdate / sys.notify
//   5. profile.get/set
//   6. log.list/filter/search
// ============================================================
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')
const os = require('os')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

class CDPClient {
  async connect() {
    const targets = await getTargets()
    const page = targets.find(t => t.type === 'page')
    this.ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise(r => this.ws.on('open', r))
    this.id = 0; this.pending = new Map()
    this.ws.on('message', msg => {
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 90000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  async callApi(path, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' :: ' + detail.slice(0, 150) : ''}`)
}

async function main() {
  const c = new CDPClient()
  await c.connect()
  console.log('============================================================')
  console.log('ROUND 10: Privacy + EAA Advanced + Agents + System')
  console.log('============================================================')

  // ============================================================
  // [1] EAA 只读高级命令（不依赖 Privacy 状态）
  // ============================================================
  console.log('\n[1] EAA 只读高级命令')

  // 1.1 export formats
  const exportFmts = await c.callApi('eaa.exportFormats')
  record('eaa.exportFormats', Array.isArray(exportFmts) && exportFmts.length > 0, `formats=${JSON.stringify(exportFmts)}`)

  // 1.2 doctor
  const doctor = await c.callApi('eaa.doctor')
  record('eaa.doctor', doctor?.success === true || typeof doctor?.data === 'object', `success=${doctor?.success}`)

  // 1.3 validate
  const validate = await c.callApi('eaa.validate')
  record('eaa.validate', validate?.success === true || typeof validate?.data === 'object', `success=${validate?.success}`)

  // 1.4 tag list (无参数 → 列出所有标签)
  const tagList = await c.callApi('eaa.tag')
  record('eaa.tag_list', tagList?.success === true || Array.isArray(tagList?.data), `success=${tagList?.success}`)

  // 1.5 summary
  const summary = await c.callApi('eaa.summary')
  record('eaa.summary', summary?.success === true || typeof summary?.data === 'object', `success=${summary?.success}`)

  // 1.6 range（日期范围查询，使用最近 30 天）
  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)
  const range = await c.callApi('eaa.range', fmt(thirtyDaysAgo), fmt(today), 100)
  record('eaa.range', range?.success === true || Array.isArray(range?.data), `success=${range?.success}`)

  // 1.7 replay（全量重放）
  const replay = await c.callApi('eaa.replay')
  record('eaa.replay', replay?.success === true || typeof replay?.data === 'object', `success=${replay?.success}`)

  // 1.8 codes（reason codes 列表）
  const codes = await c.callApi('eaa.codes')
  record('eaa.codes', codes?.success === true || Array.isArray(codes?.data), `success=${codes?.success}`)

  // 1.9 info
  const info = await c.callApi('eaa.info')
  record('eaa.info', info?.success === true || typeof info?.data === 'object', `success=${info?.success}`)

  // 1.10 dashboard 生成
  const tmpDir = path.join(os.tmpdir(), `eaa-dashboard-${Date.now()}`)
  const dashboard = await c.callApi('eaa.dashboard', tmpDir)
  record('eaa.dashboard', dashboard?.success === true, `success=${dashboard?.success}, dir=${tmpDir}`)

  // 1.11 export 到文件
  const exportFile = path.join(os.tmpdir(), `eaa-export-${Date.now()}.csv`)
  const exportRes = await c.callApi('eaa.export', 'csv', exportFile)
  record('eaa.export_csv', exportRes?.success === true, `success=${exportRes?.success}`)
  if (fs.existsSync(exportFile)) {
    const stat = fs.statSync(exportFile)
    record('eaa.export_file_exists', stat.size >= 0, `size=${stat.size}`)
  } else {
    record('eaa.export_file_exists', false, 'file not created')
  }

  // ============================================================
  // [2] Privacy 模块完整测试
  // ============================================================
  console.log('\n[2] Privacy 模块')

  const testPassword = 'R10TestPwd_2026'
  const testEntityText = '张三的电话是13800138000'
  const testEntityType = 'phone'

  // 2.1 先检查状态（可能已锁定）
  const status1 = await c.callApi('privacy.status')
  record('privacy.status_initial', status1?.unlocked === false || status1?.unlocked === true, `unlocked=${status1?.unlocked}`)

  // 2.2 尝试 init（首次）或 load（已初始化）
  let initOk = false
  const initRes = await c.callApi('privacy.init', testPassword, false)
  if (initRes?.success === true) {
    initOk = true
    record('privacy.init', true, 'first init succeeded')
  } else {
    // 可能已初始化，尝试 load
    const loadRes = await c.callApi('privacy.load', testPassword)
    if (loadRes?.success === true) {
      initOk = true
      record('privacy.init', true, 'already initialized, load succeeded')
    } else {
      record('privacy.init', false, `init failed: ${initRes?.stderr || initRes?.data?.slice(0, 80) || 'unknown'}; load also failed: ${loadRes?.stderr || loadRes?.data?.slice(0, 80) || 'unknown'}`)
    }
  }

  // 2.3 status 应该 unlocked=true
  const status2 = await c.callApi('privacy.status')
  record('privacy.status_unlocked', status2?.unlocked === true, `unlocked=${status2?.unlocked}`)

  if (initOk) {
    // 2.4 add entity
    const addRes = await c.callApi('privacy.add', testEntityType, '13800138000')
    record('privacy.add', addRes?.success === true, `success=${addRes?.success}`)

    // 2.5 list entities
    const listRes = await c.callApi('privacy.list')
    record('privacy.list', listRes?.success === true || Array.isArray(listRes?.data), `success=${listRes?.success}`)

    // 2.6 dryrun（脱敏预览）
    const dryrunRes = await c.callApi('privacy.dryrun', testEntityText)
    record('privacy.dryrun', dryrunRes?.success === true, `success=${dryrunRes?.success}`)

    // 2.7 anonymize
    const anonRes = await c.callApi('privacy.anonymize', testEntityText)
    record('privacy.anonymize', anonRes?.success === true, `success=${anonRes?.success}`)

    // 2.8 deanonymize
    const deanonRes = await c.callApi('privacy.deanonymize', testEntityText)
    record('privacy.deanonymize', deanonRes?.success === true, `success=${deanonRes?.success}`)

    // 2.9 filter（按接收者过滤）
    const filterRes = await c.callApi('privacy.filter', 'public', testEntityText)
    record('privacy.filter', filterRes?.success === true, `success=${filterRes?.success}`)

    // 2.10 backup
    const backupPath = path.join(os.tmpdir(), `eaa-privacy-backup-${Date.now()}.json`)
    const backupRes = await c.callApi('privacy.backup', backupPath)
    record('privacy.backup', backupRes?.success === true, `success=${backupRes?.success}, path=${backupPath}`)
    if (fs.existsSync(backupPath)) {
      const stat = fs.statSync(backupPath)
      record('privacy.backup_file_exists', stat.size > 0, `size=${stat.size}`)
    } else {
      record('privacy.backup_file_exists', false, 'file not created')
    }

    // 2.11 lock（清空内存密码）
    const lockRes = await c.callApi('privacy.lock')
    record('privacy.lock', lockRes?.success === true, `success=${lockRes?.success}`)

    // 2.12 status 应该 unlocked=false
    const status3 = await c.callApi('privacy.status')
    record('privacy.status_locked', status3?.unlocked === false, `unlocked=${status3?.unlocked}`)

    // 2.13 重新 load（验证密码可重新解锁）
    const reloadRes = await c.callApi('privacy.load', testPassword)
    record('privacy.reload', reloadRes?.success === true, `success=${reloadRes?.success}`)

    // 2.14 disable（关闭隐私，清理状态）— 用测试密码
    const disableRes = await c.callApi('privacy.disable', testPassword)
    record('privacy.disable', disableRes?.success === true, `success=${disableRes?.success}`)
  }

  // ============================================================
  // [3] Agent 全量测试（18 个 agent）
  // ============================================================
  console.log('\n[3] Agent 全量')

  const agentList = await c.callApi('agent.list')
  record('agent.list', Array.isArray(agentList) && agentList.length > 0, `count=${agentList?.length}`)

  const expectedAgents = ['academic', 'bug-hunter', 'class-monitor', 'counselor', 'data-analyst',
    'discipline-officer', 'executor', 'governor', 'home_school', 'main',
    'psychology', 'research', 'risk-alert', 'safety', 'student-care',
    'supervisor', 'validator', 'weekly-reporter']

  if (Array.isArray(agentList)) {
    const agentIds = agentList.map(a => a.id || a.agentId)
    const allPresent = expectedAgents.every(id => agentIds.includes(id))
    record('agent.all_present', allPresent, `expected=${expectedAgents.length}, found=${agentIds.length}, missing=${expectedAgents.filter(id => !agentIds.includes(id)).join(',') || 'none'}`)

    // 测试 get 每个 agent 的详情
    let getOkCount = 0
    let soulOkCount = 0
    let rulesOkCount = 0
    for (const agentId of expectedAgents) {
      const detail = await c.callApi('agent.get', agentId)
      if (detail && !detail.__error) getOkCount++
      else console.log(`    [agent.get] ${agentId} failed: ${detail?.__error?.slice(0, 60) || 'unknown'}`)

      const soul = await c.callApi('agent.getSoul', agentId)
      if (soul && !soul.__error && (typeof soul === 'string' ? soul.length > 0 : true)) soulOkCount++

      const rules = await c.callApi('agent.getRules', agentId)
      if (rules && !rules.__error) rulesOkCount++
    }
    record('agent.get_all', getOkCount === expectedAgents.length, `${getOkCount}/${expectedAgents.length} succeeded`)
    record('agent.getSoul_all', soulOkCount === expectedAgents.length, `${soulOkCount}/${expectedAgents.length} succeeded`)
    record('agent.getRules_all', rulesOkCount === expectedAgents.length, `${rulesOkCount}/${expectedAgents.length} succeeded`)

    // toggle 测试（开→关→开）
    const testAgent = 'research'
    const beforeToggle = agentList.find(a => (a.id || a.agentId) === testAgent)
    const beforeEnabled = beforeToggle?.enabled
    const toggleRes = await c.callApi('agent.toggle', testAgent, !beforeEnabled)
    record('agent.toggle', !toggleRes?.__error, `agent=${testAgent}, before=${beforeEnabled}, after=${!beforeEnabled}`)
    // 恢复
    await c.callApi('agent.toggle', testAgent, beforeEnabled)
  }

  // ============================================================
  // [4] 系统级功能
  // ============================================================
  console.log('\n[4] 系统级')

  // 4.1 checkUpdate
  const updateInfo = await c.callApi('sys.checkUpdate')
  record('sys.checkUpdate', updateInfo && !updateInfo.__error, `hasUpdate=${updateInfo?.hasUpdate}, current=${updateInfo?.currentVersion}, enabled=${updateInfo?.enabled}`)

  // 4.2 notify
  const notifyRes = await c.callApi('sys.notify', 'R10 测试标题', '这是一条 R10 自动化测试通知')
  record('sys.notify', notifyRes?.success === true, `success=${notifyRes?.success}`)

  // 4.3 getPath
  const desktopPath = await c.callApi('sys.getPath', 'desktop')
  record('sys.getPath', typeof desktopPath === 'string' && desktopPath.length > 0, `path=${desktopPath?.slice(0, 50)}`)

  // 4.4 openExternal (http URL)
  // 注意：openExternal 会打开浏览器，测试时跳过实际打开，只验证参数校验
  // 改为测试非法 URL 应被拒绝
  const badUrlRes = await c.callApi('sys.openExternal', 'file:///etc/passwd')
  record('sys.openExternal_blocked', badUrlRes?.__error || badUrlRes?.success === false, `error=${badUrlRes?.__error?.slice(0, 60) || badUrlRes?.error || 'none'}`)

  // ============================================================
  // [5] 学生档案 profile
  // ============================================================
  console.log('\n[5] 学生档案 profile')

  const profileStudent = `ProfileR10-${Date.now()}`
  await c.callApi('eaa.addStudent', profileStudent)

  const profileSetRes = await c.callApi('profile.set', profileStudent, { nickname: '测试昵称', note: 'R10 测试备注', birthday: '2010-05-15' })
  record('profile.set', profileSetRes?.success === true || !profileSetRes?.__error, `success=${profileSetRes?.success}`)

  const profileGetRes = await c.callApi('profile.get', profileStudent)
  record('profile.get', profileGetRes && !profileGetRes?.__error, `hasData=${!!profileGetRes?.data || !!profileGetRes?.nickname}`)

  await c.callApi('eaa.deleteStudent', profileStudent, { confirm: true })

  // ============================================================
  // [6] 日志系统
  // ============================================================
  console.log('\n[6] 日志系统')

  // log.list 返回日志文件数组：[{stream, date, name, sizeBytes}, ...]
  const logList = await c.callApi('log.list')
  record('log.list', Array.isArray(logList) && logList.length > 0, `count=${logList?.length}`)

  if (Array.isArray(logList) && logList.length > 0) {
    // 取第一个主进程日志文件（sizeBytes > 0 才有内容可查）
    const mainLog = logList.find(l => l.stream === 'main' && l.sizeBytes > 0) || logList[0]
    const logName = mainLog?.name || ''
    console.log(`    使用日志文件: ${logName} (size=${mainLog?.sizeBytes})`)

    // log.filter(filePath, levels[], lines?) — filePath 是文件名
    const logFilter = await c.callApi('log.filter', logName, ['info', 'warn', 'error'], 50)
    record('log.filter', logFilter && !logFilter?.__error, `type=${typeof logFilter}, len=${typeof logFilter === 'string' ? logFilter.length : JSON.stringify(logFilter).length}`)

    // log.search(filePath, query, maxResults?) — filePath 是文件名, query 是字符串
    const logSearch = await c.callApi('log.search', logName, 'eaa', 10)
    record('log.search', logSearch && !logSearch?.__error, `type=${typeof logSearch}, len=${typeof logSearch === 'string' ? logSearch.length : JSON.stringify(logSearch).length}`)

    // log.read(filePath, lines?)
    const logRead = await c.callApi('log.read', logName, 20)
    record('log.read', logRead && !logRead?.__error, `type=${typeof logRead}, len=${typeof logRead === 'string' ? logRead.length : JSON.stringify(logRead).length}`)
  } else {
    record('log.filter', false, 'no log files available')
    record('log.search', false, 'no log files available')
    record('log.read', false, 'no log files available')
  }

  // ============================================================
  // [7] EAA export 其他格式
  // ============================================================
  console.log('\n[7] EAA export 其他格式')

  const jsonlFile = path.join(os.tmpdir(), `eaa-export-${Date.now()}.jsonl`)
  const jsonlRes = await c.callApi('eaa.export', 'jsonl', jsonlFile)
  record('eaa.export_jsonl', jsonlRes?.success === true, `success=${jsonlRes?.success}`)

  const htmlFile = path.join(os.tmpdir(), `eaa-export-${Date.now()}.html`)
  const htmlRes = await c.callApi('eaa.export', 'html', htmlFile)
  record('eaa.export_html', htmlRes?.success === true, `success=${htmlRes?.success}`)

  // 非法格式应被拒绝
  const badFmtRes = await c.callApi('eaa.export', 'xml', null)
  record('eaa.export_bad_format_rejected', badFmtRes?.success === false || badFmtRes?.__error, `success=${badFmtRes?.success}`)

  // ============================================================
  // [8] 边界 / 错误处理
  // ============================================================
  console.log('\n[8] 边界 / 错误处理')

  // 8.1 EAA range 非法日期格式
  const badRange = await c.callApi('eaa.range', 'invalid-date', 'also-invalid')
  record('eaa.range_bad_date_rejected', badRange?.success === false || badRange?.__error, `success=${badRange?.success}`)

  // 8.2 EAA range start > end
  const futureDate = '2099-12-31'
  const pastDate = '2020-01-01'
  const reverseRange = await c.callApi('eaa.range', futureDate, pastDate)
  record('eaa.range_reverse_handled', reverseRange?.success !== undefined, `success=${reverseRange?.success}`)

  // 8.3 privacy.init 短密码应被拒绝
  const shortPwdRes = await c.callApi('privacy.init', 'ab', false)
  record('privacy.init_short_pwd_rejected', shortPwdRes?.success === false || shortPwdRes?.__error, `success=${shortPwdRes?.success}`)

  // 8.4 privacy.add 非法 entity type
  const badTypeRes = await c.callApi('privacy.add', 'invalid_type', 'test')
  record('privacy.add_bad_type_rejected', badTypeRes?.success === false || badTypeRes?.__error, `success=${badTypeRes?.success}`)

  // 8.5 class.create 重复 class_id
  const dupClassId = `DUP-R10-${Date.now()}`.slice(0, 14)
  await c.callApi('class.create', { class_id: dupClassId, name: '测试班级1' })
  const dupRes = await c.callApi('class.create', { class_id: dupClassId, name: '测试班级2' })
  record('class.create_dup_rejected', dupRes?.success === false, `success=${dupRes?.success}, error=${dupRes?.error?.slice(0, 60)}`)
  // cleanup
  const dupList = await c.callApi('class.list')
  const dupInternal = dupList?.data?.find(c => c.class_id === dupClassId)?.id
  if (dupInternal) await c.callApi('class.delete', dupInternal)

  // 8.6 skill.get 不存在的技能
  const notExistSkill = await c.callApi('skill.get', 'non-existent-skill-' + Date.now())
  record('skill.get_not_exist_handled', notExistSkill?.__error || notExistSkill === null || notExistSkill === '' || notExistSkill?.content === undefined, `type=${typeof notExistSkill}`)

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n============================================================')
  console.log('ROUND 10 SUMMARY')
  console.log('============================================================')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  results.filter(r => !r.ok).forEach(r => {
    console.log(`  FAIL: ${r.name} :: ${r.detail}`)
  })
  console.log(`\nTotal: ${passed} ok, ${failed} fail, ${results.length} tests`)

  fs.writeFileSync(
    'c:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round10.json',
    JSON.stringify({ round: 10, timestamp: new Date().toISOString(), results, passed, failed, total: results.length }, null, 2)
  )

  c.close()
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})
