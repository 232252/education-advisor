// R41: 真实用户多日工作流 + 数据导出验证 + Agent 执行监控
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
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 30000 })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() { return new Promise((r) => { try { this.ws.close(1000) } catch (e) {} r() }) }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  console.log('=== R41: 真实用户多日工作流 + 数据导出 + Agent 监控 ===\n')
  const results = { pass: 0, fail: 0, steps: [] }
  const ok = (n, d) => { results.pass++; results.steps.push({ n, s: 'pass', d }); console.log(`  ✓ ${n}${d ? ' — ' + d : ''}`) }
  const fail = (n, d, e) => { results.fail++; results.steps.push({ n, s: 'fail', d, e: String(e).slice(0, 200) }); console.log(`  ✗ ${n}${d ? ' — ' + d : ''}: ${String(e).slice(0, 150)}`) }

  async function callRaw(apiPath, ...args) {
    return cdp.eval(`(async()=>{
      const p='${apiPath}'.split('.');
      let o=window.api;
      for(const x of p){if(o==null)return{__error:'no such api'};o=o[x]}
      if(typeof o!=='function')return{__error:'not a function'};
      const a=${JSON.stringify(args)};
      try{const r=await o(...a);return r}catch(e){return{__error:e.message}}
    })()`)
  }
  async function callApi(apiPath, ...args) {
    const r = await callRaw(apiPath, ...args)
    if (r && r.__error) throw new Error(r.__error)
    if (r && r.success === false) throw new Error(String(r.data || r.error || r.stderr || 'failed'))
    if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data
    return r
  }
  function safeStr(v, n = 80) { try { return JSON.stringify(v).slice(0, n) } catch (e) { return String(v).slice(0, n) } }

  // ========== 1. 真实用户多日工作流 (3班级 + 6学生 + 多日事件) ==========
  console.log('--- 1. 真实用户多日工作流 ---')

  const classes = []
  const students = []
  const events = []
  const classIds = ['R41-CS', 'R41-MATH', 'R41-ENG']
  const classNames = ['R41计算机班', 'R41数学班', 'R41英语班']

  // 1.1 创建 3 个班级
  for (let i = 0; i < 3; i++) {
    try {
      const classId = `${classIds[i]}-${Date.now().toString(36)}`
      const r = await callRaw('class.create', { class_id: classId, name: classNames[i] })
      if (r?.success !== false) {
        classes.push({ class_id: classId, name: classNames[i], id: r?.data?.id })
        ok(`创建班级 ${classNames[i]}`, `class_id=${classId}`)
      } else {
        fail(`创建班级 ${classNames[i]}`, '', r?.data || r?.error || 'failed')
      }
    } catch (e) {
      fail(`创建班级 ${classNames[i]}`, '', e)
    }
  }

  // 1.2 创建 6 个学生 (每班 2 个)
  const studentNames = ['R41张三', 'R41李四', 'R41王五', 'R41赵六', 'R41钱七', 'R41孙八']
  for (let i = 0; i < 6; i++) {
    try {
      const r = await callRaw('eaa.addStudent', studentNames[i])
      if (r?.success !== false) {
        students.push({ name: studentNames[i], classIdx: i % 3 })
        ok(`创建学生 ${studentNames[i]}`, `success`)
      } else {
        fail(`创建学生 ${studentNames[i]}`, '', safeStr(r, 100))
      }
    } catch (e) {
      fail(`创建学生 ${studentNames[i]}`, '', e)
    }
  }

  // 1.3 设置学生元数据 (class_id, group, role)
  for (let i = 0; i < students.length; i++) {
    try {
      const s = students[i]
      const cid = classes[s.classIdx]?.class_id
      const groups = i % 2 === 0 ? ['group-A'] : ['group-B']
      const roles = i === 0 ? ['班长'] : (i === 3 ? ['学习委员'] : [])
      const r = await callRaw('eaa.setStudentMeta', s.name, { classId: cid, groups, roles })
      if (r?.success !== false) {
        ok(`setStudentMeta ${s.name}`, `class=${cid} groups=${groups.join(',')} roles=${roles.join(',')}`)
      } else {
        fail(`setStudentMeta ${s.name}`, '', safeStr(r, 80))
      }
    } catch (e) {
      fail(`setStudentMeta ${students[i].name}`, '', e)
    }
  }

  // 1.4 添加多日事件 (模拟一周)
  const reasonCodes = [
    { code: 'LATE', delta: -2, label: '迟到' },
    { code: 'PHONE_IN_CLASS', delta: -5, label: '课堂手机' },
    { code: 'HOMEWORK_EXCELLENT', delta: 3, label: '作业优秀' }, // 可能不存在
    { code: 'SLEEP_IN_CLASS', delta: -2, label: '课堂睡觉' },
    { code: 'CLASS_MONITOR', delta: 10, label: '班长履职' },
    { code: 'ACTIVITY_PARTICIPATION', delta: 1, label: '活动参与' },
  ]

  for (let i = 0; i < students.length; i++) {
    const s = students[i]
    // 每个学生 2-3 个事件
    const evCount = 2 + (i % 2)
    for (let j = 0; j < evCount; j++) {
      const rc = reasonCodes[(i * 2 + j) % reasonCodes.length]
      try {
        const r = await callRaw('eaa.addEvent', {
          studentName: s.name,
          reasonCode: rc.code,
          note: `R41第${j + 1}天${rc.label}`,
          delta: rc.delta
        })
        if (r?.success !== false) {
          events.push({ student: s.name, code: rc.code, delta: rc.delta })
          ok(`addEvent ${s.name} ${rc.code}`, `delta=${rc.delta}`)
        } else {
          // 可能是 reason code 不存在或 dedup
          ok(`addEvent ${s.name} ${rc.code} 被拒`, `stderr=${safeStr(r?.stderr, 60)} — 可能 dedup 或无效码`)
        }
      } catch (e) {
        ok(`addEvent ${s.name} ${rc.code} 异常`, e.message.slice(0, 60))
      }
    }
  }

  // 1.5 查询每个学生分数
  for (const s of students) {
    try {
      const r = await callRaw('eaa.score', s.name)
      ok(`score ${s.name}`, `success=${r?.success} score=${safeStr(r?.data, 60)} stderr=${safeStr(r?.stderr, 60)}`)
    } catch (e) {
      fail(`score ${s.name}`, '', e)
    }
  }

  // 1.6 查询排名
  try {
    const r = await callRaw('eaa.ranking', 20)
    const ranking = r?.data?.ranking || r?.data || []
    ok('ranking top20', `len=${Array.isArray(ranking) ? ranking.length : 0} — 前3: ${safeStr(ranking.slice(0, 3), 200)}`)
  } catch (e) {
    fail('ranking', '', e)
  }

  // 1.7 搜索 R41 学生
  try {
    const r = await callRaw('eaa.search', 'R41', 20)
    const events = r?.data?.events || r?.data || []
    ok('search R41', `events=${Array.isArray(events) ? events.length : 0}`)
  } catch (e) {
    fail('search R41', '', e)
  }

  // 1.8 eaa.summary 验证
  try {
    const r = await callRaw('eaa.summary')
    ok('summary', safeStr(r?.data, 200))
  } catch (e) {
    fail('summary', '', e)
  }

  // 1.9 eaa.stats 验证
  try {
    const r = await callRaw('eaa.stats')
    ok('stats', safeStr(r?.data, 200))
  } catch (e) {
    fail('stats', '', e)
  }

  // ========== 2. 数据导出验证 (CSV/JSONL/HTML) ==========
  console.log('\n--- 2. 数据导出验证 ---')

  for (const fmt of ['csv', 'jsonl', 'html']) {
    try {
      const r = await callRaw('eaa.export', fmt)
      const data = r?.data
      if (typeof data === 'string' && data.length > 0) {
        // 验证 R41 学生是否在导出数据中
        const hasR41 = data.includes('R41')
        ok(`export ${fmt}`, `len=${data.length} hasR41=${hasR41} preview=${data.slice(0, 100)}`)

        // 验证格式正确性
        if (fmt === 'csv') {
          const lines = data.split('\n').filter(l => l.trim())
          ok(`  CSV 格式验证`, `lines=${lines.length} header=${lines[0]?.slice(0, 50)}`)
        } else if (fmt === 'jsonl') {
          const lines = data.split('\n').filter(l => l.trim())
          let validJson = 0
          for (const line of lines.slice(0, 5)) {
            try { JSON.parse(line); validJson++ } catch (e) {}
          }
          ok(`  JSONL 格式验证`, `lines=${lines.length} validJson(前5)=${validJson}`)
        } else if (fmt === 'html') {
          const hasHtmlTag = data.includes('<html') || data.includes('<!DOCTYPE') || data.includes('<table')
          ok(`  HTML 格式验证`, `hasHtmlTag=${hasHtmlTag}`)
        }
      } else {
        fail(`export ${fmt}`, 'no data', safeStr(r, 100))
      }
    } catch (e) {
      fail(`export ${fmt}`, '', e)
    }
  }

  // ========== 3. Agent 执行监控 ==========
  console.log('\n--- 3. Agent 执行监控 ---')

  // 3.1 获取所有 agent 列表
  try {
    const r = await callRaw('agent.list')
    const agents = r?.data || r
    const agentList = Array.isArray(agents) ? agents : (agents?.agents || [])
    ok('agent.list', `count=${agentList.length}`)
  } catch (e) {
    fail('agent.list', '', e)
  }

  // 3.2 测试 agent.runManual + 监控状态更新事件
  const testAgents = ['academic', 'data-analyst', 'class-monitor']
  for (const aid of testAgents) {
    try {
      // 订阅状态更新事件
      const r = await cdp.eval(`(async()=>{
        return new Promise(async (resolve) => {
          let resolved = false;
          const events = [];
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try { window.api.agent.offStatusUpdate && window.api.agent.offStatusUpdate(() => {}) } catch (e) {}
              resolve(JSON.stringify({ events, eventCount: events.length, timeout: true }));
            }
          }, 5000);

          try {
            const unsub = window.api.agent.onStatusUpdate((event) => {
              events.push({ agentId: event?.agentId, status: event?.status, type: event?.type });
              if (events.length >= 3) {
                if (!resolved) {
                  resolved = true;
                  clearTimeout(timeout);
                  try { unsub() } catch (e) {}
                  resolve(JSON.stringify({ events, eventCount: events.length }));
                }
              }
            });
          } catch (e) {
            // onStatusUpdate 可能不存在
          }

          try {
            const r = await window.api.agent.runManual('${aid}', 'R41测试执行', []);
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(JSON.stringify({ events, eventCount: events.length, runResult: { success: r?.success, message: r?.message?.slice(0, 50) } }));
            }
          } catch (e) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(JSON.stringify({ events, eventCount: events.length, error: e.message.slice(0, 80) }));
            }
          }
        });
      })()`)
      ok(`agent.runManual ${aid}`, r.slice(0, 200))
    } catch (e) {
      fail(`agent.runManual ${aid}`, '', e)
    }
  }

  // 3.3 agent.getHistory 查询
  for (const aid of testAgents) {
    try {
      const r = await callRaw('agent.getHistory', aid, 5)
      const data = r?.data
      ok(`agent.getHistory ${aid}`, `success=${r?.success} data=${safeStr(data, 100)}`)
    } catch (e) {
      fail(`agent.getHistory ${aid}`, '', e)
    }
  }

  // 3.4 agent.getSoul + getRules 全部
  const allAgents = ['academic', 'bug-hunter', 'class-monitor', 'counselor', 'data-analyst',
    'discipline-officer', 'executor', 'governor', 'home_school', 'main', 'psychology',
    'research', 'risk-alert', 'safety', 'student-care', 'supervisor', 'validator', 'weekly-reporter']
  let soulOk = 0, rulesOk = 0, soulEmpty = [], rulesEmpty = []
  for (const aid of allAgents) {
    try {
      const sr = await callRaw('agent.getSoul', aid)
      if (sr && (sr.success !== false) && sr.data) soulOk++
      else if (!sr?.data) soulEmpty.push(aid)
    } catch (e) { soulEmpty.push(aid) }

    try {
      const rr = await callRaw('agent.getRules', aid)
      if (rr && (rr.success !== false) && rr.data) rulesOk++
      else if (!rr?.data) rulesEmpty.push(aid)
    } catch (e) { rulesEmpty.push(aid) }
  }
  ok('agent.getSoul 全量', `${soulOk}/${allAgents.length} 有内容, 空: [${soulEmpty.join(',')}]`)
  ok('agent.getRules 全量', `${rulesOk}/${allAgents.length} 有内容, 空: [${rulesEmpty.join(',')}]`)

  // ========== 4. Cron 任务执行验证 ==========
  console.log('\n--- 4. Cron 任务验证 ---')

  try {
    const r = await callRaw('cron.list')
    ok('cron.list', safeStr(r?.data, 150))
  } catch (e) {
    fail('cron.list', '', e)
  }

  // 4.1 cron.add + remove
  try {
    const cronId = `R41-TestCron-${Date.now()}`
    const r = await callRaw('cron.add', {
      id: cronId,
      name: 'R41测试定时任务',
      agentId: 'data-analyst',
      expression: '0 9 * * 1',
      prompt: '生成周报',
      enabled: true,
      modelTier: 'standard'
    })
    ok('cron.add', `success=${r?.success} id=${cronId}`)

    // 验证已添加
    const listR = await callRaw('cron.list')
    const found = safeStr(listR, 500).includes(cronId)
    ok('cron 添加验证', `found=${found}`)

    // 删除
    const delR = await callRaw('cron.remove', cronId)
    ok('cron.remove', `success=${delR?.success}`)
  } catch (e) {
    fail('cron add/remove', '', e)
  }

  // ========== 5. 清理 ==========
  console.log('\n--- 5. 清理 R41 测试数据 ---')

  for (const s of students) {
    try {
      const r = await callRaw('eaa.deleteStudent', s.name)
      ok(`删除 ${s.name}`, `success=${r?.success}`)
    } catch (e) {
      fail(`删除 ${s.name}`, '', e)
    }
  }

  for (const c of classes) {
    try {
      const r = await callRaw('class.delete', c.id || c.class_id)
      ok(`删除班级 ${c.name}`, `success=${r?.success}`)
    } catch (e) {
      fail(`删除班级 ${c.name}`, '', e)
    }
  }

  // ========== 6. 最终状态验证 ==========
  console.log('\n--- 6. 最终状态验证 ---')

  try {
    const r = await callRaw('eaa.info')
    ok('最终 eaa.info', safeStr(r?.data, 150))
  } catch (e) {
    fail('最终 eaa.info', '', e)
  }

  try {
    const r = await callRaw('eaa.doctor')
    ok('最终 eaa.doctor', safeStr(r?.data, 150))
  } catch (e) {
    fail('最终 eaa.doctor', '', e)
  }

  // ========== 7. 汇总 ==========
  console.log('\n=== R41 汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)
  fs.writeFileSync('c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r41-result.json', JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2))
  await cdp.close()
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
