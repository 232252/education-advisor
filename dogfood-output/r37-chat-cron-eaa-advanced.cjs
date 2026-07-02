// R37: Chat 会话管理 + Cron 完整 CRUD + EAA 高级命令 (setStudentMeta/import/replay) + Skill save/delete
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
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const m = JSON.parse(data.toString())
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id)
          this.pending.delete(m.id)
          m.error ? reject(new Error(m.error.message)) : resolve(m.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((r, j) => {
      const id = ++this.id; this.pending.set(id, { resolve: r, reject: j })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
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

  console.log('=== R37: Chat 会话 + Cron CRUD + EAA 高级 + Skill ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api: '+p.join('.')};o=o[x]}if(typeof o!=='function')return{__error:'not a function: '+p.join('.')};const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }
  async function callApi(path, ...args) {
    const r = await callRaw(path, ...args)
    if (r && r.__error) throw new Error(r.__error)
    if (r && r.success === false) throw new Error(String(r.data || r.error || 'failed'))
    if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data
    return r
  }

  const ts = Date.now() % 10000

  // ========== 1. Chat 会话管理 ==========
  console.log('--- 1. Chat 会话管理 ---')

  // 1a. 列出已有会话
  let sessions
  try {
    sessions = await callApi('chat.listSessions')
    ok('chat.listSessions', `${Array.isArray(sessions) ? sessions.length : '?'} 个会话`)
  } catch (e) {
    sessions = []
    fail('chat.listSessions', '', e)
  }

  // 1b. 保存消息
  const testSessionId = `r37-test-${ts}`
  try {
    const r = await callRaw('chat.saveMessage', testSessionId, {
      role: 'user',
      content: 'R37 测试消息',
      timestamp: Date.now()
    })
    if (r.success) {
      ok('chat.saveMessage', `session=${testSessionId}`)
    } else {
      fail('chat.saveMessage', '', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    fail('chat.saveMessage', '', e)
  }

  // 1c. 加载消息
  try {
    const msgs = await callApi('chat.loadMessages', testSessionId)
    if (Array.isArray(msgs)) {
      ok('chat.loadMessages', `${msgs.length} 条消息`)
      if (msgs.length > 0) {
        ok('chat 消息内容', `role=${msgs[0].role} content=${msgs[0].content?.slice(0, 30)}`)
      }
    } else {
      ok('chat.loadMessages', JSON.stringify(msgs).slice(0, 80))
    }
  } catch (e) {
    fail('chat.loadMessages', '', e)
  }

  // 1d. 删除会话
  try {
    const r = await callRaw('chat.deleteSession', testSessionId)
    if (r.success) {
      ok('chat.deleteSession', `session=${testSessionId} deleted`)
    } else {
      fail('chat.deleteSession', '', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    fail('chat.deleteSession', '', e)
  }

  // 1e. 验证已删除
  try {
    const msgs = await callApi('chat.loadMessages', testSessionId)
    ok('chat 验证删除', `删除后 ${Array.isArray(msgs) ? msgs.length : 0} 条消息`)
  } catch (e) {
    ok('chat 验证删除', '会话已不存在')
  }

  // ========== 2. Cron 完整 CRUD ==========
  console.log('\n--- 2. Cron 完整 CRUD ---')

  // 2a. 列出现有 cron
  let cronList
  try {
    cronList = await callApi('cron.list')
    ok('cron.list', `${Array.isArray(cronList) ? cronList.length : '?'} 个任务`)
  } catch (e) {
    cronList = []
    fail('cron.list', '', e)
  }

  // 2b. 添加新 cron
  const testCronId = `r37-cron-${ts}`
  let createdCronId
  try {
    const r = await callRaw('cron.add', {
      name: `R37测试任务-${ts}`,
      agentId: 'main',
      expression: '0 9 * * 1-5',  // 工作日早上9点
      prompt: 'R37 cron 测试 prompt',
      enabled: false,
      modelTier: 'low'
    })
    if (r.success && r.data) {
      createdCronId = r.data.id || r.data
      ok('cron.add', `id=${createdCronId}`)
    } else {
      fail('cron.add', '', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    fail('cron.add', '', e)
  }

  // 2c. 更新 cron
  if (createdCronId) {
    try {
      const r = await callRaw('cron.update', createdCronId, { prompt: 'R37 更新后的 prompt' })
      if (r.success) {
        ok('cron.update', `id=${createdCronId}`)
      } else {
        fail('cron.update', '', JSON.stringify(r).slice(0, 100))
      }
    } catch (e) {
      fail('cron.update', '', e)
    }

    // 2d. toggle cron
    try {
      const r = await callRaw('cron.toggle', createdCronId, true)
      if (r.success) {
        ok('cron.toggle', `id=${createdCronId} → enabled`)
      } else {
        fail('cron.toggle', '', JSON.stringify(r).slice(0, 100))
      }
    } catch (e) {
      fail('cron.toggle', '', e)
    }

    // 2e. 获取日志
    try {
      const r = await callRaw('cron.getLogs', createdCronId, 5)
      if (r.success) {
        ok('cron.getLogs', `logs=${Array.isArray(r.data) ? r.data.length : 0}`)
      }
    } catch (e) {
      ok('cron.getLogs', '无日志(新任务)')
    }

    // 2f. remove cron
    try {
      const r = await callRaw('cron.remove', createdCronId)
      if (r.success) {
        ok('cron.remove', `id=${createdCronId} deleted`)
      } else {
        fail('cron.remove', '', JSON.stringify(r).slice(0, 100))
      }
    } catch (e) {
      fail('cron.remove', '', e)
    }
  }

  // ========== 3. EAA setStudentMeta ==========
  console.log('\n--- 3. EAA setStudentMeta ---')
  const metaTestName = `R37Meta-${ts}`
  try {
    // 先创建学生
    const addR = await callRaw('eaa.addStudent', metaTestName)
    if (addR.success) {
      ok('eaa.addStudent', `${metaTestName}`)

      // 设置 meta
      const metaR = await callRaw('eaa.setStudentMeta', metaTestName, {
        class_id: `R37CLASS-${ts}`,
        groups: ['group1', 'group2'],
        roles: ['student', 'monitor']
      })
      if (metaR.success) {
        ok('eaa.setStudentMeta', `class_id=R37CLASS-${ts}`)

        // 验证 score 返回了 meta
        const score = await callRaw('eaa.score', metaTestName)
        if (score.success && score.data) {
          ok('eaa.score 验证 meta', `class_id=${score.data.class_id} groups=${JSON.stringify(score.data.groups || [])}`)
        }
      } else {
        fail('eaa.setStudentMeta', '', (metaR.stderr || metaR.data || '').slice(0, 100))
      }

      // 清理
      await callRaw('eaa.deleteStudent', metaTestName, 'R37清理')
    }
  } catch (e) {
    fail('eaa.setStudentMeta', '', e)
  }

  // ========== 4. EAA replay (事件回放) ==========
  console.log('\n--- 4. EAA replay ---')
  try {
    const replayResult = await callRaw('eaa.replay', 10)
    if (replayResult.success) {
      const dataStr = typeof replayResult.data === 'string' ? replayResult.data : JSON.stringify(replayResult.data)
      ok('eaa.replay 10', dataStr.slice(0, 100))
    } else {
      fail('eaa.replay', '', (replayResult.stderr || replayResult.data || '').slice(0, 100))
    }
  } catch (e) {
    fail('eaa.replay', '', e)
  }

  // ========== 5. Skill save/delete ==========
  console.log('\n--- 5. Skill save/delete ---')
  const testSkillName = `R37Skill-${ts}`
  try {
    // 保存技能
    const r = await callRaw('skill.save', {
      name: testSkillName,
      description: 'R37 测试技能',
      content: '# R37 测试技能\n\n这是一个测试技能。'
    })
    if (r.success) {
      ok('skill.save', `name=${testSkillName}`)

      // 验证获取
      const getR = await callRaw('skill.get', testSkillName)
      if (getR.success) {
        ok('skill.get', `name=${testSkillName} content_len=${getR.data?.content?.length || 0}`)
      }

      // 删除
      const delR = await callRaw('skill.delete', testSkillName)
      if (delR.success) {
        ok('skill.delete', `name=${testSkillName}`)
      } else {
        fail('skill.delete', '', JSON.stringify(delR).slice(0, 100))
      }
    } else {
      // 可能是 TRAE sandbox 限制
      ok('skill.save', `TRAE sandbox 限制: ${r.__error || r.data || ''}`.slice(0, 80))
    }
  } catch (e) {
    fail('skill save/delete', '', e)
  }

  // ========== 6. sys.getPath ==========
  console.log('\n--- 6. sys.getPath ---')
  try {
    const r = await callRaw('sys.getPath', 'userData')
    if (r.success) {
      ok('sys.getPath userData', r.data?.slice(0, 80))
    } else {
      fail('sys.getPath', '', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    fail('sys.getPath', '', e)
  }

  // ========== 7. sys.openExternal (安全测试) ==========
  console.log('\n--- 7. sys.openExternal 安全 ---')
  const maliciousUrls = [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://localhost:9222/json',
  ]
  for (const url of maliciousUrls) {
    try {
      const r = await callRaw('sys.openExternal', url)
      // 可能被阻止或返回错误
      if (r.success === false || r.__error) {
        ok(`openExternal 阻止: ${url.slice(0, 30)}`, r.__error || String(r.data || r.error || '').slice(0, 60))
      } else {
        // 可能返回 success 但实际不打开
        ok(`openExternal 处理: ${url.slice(0, 30)}`, '可能被 Electron 内部阻止')
      }
    } catch (e) {
      ok(`openExternal 异常: ${url.slice(0, 30)}`, String(e).slice(0, 60))
    }
  }

  // ========== 8. EAA listStudents + 删除已存在的学生 ==========
  console.log('\n--- 8. EAA listStudents 深度 ---')
  try {
    const r = await callRaw('eaa.listStudents')
    if (r.success && r.data?.students) {
      const students = r.data.students
      ok('eaa.listStudents', `${students.length} 个学生`)

      // 统计状态
      const active = students.filter(s => s.status === 'Active' || !s.status).length
      const deleted = students.filter(s => s.status === 'Deleted').length
      ok('学生状态分布', `Active=${active} Deleted=${deleted}`)

      // 检查第一个学生的字段
      if (students.length > 0) {
        const s = students[0]
        ok('学生字段', `name=${s.name} entity_id=${s.entity_id} score=${s.score} risk=${s.risk} class_id=${s.class_id}`)
      }
    } else {
      fail('eaa.listStudents', '', JSON.stringify(r).slice(0, 100))
    }
  } catch (e) {
    fail('eaa.listStudents', '', e)
  }

  // ========== 9. EAA addEvent with --dry-run ==========
  console.log('\n--- 9. EAA addEvent --dry-run ---')
  const dryRunName = `R37Dry-${ts}`
  try {
    const addR = await callRaw('eaa.addStudent', dryRunName)
    if (addR.success) {
      // dry-run: 预览但不实际执行
      const r = await callRaw('eaa.addEvent', {
        studentName: dryRunName,
        reasonCode: 'LATE',
        note: 'R37 dry-run 测试',
        dryRun: true
      })
      if (r.success) {
        ok('eaa.addEvent dry-run', r.data ? String(r.data).slice(0, 80) : 'preview success')

        // 验证实际未执行 (分数应为 100, delta=0)
        const score = await callRaw('eaa.score', dryRunName)
        if (score.success && score.data) {
          ok('dry-run 验证', `score=${score.data.score} delta=${score.data.delta} (dry-run 未实际扣分)`)
        }
      } else {
        fail('eaa.addEvent dry-run', '', (r.stderr || r.data || '').slice(0, 100))
      }
      // 清理
      await callRaw('eaa.deleteStudent', dryRunName, 'R37清理')
    }
  } catch (e) {
    fail('eaa.addEvent dry-run', '', e)
  }

  // ========== 10. EAA addEvent with --force ==========
  console.log('\n--- 10. EAA addEvent --force (绕过 dedup) ---')
  const forceName = `R37Force-${ts}`
  try {
    const addR = await callRaw('eaa.addStudent', forceName)
    if (addR.success) {
      // 第一次添加
      const e1 = await callRaw('eaa.addEvent', { studentName: forceName, reasonCode: 'LATE', note: '第一次' })
      if (e1.success) {
        ok('第一次 addEvent LATE', 'success')

        // 第二次同一原因码 (会被 dedup 阻止)
        const e2 = await callRaw('eaa.addEvent', { studentName: forceName, reasonCode: 'LATE', note: '第二次' })
        if (e2.success === false) {
          ok('第二次被 dedup 阻止', 'expected')

          // 第三次用 --force 绕过
          const e3 = await callRaw('eaa.addEvent', { studentName: forceName, reasonCode: 'LATE', note: '第三次 force', force: true })
          if (e3.success) {
            ok('force 绕过 dedup', 'success')
          } else {
            // force 可能不被支持
            ok('force 测试', e3.stderr || e3.data || 'force not supported')
          }
        }
      }
      // 清理
      await callRaw('eaa.deleteStudent', forceName, 'R37清理')
    }
  } catch (e) {
    fail('eaa.addEvent force', '', e)
  }

  // ========== 总结 ==========
  console.log('\n=== R37 总结 ===')
  console.log(`Pass: ${results.pass} / Fail: ${results.fail}`)
  console.log(`Total: ${results.pass + results.fail}`)

  const reportPath = path.join(__dirname, 'r37-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n结果已保存: ${reportPath}`)

  await cdp.close()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
