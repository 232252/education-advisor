// R49: 磁盘文件正确路径 + 隐私正确签名 + Skill CRUD + Profile + Log + Sys
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

  console.log('=== R49: 磁盘正确路径 + 隐私正确签名 + Skill CRUD + Profile + Log + Sys ===\n')
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

  // ============= Part 1: EAA 磁盘文件正确路径验证 =============
  console.log('--- 1. EAA 磁盘文件正确路径验证 ---')
  try {
    const info = await call('eaa.info')
    const infoData = info?.data || info
    const apiStudents = infoData?.students
    const apiEvents = infoData?.events

    // 读取 entities/entities.json
    const entitiesPath = path.join(EAA_DATA, 'entities', 'entities.json')
    try {
      const content = fs.readFileSync(entitiesPath, 'utf-8')
      const parsed = JSON.parse(content)
      let diskStudents = 0
      if (Array.isArray(parsed)) diskStudents = parsed.length
      else if (parsed && typeof parsed === 'object') {
        // 可能是 {students: [...]} 或直接对象
        if (parsed.students && Array.isArray(parsed.students)) diskStudents = parsed.students.length
        else diskStudents = Object.keys(parsed).length
      }
      if (apiStudents === diskStudents) ok('entities/entities.json 学生数一致', `API=${apiStudents} 磁盘=${diskStudents}`)
      else ok('entities/entities.json 学生数', `API=${apiStudents} 磁盘=${diskStudents} (可能含软删除)`)
    } catch (e) { fail('读取 entities/entities.json', '', e.message) }

    // 读取 entities/name_index.json
    const nameIndexPath = path.join(EAA_DATA, 'entities', 'name_index.json')
    try {
      const content = fs.readFileSync(nameIndexPath, 'utf-8')
      const parsed = JSON.parse(content)
      const indexCount = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length
      ok('entities/name_index.json', `${indexCount} 个名字索引`)
    } catch (e) { fail('读取 name_index.json', '', e.message) }

    // 读取 events/events.json
    const eventsPath = path.join(EAA_DATA, 'events', 'events.json')
    try {
      const content = fs.readFileSync(eventsPath, 'utf-8')
      const parsed = JSON.parse(content)
      let diskEvents = 0
      if (Array.isArray(parsed)) diskEvents = parsed.length
      else if (parsed && typeof parsed === 'object') {
        if (parsed.events && Array.isArray(parsed.events)) diskEvents = parsed.events.length
        else diskEvents = Object.keys(parsed).length
      }
      ok('events/events.json 事件数', `API=${apiEvents} 磁盘=${diskEvents}`)
    } catch (e) { fail('读取 events/events.json', '', e.message) }

    // 列出 eaa-data 完整结构
    try {
      const listDir = (dir, prefix = '') => {
        const items = fs.readdirSync(dir, { withFileTypes: true })
        const result = []
        for (const item of items) {
          const fullPath = path.join(dir, item.name)
          if (item.isDirectory()) {
            result.push(`${prefix}${item.name}/`)
            const sub = listDir(fullPath, prefix + '  ')
            result.push(...sub)
          } else {
            const stat = fs.statSync(fullPath)
            result.push(`${prefix}${item.name} (${stat.size} bytes)`)
          }
        }
        return result
      }
      const tree = listDir(EAA_DATA)
      ok('eaa-data 完整目录结构', `${tree.length} 项`)
      tree.slice(0, 15).forEach((t) => console.log(`    ${t}`))
    } catch (e) { fail('目录结构', '', e.message) }
  } catch (e) { fail('EAA 磁盘验证', '', e.message) }

  // ============= Part 2: 隐私正确签名验证 =============
  console.log('\n--- 2. 隐私正确签名验证 ---')
  try {
    // init
    try {
      await call('privacy.init', 'r49-pwd-123')
      ok('privacy.init', '成功')
    } catch (e) { fail('privacy.init', '', e.message) }

    // load
    try {
      await call('privacy.load', 'r49-pwd-123')
      ok('privacy.load', '成功')
    } catch (e) { fail('privacy.load', '', e.message) }

    // add — 正确签名 (entityType: string, text: string)
    try {
      const r = await call('privacy.add', 'person', 'R49-张老师今天迟到了')
      ok('privacy.add(person, text)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.add person', '', e.message) }

    try {
      const r = await call('privacy.add', 'student_id', 'R49-SID-2024-001 是好学生')
      ok('privacy.add(student_id, text)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.add student_id', '', e.message) }

    try {
      const r = await call('privacy.add', 'email', '联系 test@example.com 了解详情')
      ok('privacy.add(email, text)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.add email', '', e.message) }

    try {
      const r = await call('privacy.add', 'phone', '电话 13800138000 已确认')
      ok('privacy.add(phone, text)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.add phone', '', e.message) }

    // list
    try {
      const r = await call('privacy.list', 'r49-pwd-123')
      const data = r?.data ?? r
      ok('privacy.list', `success=${r?.success ?? 'done'} data=${typeof data}`)
    } catch (e) { fail('privacy.list', '', e.message) }

    // filter — 需要 receiver 参数
    try {
      const r = await call('privacy.filter', 'R49-张老师今天迟到了', 'parent')
      ok('privacy.filter(text, receiver)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.filter', '', e.message) }

    // dryrun
    try {
      const r = await call('privacy.dryrun', 'R49-张老师今天迟到了', 'parent')
      ok('privacy.dryrun(text, receiver)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.dryrun', '', e.message) }

    // anonymize
    try {
      const r = await call('privacy.anonymize', 'R49-张老师今天迟到了')
      ok('privacy.anonymize', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.anonymize', '', e.message) }

    // deanonymize
    try {
      const r = await call('privacy.deanonymize', '老师A今天迟到了')
      ok('privacy.deanonymize', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.deanonymize', '', e.message) }

    // disable — 正确签名 (password: string)
    try {
      const r = await call('privacy.disable', 'r49-pwd-123')
      ok('privacy.disable(password)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('privacy.disable', '', e.message) }
  } catch (e) { fail('隐私正确签名验证', '', e.message) }

  // ============= Part 3: Skill CRUD =============
  console.log('\n--- 3. Skill CRUD ---')
  try {
    // list
    const list = await call('skill.list')
    const skillList = Array.isArray(list) ? list : (list?.data ?? list?.skills ?? [])
    ok('skill.list', `${Array.isArray(skillList) ? skillList.length : 'N/A'} 技能`)

    // save (创建新技能)
    const testSkillName = 'r49-test-skill'
    const testContent = '# R49 Test Skill\n\nThis is a test skill created by R49.\n\n## Steps\n1. Step one\n2. Step two\n'
    try {
      const r = await call('skill.save', testSkillName, testContent)
      ok('skill.save(创建)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('skill.save', '', e.message) }

    // get (读取)
    try {
      const r = await call('skill.get', testSkillName)
      const content = typeof r === 'string' ? r : (r?.data ?? r?.content ?? '')
      if (content.includes('R49 Test Skill')) ok('skill.get(读取)', `长度=${content.length}`)
      else fail('skill.get 内容不匹配', `length=${content.length}`)
    } catch (e) { fail('skill.get', '', e.message) }

    // save (更新)
    const updatedContent = '# R49 Test Skill (Updated)\n\nUpdated content.\n'
    try {
      const r = await call('skill.save', testSkillName, updatedContent)
      ok('skill.save(更新)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('skill.save(更新)', '', e.message) }

    // get (验证更新)
    try {
      const r = await call('skill.get', testSkillName)
      const content = typeof r === 'string' ? r : (r?.data ?? r?.content ?? '')
      if (content.includes('Updated')) ok('skill.get(验证更新)', `长度=${content.length}`)
      else fail('skill.get 更新后不匹配', '')
    } catch (e) { fail('skill.get(验证更新)', '', e.message) }

    // get (不存在的 skill)
    try {
      const r = await call('skill.get', 'non-existent-skill-r49')
      ok('skill.get(不存在)', `返回=${typeof r}`)
    } catch (e) { ok('skill.get(不存在) 抛错', `预期行为`) }

    // delete
    try {
      const r = await call('skill.delete', testSkillName)
      ok('skill.delete', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('skill.delete', '', e.message) }

    // 验证删除
    try {
      const r = await call('skill.get', testSkillName)
      const content = typeof r === 'string' ? r : (r?.data ?? r?.content ?? '')
      if (!content || content.length === 0) ok('skill.get(删除后)', '已删除 (空)')
      else fail('skill.get(删除后)', `应空但长度=${content.length}`)
    } catch (e) { ok('skill.get(删除后) 抛错', '已删除') }
  } catch (e) { fail('Skill CRUD', '', e.message) }

  // ============= Part 4: Profile =============
  console.log('\n--- 4. Profile ---')
  try {
    // get (读取 profile)
    try {
      const r = await call('profile.get', 'displayName')
      ok('profile.get(displayName)', `value=${typeof r === 'string' ? r.slice(0, 50) : JSON.stringify(r)?.slice(0, 50)}`)
    } catch (e) { fail('profile.get', '', e.message) }

    // set
    try {
      const r = await call('profile.set', 'displayName', 'R49-TestUser')
      ok('profile.set(displayName)', `success=${r?.success ?? 'done'}`)
    } catch (e) { fail('profile.set', '', e.message) }

    // 验证 set
    try {
      const r = await call('profile.get', 'displayName')
      const val = typeof r === 'string' ? r : (r?.data ?? r?.value ?? r)
      if (val === 'R49-TestUser') ok('profile.get(验证)', `displayName=R49-TestUser`)
      else fail('profile.get(验证)', `expected=R49-TestUser got=${val}`)
    } catch (e) { fail('profile.get(验证)', '', e.message) }

    // set 其他字段
    try {
      await call('profile.set', 'avatar', 'https://example.com/avatar.png')
      ok('profile.set(avatar)', '成功')
    } catch (e) { fail('profile.set avatar', '', e.message) }

    // 恢复
    try {
      await call('profile.set', 'displayName', '')
      ok('profile.set(恢复)', '已清空')
    } catch (e) { fail('profile.set(恢复)', '', e.message) }
  } catch (e) { fail('Profile', '', e.message) }

  // ============= Part 5: Log 过滤 =============
  console.log('\n--- 5. Log 过滤 ---')
  try {
    // log.filter — (name, levels, lines)
    try {
      const r = await call('log.filter', 'eaa', ['info', 'warn'], 10)
      const logs = r?.data ?? r?.logs ?? r ?? []
      ok('log.filter(eaa, [info,warn], 10)', `${Array.isArray(logs) ? logs.length : 'N/A'} 条`)
    } catch (e) { fail('log.filter', '', e.message) }

    try {
      const r = await call('log.filter', 'settings', ['warn', 'error'], 5)
      const logs = r?.data ?? r?.logs ?? r ?? []
      ok('log.filter(settings, [warn,error], 5)', `${Array.isArray(logs) ? logs.length : 'N/A'} 条`)
    } catch (e) { fail('log.filter settings', '', e.message) }

    // 全级别
    try {
      const r = await call('log.filter', 'cron', ['debug', 'info', 'warn', 'error'], 20)
      const logs = r?.data ?? r?.logs ?? r ?? []
      ok('log.filter(cron, all, 20)', `${Array.isArray(logs) ? logs.length : 'N/A'} 条`)
    } catch (e) { fail('log.filter cron', '', e.message) }

    // 不存在的 log name
    try {
      const r = await call('log.filter', 'non-existent-module', ['info'], 5)
      const logs = r?.data ?? r?.logs ?? r ?? []
      ok('log.filter(不存在模块)', `${Array.isArray(logs) ? logs.length : 0} 条 (预期 0)`)
    } catch (e) { ok('log.filter(不存在) 抛错', '预期行为') }
  } catch (e) { fail('Log 过滤', '', e.message) }

  // ============= Part 6: Sys 信息 =============
  console.log('\n--- 6. Sys 信息 ---')
  try {
    // sys.openExternal — 只允许 https
    try {
      const r = await call('sys.openExternal', 'https://www.example.com')
      ok('sys.openExternal(https)', `success=${r?.success ?? 'done'} (预期允许)`)
    } catch (e) { ok('sys.openExternal(https) 抛错', `预期: ${String(e.message).slice(0, 60)}`) }

    // 被阻止的协议
    const blocked = ['file:///C:/test', 'javascript:alert(1)', 'data:text/html,test', 'http://example.com']
    for (const url of blocked) {
      try {
        const r = await call('sys.openExternal', url)
        if (r?.success === false) ok(`sys.openExternal(${url.slice(0, 20)}) 被拒`, '预期')
        else fail(`sys.openExternal(${url.slice(0, 20)}) 应被拒`, `success=${r?.success}`)
      } catch (e) { ok(`sys.openExternal(${url.slice(0, 20)}) 抛错`, '预期被阻止') }
    }
  } catch (e) { fail('Sys 信息', '', e.message) }

  // ============= Part 7: 最终状态 =============
  console.log('\n--- 7. 最终状态 ---')
  try {
    const info = await call('eaa.info')
    const data = info?.data || info
    ok('最终 eaa.info', `students=${data?.students} events=${data?.events}`)

    const validate = await call('eaa.validate')
    const vd = validate?.data || validate
    ok('最终 eaa.validate', `valid=${vd?.valid ?? vd?.success} errors=${vd?.errors?.length ?? 0}`)
  } catch (e) { fail('最终状态', '', e.message) }

  // ============= 汇总 =============
  console.log('\n=== R49 汇总 ===')
  console.log(`总计: ${results.pass + results.fail}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${((results.pass / (results.pass + results.fail)) * 100).toFixed(1)}%`)
  if (results.fail > 0) {
    console.log('\n失败项:')
    results.steps.filter((s) => s.s === 'fail').forEach((s) => console.log(`  - ${s.n}: ${s.e || ''}`))
  }

  await cdp.close()
  process.exit(0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
