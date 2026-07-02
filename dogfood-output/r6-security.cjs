// R6: 安全测试 - 注入/路径穿越/特殊字符/NUL 字节/超长输入
// 目标: 验证各 IPC handler 的输入校验是否能阻挡攻击向量
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')

const LOG_FILE = path.join(__dirname, 'r6-output.log')
try { fs.writeFileSync(LOG_FILE, '') } catch {}
function logProgress(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`
  process.stdout.write(line)
  try { fs.appendFileSync(LOG_FILE, line) } catch {}
}

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
  })
}

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')) } }, 30000)
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }
    return r.result.value
  }
  async callApi(p, ...args) {
    return this.eval(`(async () => {
      const parts = ${JSON.stringify(p)}.split('.')
      let obj = window.api
      for (const x of parts) {
        if (!obj || typeof obj !== 'object') return { __error: 'no api: ' + parts.join('.') }
        obj = obj[x]
      }
      if (typeof obj !== 'function') return { __error: 'not a function: ' + parts.join('.') }
      const a = ${JSON.stringify(args)}
      try { return await obj(...a) } catch(e) { return { __error: e.message, __thrown: true } }
    })()`)
  }
  close() { if (this.ws) this.ws.close() }
}

const stats = { total: 0, pass: 0, fail: 0, errors: [], byCategory: {} }
function record(category, name, ok, detail = '') {
  stats.total++
  if (ok) stats.pass++
  else { stats.fail++; stats.errors.push({ category, name, detail: String(detail).slice(0, 250) }) }
  stats.byCategory[category] = stats.byCategory[category] || { pass: 0, fail: 0 }
  if (ok) stats.byCategory[category].pass++
  else stats.byCategory[category].fail++
  // 只记录失败的输出
  if (!ok) logProgress(`  [${category}] FAIL: ${name} :: ${String(detail).slice(0, 200)}`)
}

// 判断结果是否被正确拒绝(rejected) - 即输入被验证为非法
function isRejected(r) {
  if (!r) return false
  if (r.__error) return true // 抛错视为拒绝
  if (r.success === false) return true // 返回失败视为拒绝
  // 对于 EAA,若返回 success:false 或 data 包含 Error 视为拒绝
  if (typeof r.data === 'string' && /Error:|invalid|illegal|cannot|too long|must be/i.test(r.data)) return true
  if (r.stderr && /invalid|illegal|cannot|too long|must be|error/i.test(r.stderr)) return true
  return false
}

// 判断结果是否被接受(accepted) - 即输入通过了验证
function isAccepted(r) {
  if (!r) return false
  if (r.__error) return false
  if (r.success === true) return true
  return false
}

async function main() {
  logProgress('============================================================')
  logProgress('ROUND 6 (R6): 安全测试 - 注入/路径穿越/特殊字符')
  logProgress('============================================================')

  const c = new CDPClient()
  await c.connect()

  // 注入错误监听
  await c.eval(`(function(){
    if(window.__r6Errs) return
    window.__r6Errs = []
    window.addEventListener('error', e => { window.__r6Errs.push(e.message) })
    window.addEventListener('unhandledrejection', e => { window.__r6Errs.push('unhandled:' + (e.reason && e.reason.message || e.reason)) })
  })()`)

  // ============================================================
  // [1] EAA addStudent - Shell 注入尝试 (应被 sanitizeName 拒绝)
  // ============================================================
  logProgress('\n[1] EAA addStudent - Shell 注入尝试')
  const shellPayloads = [
    '`whoami`',
    '$(whoami)',
    '; rm -rf /',
    '&& cat /etc/passwd',
    '| nc -l 4444',
    '& calc.exe',
    '<script>alert(1)</script>',
    '--help',
    '--output-file=/tmp/pwned',
    'name\\whoami',
  ]
  for (const payload of shellPayloads) {
    const r = await c.callApi('eaa.addStudent', payload)
    // 期望: 被拒绝 (不创建学生,返回错误)
    const rejected = isRejected(r)
    record('shell_injection_addStudent', payload.slice(0, 30), rejected, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [2] EAA addStudent - NUL 字节 / 隐形 Unicode (应被拒绝)
  // ============================================================
  logProgress('\n[2] EAA addStudent - NUL 字节 / 隐形 Unicode')
  const nulPayloads = [
    'name\x00injected',         // NUL 字节
    'name\u200Bzero',            // 零宽空格
    'name\uFEFFbom',             // BOM
    'name\u202Ertl',             // RTL override
    'name\u0001ctrl',            // 控制字符
    '',                          // 空字符串
    '   ',                       // 仅空格
    '\t\t',                      // 仅 tab
  ]
  for (const payload of nulPayloads) {
    const r = await c.callApi('eaa.addStudent', payload)
    const rejected = isRejected(r)
    record('nul_unicode_addStudent', JSON.stringify(payload).slice(0, 30), rejected, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [3] EAA addStudent - 超长字符串 (应被 64 字符限制拒绝)
  // ============================================================
  logProgress('\n[3] EAA addStudent - 超长字符串')
  const longPayloads = [
    'A'.repeat(65),     // 刚好超过 64
    'A'.repeat(100),
    'A'.repeat(1000),
    'A'.repeat(10000),
  ]
  for (const payload of longPayloads) {
    const r = await c.callApi('eaa.addStudent', payload)
    const rejected = isRejected(r)
    record('long_string_addStudent', `len=${payload.length}`, rejected, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [4] EAA addStudent - 合法 Unicode (应被接受)
  // ============================================================
  logProgress('\n[4] EAA addStudent - 合法 Unicode/中文/emoji')
  const validPayloads = [
    '张三',                    // 中文
    'José',                   // 带音标
    '小明(测试)',              // 中文+括号
    "O'Brien",                // 单引号
    'Mary-Jane',              // 连字符
    '学生·甲',                 // 中文+中点
  ]
  const validCreatedStudents = [] // 用于后续清理
  for (const payload of validPayloads) {
    const r = await c.callApi('eaa.addStudent', payload)
    const accepted = isAccepted(r)
    record('valid_unicode_addStudent', payload, accepted, JSON.stringify(r).slice(0, 150))
    if (accepted) validCreatedStudents.push(payload)
  }
  // 清理
  for (const name of validCreatedStudents) {
    await c.callApi('eaa.deleteStudent', name, { confirm: true, reason: 'R6清理' })
  }

  // ============================================================
  // [5] EAA addEvent - reasonCode 注入
  // ============================================================
  logProgress('\n[5] EAA addEvent - reasonCode 注入')
  // 先创建一个测试学生
  const testStu = 'R6TestStu'
  await c.callApi('eaa.addStudent', testStu)
  const badCodes = [
    'LATE; rm -rf /',
    'LATE --output-file=/tmp/x',
    'LATE\x00',
    '--help',
    'LATE\nINJECTION',
  ]
  for (const code of badCodes) {
    const r = await c.callApi('eaa.addEvent', { studentName: testStu, reasonCode: code, note: 'R6测试' })
    const rejected = isRejected(r)
    record('reasoncode_injection', JSON.stringify(code).slice(0, 30), rejected, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [6] EAA search - 超长查询 / NUL 字节 / 注入
  // ============================================================
  logProgress('\n[6] EAA search - 超长/NUL/注入')
  const searchPayloads = [
    'A'.repeat(10000),          // 超长查询 (应被截断到 8192)
    'query\x00malicious',
    '"; DROP TABLE events; --',
    '" OR 1=1 --',
    '" && whoami "',
  ]
  for (const payload of searchPayloads) {
    const r = await c.callApi('eaa.search', payload, 10)
    // search 不一定拒绝 (超长会被截断,NUL 可能被透传到 Rust)
    // 关键: 不应崩溃,应有返回
    const noCrash = !r?.__error || !/timeout|crash|fatal/i.test(r.__error)
    record('search_injection', `len=${payload.length}`, noCrash, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [7] EAA range - 日期格式注入
  // ============================================================
  logProgress('\n[7] EAA range - 日期格式注入')
  const badDates = [
    ["'; DROP TABLE", '2025-01-01'],
    ['2025-01-01', '2024-12-31'],     // 倒置 (R3 修复后应拒绝)
    ['not-a-date', '2025-01-01'],
    ['2025-13-45', '2025-01-01'],
    ['', ''],
  ]
  for (const [start, end] of badDates) {
    const r = await c.callApi('eaa.range', start, end, 10)
    const rejected = isRejected(r)
    record('date_injection_range', `${start}~${end}`.slice(0, 30), rejected, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [8] EAA import - 路径穿越 (filePath 参数)
  // ============================================================
  logProgress('\n[8] EAA import - 路径穿越')
  const traversalPaths = [
    '../../../etc/passwd',
    '..\\\\..\\\\..\\\\windows\\\\system32\\\\config\\\\sam',
    '/etc/shadow',
    'C:\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts',
    'file:///etc/passwd',
    'name\x00.txt',
  ]
  for (const filePath of traversalPaths) {
    const r = await c.callApi('eaa.import', filePath)
    // import 路径穿越应该被 Rust 端拒绝 (找不到/不能读),不应该成功导入
    const notAccepted = !isAccepted(r) || r?.data?.parsed === false
    record('path_traversal_import', filePath.slice(0, 40), notAccepted, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [9] EAA setStudentMeta - classId 注入 (sanitizeClassId)
  // ============================================================
  logProgress('\n[9] EAA setStudentMeta - classId 注入')
  const badClassIds = [
    '../../../etc',
    'class; rm -rf /',
    'class\x00',
    'class with space',
    'class"quote',
    "class'quote",
    '--help',
    'A'.repeat(33),  // 超长
  ]
  for (const classId of badClassIds) {
    const r = await c.callApi('eaa.setStudentMeta', { name: testStu, classId })
    const rejected = isRejected(r)
    record('classid_injection', JSON.stringify(classId).slice(0, 30), rejected, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [10] Skill save - 路径穿越 (skill-service 验证)
  // ============================================================
  logProgress('\n[10] Skill save - 路径穿越')
  const badSkillNames = [
    '../../../etc/passwd',
    '..\\\\..\\\\windows\\\\system32',
    'skill/name',
    'skill\\name',
    'skill:name',
    'skill*name',
    'skill?name',
    'skill"name',
    'skill<name>',
    'skill|name',
    'skill\x00name',  // NUL 字节 (regex 不阻挡)
  ]
  for (const name of badSkillNames) {
    const r = await c.callApi('skill.save', name, '# R6 test content')
    const rejected = isRejected(r)
    record('path_traversal_skill', JSON.stringify(name).slice(0, 30), rejected, JSON.stringify(r).slice(0, 150))
    // 如果意外创建了,清理
    if (isAccepted(r)) {
      await c.callApi('skill.delete', name)
    }
  }

  // ============================================================
  // [11] Agent setSoul - id 路径穿越 (validateAgentId)
  // ============================================================
  logProgress('\n[11] Agent setSoul - id 路径穿越')
  const badAgentIds = [
    '../../../etc/passwd',
    '..\\\\..\\\\windows',
    'agent/../other',
    'AGENT-Upper',  // 大写不允许
    'agent.name',   // 点不允许
    'agent name',   // 空格不允许
    'agent;rm',
    '--help',
    'agent\x00name',
  ]
  for (const id of badAgentIds) {
    const r = await c.callApi('agent.setSoul', id, '# R6 soul content')
    const rejected = isRejected(r)
    record('path_traversal_agent', JSON.stringify(id).slice(0, 30), rejected, JSON.stringify(r).slice(0, 150))
  }

  // ============================================================
  // [12] Agent setRules - XSS / 超长内容 (内容应该是任意的)
  // ============================================================
  logProgress('\n[12] Agent setRules - 内容写入测试')
  // 先获取一个合法 agent id
  const agentsList = await c.callApi('agent.list')
  const validAgentId = agentsList?.[0]?.id || 'academic'
  const xssContents = [
    '<script>alert("XSS")</script>',
    '"><img src=x onerror=alert(1)>',
    '${7*7}',
    '{{7*7}}',
    'A'.repeat(10000),
    '\x00\x01\x02binary',
  ]
  for (const content of xssContents) {
    const r = await c.callApi('agent.setRules', validAgentId, content)
    // 内容应被接受 (setRules 不限制内容,因为是文本写入)
    // 但超长可能因 fs 限制失败
    const accepted = isAccepted(r) || isRejected(r) // 接受或拒绝都行,关键是不能崩溃
    record('xss_agent_rules', `len=${content.length}`, accepted, JSON.stringify(r).slice(0, 150))
  }
  // 清理: 写回空内容
  await c.callApi('agent.setRules', validAgentId, '')

  // ============================================================
  // [13] Class create - SQL 注入尝试 (应被参数化查询阻挡)
  // ============================================================
  logProgress('\n[13] Class create - SQL 注入')
  const sqlPayloads = [
    { class_id: "'; DROP TABLE classes; --", name: 'inject1', grade: '七年级', teacher: 't' },
    { class_id: "x' OR '1'='1", name: 'inject2', grade: '七年级', teacher: 't' },
    { class_id: 'inject3', name: "name'; INSERT INTO classes VALUES('hack'); --", grade: '七年级', teacher: 't' },
    { class_id: 'inject4', name: 'normal', grade: '七年级', teacher: "t' OR '1'='1" },
  ]
  const createdInjectedClassIds = []
  for (const cls of sqlPayloads) {
    const r = await c.callApi('class.create', cls)
    // 关键: 不应导致数据库损坏或崩溃
    // class_id 应被接受或安全存储 (参数化查询)
    const noCrash = !r?.__error || !/database|sqlite|corrupt/i.test(r.__error)
    record('sql_injection_class', cls.class_id.slice(0, 30), noCrash, JSON.stringify(r).slice(0, 150))
    if (isAccepted(r) && r.data?.id) createdInjectedClassIds.push(r.data.id)
  }
  // 验证 class.list 仍正常 (证明数据库未损坏)
  const listRes = await c.callApi('class.list')
  record('sql_injection_class', 'db_not_corrupted', listRes?.success === true, `classes count: ${listRes?.data?.length ?? '?'}`)
  // 清理
  for (const id of createdInjectedClassIds) {
    await c.callApi('class.delete', id)
  }

  // ============================================================
  // [14] Chat saveMessage - SQL 注入内容 (应被参数化查询阻挡)
  // ============================================================
  logProgress('\n[14] Chat saveMessage - SQL 注入内容')
  const sqlMessages = [
    { role: 'user', content: "'; DROP TABLE chat_messages; --" },
    { role: 'user', content: "' OR '1'='1" },
    { role: 'user', content: '${7*7}' },
    { role: 'user', content: '{{7*7}}' },
    { role: 'user', content: 'A'.repeat(10000) },
    { role: 'user', content: '<script>alert(1)</script>' },
  ]
  const savedMsgIds = []
  for (const msg of sqlMessages) {
    const r = await c.callApi('chat.saveMessage', msg)
    const accepted = isAccepted(r)
    record('sql_injection_chat', msg.content.slice(0, 30), accepted, JSON.stringify(r).slice(0, 150))
    if (accepted && r.id >= 0) savedMsgIds.push(r.id)
  }
  // 验证 chat.loadMessages 仍正常
  const loadRes = await c.callApi('chat.loadMessages')
  record('sql_injection_chat', 'db_not_corrupted', loadRes?.success === true, `messages count: ${loadRes?.messages?.length ?? '?'}`)

  // ============================================================
  // [15] Cron add - 恶意 cron 表达式 (应被 node-cron validate 拒绝)
  // ============================================================
  logProgress('\n[15] Cron add - 恶意 cron 表达式')
  const badCrons = [
    'not-a-cron',
    '* * * *',              // 字段不够
    '99 * * * *',           // 分钟超范围
    '* 99 * * *',           // 小时超范围
    '* * * * 99',           // 周几超范围
    '; rm -rf /',
    '* * * * *; whoami',
  ]
  for (const cronExpr of badCrons) {
    const r = await c.callApi('cron.add', {
      name: `R6-test-${Date.now()}`,
      expression: cronExpr,
      agentId: 'academic',
      prompt: 'R6 test',
      enabled: false,
    })
    const rejected = isRejected(r)
    record('cron_injection', cronExpr.slice(0, 30), rejected, JSON.stringify(r).slice(0, 150))
    // 清理: 如果意外创建了
    if (isAccepted(r) && r.id) {
      await c.callApi('cron.remove', r.id)
    }
  }

  // ============================================================
  // [16] 最终错误检查 - 应无 uncaught error
  // ============================================================
  logProgress('\n[16] 最终错误检查')
  const errs = await c.eval('window.__r6Errs || []')
  const realErrs = (errs || []).filter(e => !/React DevTools|Download the React|Warning: .*deprecated| ELECTRON|was suspended|renderer_security/i.test(e))
  record('final', 'no_uncaught_errors', realErrs.length === 0, `${realErrs.length} real errors`)
  logProgress(`  uncaught errors: ${realErrs.length}/${errs?.length || 0}`)
  if (realErrs.length > 0 && realErrs.length <= 20) {
    for (const e of realErrs) logProgress(`    ERR: ${String(e).slice(0, 250)}`)
  }

  // 清理 R6 测试学生
  logProgress('\n[清理] 删除 R6 测试学生')
  await c.callApi('eaa.deleteStudent', testStu, { confirm: true, reason: 'R6 cleanup' })

  // ============================================================
  // 汇总
  // ============================================================
  logProgress('\n============================================================')
  logProgress('R6 SUMMARY')
  logProgress('============================================================')
  logProgress(`Total: ${stats.total}, Pass: ${stats.pass}, Fail: ${stats.fail}`)
  logProgress('By category:')
  for (const [cat, s] of Object.entries(stats.byCategory)) {
    logProgress(`  ${cat}: ${s.pass} pass / ${s.fail} fail`)
  }
  if (stats.errors.length > 0) {
    logProgress(`Failures (first 30):`)
    for (const e of stats.errors.slice(0, 30)) {
      logProgress(`  [${e.category}] ${e.name}: ${e.detail}`)
    }
  }

  try {
    fs.writeFileSync(path.join(__dirname, 'r6-results.json'), JSON.stringify({ ...stats, realErrs }, null, 2))
  } catch {}

  c.close()
}

main().catch(e => { logProgress('FATAL: ' + e.message); logProgress(e.stack || ''); process.exit(1) })
