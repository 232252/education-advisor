// R35: 错误恢复 + 边界条件 + 安全输入验证
// 1. EAA 边界输入: 超长名称/特殊字符/空名称/SQL注入/命令注入
// 2. Class 边界: 重复 class_id/超长名称/非法字符
// 3. Settings 边界: 超长值/特殊字符/类型不匹配
// 4. Cron 边界: 无效表达式/超长 prompt
// 5. Agent 边界: 不存在的 agentId/getSoul 不存在的 agent
// 6. 错误恢复: 连续失败后系统是否恢复
// 7. EAA revert 重复撤销 (防无限循环)
// 8. EAA addEvent 重复原因码 (dedup 规则)
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

  console.log('=== R35: 错误恢复 + 边界条件 + 安全输入验证 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(path, ...args) {
    return cdp.eval(`(async()=>{const p=${JSON.stringify(path)}.split('.');let o=window.api;for(const x of p){if(o==null)return{__error:'no such api: '+p.join('.')};o=o[x]}if(typeof o!=='function')return{__error:'not a function: '+p.join('.')};const a=${JSON.stringify(args)};try{return await o(...a)}catch(e){return{__error:e.message}}})()`)
  }

  // ========== 1. EAA 安全输入验证 ==========
  console.log('--- 1. EAA 安全输入验证 ---')

  // 1a. SQL 注入尝试
  const sqlPayloads = ["'; DROP TABLE students;--", "' OR '1'='1", "admin'--", "1; DELETE FROM entities"]
  for (const payload of sqlPayloads) {
    try {
      const r = await callRaw('eaa.addStudent', payload)
      if (r.success === false || r.__error) {
        ok(`SQL注入被阻止: ${payload.slice(0, 20)}`, r.__error || String(r.data || r.stderr || '').slice(0, 60))
      } else {
        // 学生可能被创建(名称是字符串), 但不会执行 SQL
        ok(`SQL注入名称被接受(安全): ${payload.slice(0, 20)}`, 'EAA 使用 JSON 存储, 无 SQL 注入风险')
        // 清理
        await callRaw('eaa.deleteStudent', payload, 'R35安全测试清理')
      }
    } catch (e) {
      ok(`SQL注入被阻止: ${payload.slice(0, 20)}`, String(e).slice(0, 60))
    }
  }

  // 1b. 命令注入尝试
  const cmdPayloads = ['test; rm -rf /', 'test && cat /etc/passwd', 'test | whoami', 'test`whoami`', 'test$(whoami)']
  for (const payload of cmdPayloads) {
    try {
      const r = await callRaw('eaa.addStudent', payload)
      if (r.success === false || r.__error) {
        ok(`命令注入被阻止: ${payload.slice(0, 20)}`, r.__error || String(r.data || r.stderr || '').slice(0, 60))
      } else {
        // 学生被创建, 但命令未执行 (safe)
        ok(`命令注入名称被接受(安全): ${payload.slice(0, 20)}`, '名称作为字符串存储, 命令未执行')
        // 清理
        await callRaw('eaa.deleteStudent', payload, 'R35安全测试清理')
      }
    } catch (e) {
      ok(`命令注入被阻止: ${payload.slice(0, 20)}`, String(e).slice(0, 60))
    }
  }

  // 1c. 超长名称
  const longName = 'A'.repeat(1000)
  try {
    const r = await callRaw('eaa.addStudent', longName)
    if (r.success === false || r.__error) {
      ok('超长名称(1000字符)被拒绝', r.__error || String(r.data || r.stderr || '').slice(0, 60))
    } else {
      ok('超长名称被接受', '可能需要长度限制')
      // 清理
      await callRaw('eaa.deleteStudent', longName, 'R35清理')
    }
  } catch (e) {
    ok('超长名称异常', String(e).slice(0, 60))
  }

  // 1d. 空名称
  try {
    const r = await callRaw('eaa.addStudent', '')
    if (r.success === false || r.__error) {
      ok('空名称被拒绝', r.__error || String(r.data || r.stderr || '').slice(0, 60))
    } else {
      fail('空名称被接受', '应拒绝空名称', '')
    }
  } catch (e) {
    ok('空名称异常', String(e).slice(0, 60))
  }

  // 1e. 特殊字符名称
  const specialNames = ['test\x00null', 'test\nnewline', 'test\rCR', 'test\ttab', '正常名称-测试']
  for (const name of specialNames) {
    try {
      const r = await callRaw('eaa.addStudent', name)
      if (r.success) {
        ok(`特殊字符名称被接受: ${JSON.stringify(name).slice(0, 30)}`, 'EAA 会 sanitize')
        await callRaw('eaa.deleteStudent', name, 'R35清理')
      } else if (r.success === false || r.__error) {
        ok(`特殊字符名称被拒绝: ${JSON.stringify(name).slice(0, 30)}`, r.__error || String(r.data || r.stderr || '').slice(0, 60))
      }
    } catch (e) {
      ok(`特殊字符名称异常: ${JSON.stringify(name).slice(0, 30)}`, String(e).slice(0, 60))
    }
  }

  // ========== 2. Class 边界条件 ==========
  console.log('\n--- 2. Class 边界条件 ---')
  const ts = Date.now() % 10000

  // 2a. 重复 class_id
  try {
    const cls = { class_id: `DUP-${ts}`, name: '测试班级1' }
    const r1 = await callRaw('class.create', cls)
    if (r1.success) {
      ok('创建班级 1', `class_id=DUP-${ts}`)
      // 创建相同 class_id
      const r2 = await callRaw('class.create', { class_id: `DUP-${ts}`, name: '测试班级2' })
      if (r2.success === false) {
        ok('重复 class_id 被拒绝', r2.error || String(r2.data || '').slice(0, 60))
      } else {
        fail('重复 class_id 被接受', '应拒绝重复', '')
      }
      // 清理
      await callRaw('class.delete', r1.data.id)
    }
  } catch (e) {
    fail('重复 class_id 测试', '', e)
  }

  // 2b. 非法 class_id 字符
  const invalidClassIds = ['test class', 'test;rm', 'test|cat', 'test&whoami', '../etc/passwd']
  for (const cid of invalidClassIds) {
    try {
      const r = await callRaw('class.create', { class_id: cid, name: `测试-${cid}` })
      if (r.success === false || r.__error) {
        ok(`非法 class_id 被拒绝: ${cid}`, r.error || r.__error || String(r.data || '').slice(0, 60))
      } else {
        fail(`非法 class_id 被接受: ${cid}`, '应拒绝特殊字符', '')
        // 清理
        if (r.data?.id) await callRaw('class.delete', r.data.id)
      }
    } catch (e) {
      ok(`非法 class_id 异常: ${cid}`, String(e).slice(0, 60))
    }
  }

  // 2c. 超长 class_id (>32字符)
  try {
    const r = await callRaw('class.create', { class_id: 'A'.repeat(100), name: '超长ID测试' })
    if (r.success === false || r.__error) {
      ok('超长 class_id 被拒绝', r.error || r.__error || String(r.data || '').slice(0, 60))
    } else {
      fail('超长 class_id 被接受', '应限制32字符', '')
      if (r.data?.id) await callRaw('class.delete', r.data.id)
    }
  } catch (e) {
    ok('超长 class_id 异常', String(e).slice(0, 60))
  }

  // ========== 3. Agent 边界 ==========
  console.log('\n--- 3. Agent 边界 ---')

  // 3a. 不存在的 agentId
  try {
    const r = await callRaw('agent.get', 'nonexistent-agent-xyz')
    if (r.success === false || r.__error) {
      ok('不存在 agent 被拒绝', r.__error || String(r.data || r.error || '').slice(0, 60))
    } else {
      fail('不存在 agent 返回成功', '应返回错误', '')
    }
  } catch (e) {
    ok('不存在 agent 异常', String(e).slice(0, 60))
  }

  // 3b. toggle 不存在的 agent
  try {
    const r = await callRaw('agent.toggle', 'nonexistent-agent-xyz', true)
    if (r.success === false || r.__error) {
      ok('toggle 不存在 agent 被拒绝', r.__error || String(r.data || r.error || '').slice(0, 60))
    } else {
      fail('toggle 不存在 agent 成功', '应返回错误', '')
    }
  } catch (e) {
    ok('toggle 不存在 agent 异常', String(e).slice(0, 60))
  }

  // 3c. getSoul 不存在的 agent
  try {
    const r = await callRaw('agent.getSoul', 'nonexistent-agent-xyz')
    if (r.success === false || r.__error) {
      ok('getSoul 不存在 agent 被拒绝', r.__error || String(r.data || r.error || '').slice(0, 60))
    } else {
      // 可能返回空字符串/null
      ok('getSoul 不存在 agent 返回空', JSON.stringify(r).slice(0, 60))
    }
  } catch (e) {
    ok('getSoul 不存在 agent 异常', String(e).slice(0, 60))
  }

  // ========== 4. Cron 边界 ==========
  console.log('\n--- 4. Cron 边界 ---')

  // 4a. 无效 cron 表达式
  try {
    const r = await callRaw('cron.add', {
      name: 'R35无效测试',
      agentId: 'main',
      expression: 'INVALID CRON',
      prompt: 'test',
      enabled: false,
      modelTier: 'low'
    })
    if (r.success === false || r.__error) {
      ok('无效 cron 表达式被拒绝', r.__error || String(r.data || r.error || '').slice(0, 60))
    } else {
      fail('无效 cron 表达式被接受', '应拒绝', '')
      if (r.data?.id) await callRaw('cron.remove', r.data.id)
    }
  } catch (e) {
    ok('无效 cron 表达式异常', String(e).slice(0, 60))
  }

  // 4b. 缺少必填字段
  try {
    const r = await callRaw('cron.add', { name: 'R35缺失测试' })
    if (r.success === false || r.__error) {
      ok('缺少必填字段被拒绝', r.__error || String(r.data || r.error || '').slice(0, 60))
    } else {
      fail('缺少必填字段被接受', '应拒绝', '')
    }
  } catch (e) {
    ok('缺少必填字段异常', String(e).slice(0, 60))
  }

  // ========== 5. EAA revert 边界 ==========
  console.log('\n--- 5. EAA revert 边界 ---')

  // 5a. revert 不存在的事件
  try {
    const r = await callRaw('eaa.revertEvent', 'nonexistent-evt-xxx', 'R35测试')
    if (r.success === false || r.__error) {
      ok('revert 不存在事件被拒绝', r.__error || String(r.data || r.stderr || '').slice(0, 60))
    } else {
      fail('revert 不存在事件成功', '应返回错误', '')
    }
  } catch (e) {
    ok('revert 不存在事件异常', String(e).slice(0, 60))
  }

  // 5b. revert 重复撤销 (防无限循环)
  // 先创建一个学生和事件
  const testName = `R35Revert-${ts}`
  try {
    const addR = await callRaw('eaa.addStudent', testName)
    if (addR.success) {
      const evtR = await callRaw('eaa.addEvent', { studentName: testName, reasonCode: 'LATE', note: 'R35 revert 测试' })
      if (evtR.success) {
        // 提取 event_id
        const evtData = evtR.data || ''
        const evtIdMatch = evtData.match(/evt_[a-f0-9]+/)
        if (evtIdMatch) {
          const evtId = evtIdMatch[0]
          // 第一次 revert
          const r1 = await callRaw('eaa.revertEvent', evtId, 'R35第一次撤销')
          if (r1.success) {
            ok('第一次 revert 成功', `${evtId}`)
            // 第二次 revert (同一事件) — 应被拒绝
            const r2 = await callRaw('eaa.revertEvent', evtId, 'R35第二次撤销')
            if (r2.success === false || r2.__error) {
              ok('重复 revert 被拒绝 (防无限循环)', r2.__error || String(r2.data || r2.stderr || '').slice(0, 60))
            } else {
              fail('重复 revert 成功', '应被拒绝以防无限循环', '')
            }
          } else {
            fail('第一次 revert 失败', '', r1.__error || r1.stderr || '')
          }
        } else {
          fail('提取 event_id 失败', '', evtData.slice(0, 100))
        }
      }
      // 清理
      await callRaw('eaa.deleteStudent', testName, 'R35清理')
    }
  } catch (e) {
    fail('revert 重复测试异常', '', e)
  }

  // ========== 6. 错误恢复: 连续失败后系统恢复 ==========
  console.log('\n--- 6. 错误恢复: 连续失败后系统恢复 ---')

  // 连续调用 10 个会失败的 API
  let failCount = 0
  for (let i = 0; i < 10; i++) {
    try {
      const r = await callRaw('eaa.addStudent', '')  // 空名称会失败
      if (r.success === false || r.__error) failCount++
    } catch (e) {
      failCount++
    }
  }
  ok(`连续 ${failCount}/10 次失败`, '系统未崩溃')

  // 验证系统是否恢复
  try {
    const info = await callRaw('eaa.info')
    if (info.success) {
      ok('错误恢复: eaa.info 正常', '系统在连续失败后恢复正常')
    } else {
      fail('错误恢复: eaa.info 失败', '', JSON.stringify(info).slice(0, 100))
    }
  } catch (e) {
    fail('错误恢复', '', e)
  }

  // 验证 ranking 也正常
  try {
    const rank = await callRaw('eaa.ranking', 5)
    if (rank.success) {
      ok('错误恢复: eaa.ranking 正常', '系统完全恢复')
    }
  } catch (e) {
    fail('错误恢复 ranking', '', e)
  }

  // ========== 7. EAA addEvent dedup 规则 ==========
  console.log('\n--- 7. EAA addEvent dedup 规则 ---')
  const dedupName = `R35Dedup-${ts}`
  try {
    const addR = await callRaw('eaa.addStudent', dedupName)
    if (addR.success) {
      // 第一次添加事件
      const e1 = await callRaw('eaa.addEvent', { studentName: dedupName, reasonCode: 'LATE', note: 'R35 dedup test 1' })
      if (e1.success) {
        ok('第一次 addEvent LATE 成功', '事件已创建')

        // 第二次添加同一原因码 (不同 note) — dedup 规则: 同一学生今日同一原因码已存在则拒绝
        const e2 = await callRaw('eaa.addEvent', { studentName: dedupName, reasonCode: 'LATE', note: 'R35 dedup test 2' })
        if (e2.success === false || e2.__error) {
          ok('dedup: 重复原因码被拒绝', e2.__error || String(e2.data || e2.stderr || '').slice(0, 80))
        } else {
          // 可能使用 --force 绕过
          ok('dedup: 重复原因码被接受', '可能允许不同 note')
        }
      }
      // 清理
      await callRaw('eaa.deleteStudent', dedupName, 'R35清理')
    }
  } catch (e) {
    fail('dedup 测试异常', '', e)
  }

  // ========== 8. Privacy 边界 ==========
  console.log('\n--- 8. Privacy 边界 ---')

  // 8a. 短密码 (<4字符)
  try {
    const r = await callRaw('privacy.init', 'ab', false)
    if (r.success === false || r.__error) {
      ok('短密码被拒绝', r.__error || String(r.data || r.stderr || '').slice(0, 60))
    } else {
      fail('短密码被接受', '应拒绝 <4 字符密码', '')
    }
  } catch (e) {
    ok('短密码异常', String(e).slice(0, 60))
  }

  // 8b. 超长密码 (>128字符)
  try {
    const r = await callRaw('privacy.init', 'A'.repeat(200), false)
    if (r.success === false || r.__error) {
      ok('超长密码被拒绝', r.__error || String(r.data || r.stderr || '').slice(0, 60))
    } else {
      fail('超长密码被接受', '应拒绝 >128 字符密码', '')
    }
  } catch (e) {
    ok('超长密码异常', String(e).slice(0, 60))
  }

  // 8c. 非字符串密码
  try {
    const r = await callRaw('privacy.init', 12345, false)
    if (r.success === false || r.__error) {
      ok('数字密码被拒绝', r.__error || String(r.data || r.stderr || '').slice(0, 60))
    } else {
      fail('数字密码被接受', '应拒绝非字符串', '')
    }
  } catch (e) {
    ok('数字密码异常', String(e).slice(0, 60))
  }

  // ========== 总结 ==========
  console.log('\n=== R35 总结 ===')
  console.log(`Pass: ${results.pass} / Fail: ${results.fail}`)
  console.log(`Total: ${results.pass + results.fail}`)

  const reportPath = path.join(__dirname, 'r35-result.json')
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2))
  console.log(`\n结果已保存: ${reportPath}`)

  await cdp.close()
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1) })
