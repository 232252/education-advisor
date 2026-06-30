// =============================================================
// 第五轮:压力测试 + 边界测试
// 1. 快速切换页面 20 轮,检测内存泄漏和错误
// 2. 边界输入:空/特殊字符/超长字符串/非法值
// =============================================================
const http = require('http')
const WebSocket = require('ws')

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('timeout')))
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
    await this.send('Runtime.enable')
    await this.send('Log.enable')
    this.errors = []
    this.ws.on('message', msg => {
      const obj = JSON.parse(msg)
      if (obj.method === 'Log.entryAdded' && obj.params?.entry?.level === 'error') {
        this.errors.push(obj.params.entry.text)
      }
      if (obj.method === 'Runtime.consoleAPICalled' && obj.params?.type === 'error') {
        this.errors.push(obj.params.args?.map(a => a.value || a.description).join(' '))
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
  async navigate(hash) {
    await this.eval(`window.location.hash = '${hash}'`)
    await new Promise(r => setTimeout(r, 500))
  }
  close() { if (this.ws) this.ws.close() }
}

async function main() {
  const cdp = new CDPClient()
  await cdp.connect()
  console.log('CDP connected. Stress + edge case tests...\n')

  async function callApi(path, ...args) {
    return cdp.eval(`(async () => {
      const parts = ${JSON.stringify(path)}.split('.')
      let obj = window.api
      for (const p of parts) obj = obj[p]
      const args = ${JSON.stringify(args)}
      return await obj(...args)
    })()`)
  }

  // =========================================================
  // 1. 压力测试:快速切换页面 20 轮
  // =========================================================
  console.log('=== 1. 压力测试:页面切换 20 轮 ===')
  const pages = ['#/dashboard', '#/chat', '#/students', '#/classes', '#/agents',
                 '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings']

  const errorsBefore = cdp.errors.length
  const memBefore = await cdp.eval('performance.memory ? performance.memory.usedJSHeapSize : null')
  console.log(`  Memory before: ${memBefore ? (memBefore / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'}`)

  const startTime = Date.now()
  for (let round = 0; round < 20; round++) {
    for (const page of pages) {
      await cdp.navigate(page)
    }
    if ((round + 1) % 5 === 0) {
      const mem = await cdp.eval('performance.memory ? performance.memory.usedJSHeapSize : null')
      console.log(`  Round ${round + 1}/20 done, memory: ${mem ? (mem / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'}, errors: ${cdp.errors.length - errorsBefore}`)
    }
  }
  const elapsed = Date.now() - startTime
  const memAfter = await cdp.eval('performance.memory ? performance.memory.usedJSHeapSize : null')
  const errorsAfter = cdp.errors.length

  console.log(`\n  Stress test complete:`)
  console.log(`  Time: ${(elapsed / 1000).toFixed(1)}s for 200 page switches`)
  console.log(`  Memory: ${memBefore ? (memBefore / 1024 / 1024).toFixed(1) : '?'} MB → ${memAfter ? (memAfter / 1024 / 1024).toFixed(1) : '?'} MB`)
  console.log(`  Memory delta: ${memBefore && memAfter ? ((memAfter - memBefore) / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'}`)
  console.log(`  Errors: ${errorsAfter - errorsBefore}`)
  if (cdp.errors.slice(errorsBefore).length > 0) {
    cdp.errors.slice(errorsBefore).slice(0, 5).forEach(e => console.log(`    - ${e.slice(0, 120)}`))
  }

  // =========================================================
  // 2. 边界测试:EAA addStudent
  // =========================================================
  console.log('\n=== 2. 边界测试: EAA addStudent ===')

  // 2.1 空姓名
  const emptyName = await callApi('eaa.addStudent', '')
  console.log('  Empty name:', JSON.stringify(emptyName).slice(0, 150))

  // 2.2 超长姓名(>64 字符)
  const longName = '超'.repeat(100)
  const longNameRes = await callApi('eaa.addStudent', longName)
  console.log('  Long name (100 chars):', JSON.stringify(longNameRes).slice(0, 150))

  // 2.3 特殊字符(命令注入尝试)
  const injectName = 'test; rm -rf /'
  const injectRes = await callApi('eaa.addStudent', injectName)
  console.log('  Injection attempt:', JSON.stringify(injectRes).slice(0, 150))

  // 2.4 NUL 字节
  const nulName = 'test\x00evil'
  const nulRes = await callApi('eaa.addStudent', nulName)
  console.log('  NUL byte:', JSON.stringify(nulRes).slice(0, 150))

  // 2.5 正常中文姓名
  const normalName = '边界测试学生_' + Date.now()
  const normalRes = await callApi('eaa.addStudent', normalName)
  console.log('  Normal Chinese name:', JSON.stringify(normalRes).slice(0, 150))

  // 清理
  if (normalRes.success !== false) await callApi('eaa.deleteStudent', normalName, 'cleanup')

  // =========================================================
  // 3. 边界测试:EAA addEvent
  // =========================================================
  console.log('\n=== 3. 边界测试: EAA addEvent ===')
  const eventStudent = '__event_edge_' + Date.now()
  await callApi('eaa.addStudent', eventStudent)

  // 3.1 不存在的 reasonCode
  const badCode = await callApi('eaa.addEvent', {
    studentName: eventStudent,
    reasonCode: 'NONEXISTENT_CODE',
    note: '不存在的码',
  })
  console.log('  Nonexistent reasonCode:', JSON.stringify(badCode).slice(0, 150))

  // 3.2 delta 与标准值不匹配
  const mismatchDelta = await callApi('eaa.addEvent', {
    studentName: eventStudent,
    reasonCode: 'LATE',
    delta: 999,
    note: '错误分值',
  })
  console.log('  Mismatched delta:', JSON.stringify(mismatchDelta).slice(0, 150))

  // 3.3 不存在的学生
  const ghostStudent = await callApi('eaa.addEvent', {
    studentName: '不存在的学生xyz',
    reasonCode: 'LATE',
    note: '测试',
  })
  console.log('  Nonexistent student:', JSON.stringify(ghostStudent).slice(0, 150))

  // 3.4 空备注
  const noNote = await callApi('eaa.addEvent', {
    studentName: eventStudent,
    reasonCode: 'LATE',
  })
  console.log('  No note:', JSON.stringify(noNote).slice(0, 150))

  // 清理
  await callApi('eaa.deleteStudent', eventStudent, 'cleanup')

  // =========================================================
  // 4. 边界测试:Class create
  // =========================================================
  console.log('\n=== 4. 边界测试: Class create ===')

  // 4.1 空class_id
  const emptyClassId = await callApi('class.create', { class_id: '', name: '测试' })
  console.log('  Empty class_id:', JSON.stringify(emptyClassId).slice(0, 150))

  // 4.2 非法字符的 class_id (下划线)
  const badClassId = await callApi('class.create', { class_id: 'test_123', name: '测试' })
  console.log('  Underscore class_id:', JSON.stringify(badClassId).slice(0, 150))

  // 4.3 空名称
  const emptyName2 = await callApi('class.create', { class_id: 'TEST-EDGE', name: '' })
  console.log('  Empty name:', JSON.stringify(emptyName2).slice(0, 150))

  // 4.4 重复创建
  await callApi('class.create', { class_id: 'TEST-DUP', name: '重复测试1' })
  const dupRes = await callApi('class.create', { class_id: 'TEST-DUP', name: '重复测试2' })
  console.log('  Duplicate class_id:', JSON.stringify(dupRes).slice(0, 150))
  // 清理
  const classList = await callApi('class.list')
  if (classList.data) {
    const dup = classList.data.find(c => c.class_id === 'TEST-DUP')
    if (dup) await callApi('class.delete', dup.id)
  }

  // =========================================================
  // 5. 边界测试:Skill save
  // =========================================================
  console.log('\n=== 5. 边界测试: Skill save ===')

  // 5.1 空内容
  const emptySkill = await callApi('skill.save', '__empty_skill__', '')
  console.log('  Empty content:', JSON.stringify(emptySkill).slice(0, 150))

  // 5.2 非法技能名(含路径分隔符)
  const badSkillName = await callApi('skill.save', '../etc/passwd', '恶意内容')
  console.log('  Path traversal name:', JSON.stringify(badSkillName).slice(0, 150))

  // 5.3 超长内容
  const longContent = '# Test\n' + 'A'.repeat(100000)
  const longSkill = await callApi('skill.save', '__long_skill__', longContent)
  console.log('  Long content (100KB):', JSON.stringify(longSkill).slice(0, 150))

  // 清理
  await callApi('skill.delete', '__empty_skill__')
  await callApi('skill.delete', '__long_skill__')

  // =========================================================
  // 6. 边界测试:Privacy
  // =========================================================
  console.log('\n=== 6. 边界测试: Privacy ===')

  // 6.1 短密码(<4位)
  const shortPwd = await callApi('privacy.init', 'ab', false)
  console.log('  Short password:', JSON.stringify(shortPwd).slice(0, 150))

  // 6.2 空密码
  const emptyPwd = await callApi('privacy.init', '', false)
  console.log('  Empty password:', JSON.stringify(emptyPwd).slice(0, 150))

  // 6.3 空文本匿名化
  const emptyAnon = await callApi('privacy.anonymize', '')
  console.log('  Empty anonymize:', JSON.stringify(emptyAnon).slice(0, 150))

  // 6.4 非法 entityType
  const badType = await callApi('privacy.add', 'invalid_type', '测试')
  console.log('  Invalid entityType:', JSON.stringify(badType).slice(0, 150))

  // =========================================================
  // 7. 边界测试:Chat saveMessage
  // =========================================================
  console.log('\n=== 7. 边界测试: Chat saveMessage ===')

  // 7.1 空 sessionId
  const noSession = await callApi('chat.saveMessage', {
    role: 'user', content: 'test', timestamp: Date.now(),
  })
  console.log('  No sessionId:', JSON.stringify(noSession).slice(0, 150))

  // 7.2 空 content
  const emptyContent = await callApi('chat.saveMessage', {
    sessionId: 'test', role: 'user', content: '', timestamp: Date.now(),
  })
  console.log('  Empty content:', JSON.stringify(emptyContent).slice(0, 150))

  // 7.3 超长 content
  const longMsg = await callApi('chat.saveMessage', {
    sessionId: 'test_long', role: 'user', content: 'B'.repeat(100000), timestamp: Date.now(),
  })
  console.log('  Long content (100KB):', JSON.stringify(longMsg).slice(0, 150))

  // 清理
  await callApi('chat.deleteSession', 'test_long')

  // =========================================================
  // 汇总
  // =========================================================
  console.log('\n\n============================================================')
  console.log('STRESS + EDGE CASE TEST SUMMARY')
  console.log('============================================================')
  console.log(`  Page switches: 200 (20 rounds × 10 pages)`)
  console.log(`  Time: ${(elapsed / 1000).toFixed(1)}s`)
  console.log(`  Memory delta: ${memBefore && memAfter ? ((memAfter - memBefore) / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'}`)
  console.log(`  Errors during stress: ${errorsAfter - errorsBefore}`)

  const fs = require('fs')
  fs.writeFileSync('C:\\Users\\sq199\\Documents\\GitHub\\education-advisor\\dogfood-output\\test-results-round5-stress.json', JSON.stringify({
    stress: {
      pageSwitches: 200,
      timeMs: elapsed,
      memoryBefore: memBefore,
      memoryAfter: memAfter,
      memoryDeltaMB: memBefore && memAfter ? (memAfter - memBefore) / 1024 / 1024 : null,
      errors: errorsAfter - errorsBefore,
      errorSamples: cdp.errors.slice(errorsBefore, errorsBefore + 5),
    },
  }, null, 2))

  cdp.close()
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
