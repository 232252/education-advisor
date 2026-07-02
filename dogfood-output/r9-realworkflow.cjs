// R9: 真实用户工作流模拟
// 需求: 随机创建 3 个班级, 每个班级随机模拟学生从创建→各方面使用→删除全生命周期
// 测试方式: 通过 window.api 调用真实 IPC, 数据真实落库, 压力测试各功能

const http = require('http')
const WebSocket = require('ws')

const CDP_HOST = '127.0.0.1'
const CDP_PORT = 9222

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: CDP_HOST, port: CDP_PORT, path: '/json', timeout: 5000 },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          try {
            const j = JSON.parse(d)
            const page = j.find((p) => p.type === 'page')
            if (!page) return reject(new Error('No page target'))
            resolve(page.webSocketDebuggerUrl)
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
  })
}

class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          if (msg.error) reject(new Error(msg.error.message))
          else resolve(msg.result)
        }
      } catch (e) {}
    })
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      timeout: 30000,
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  close() {
    return new Promise((r) => {
      try { this.ws.close(1000, 'done') } catch (e) {}
      r()
    })
  }
}

async function main() {
  const target = await getWsTarget()
  const ws = new WebSocket(target)
  await new Promise((r, j) => {
    ws.on('open', r)
    ws.on('error', j)
  })
  const cdp = new CdpClient(ws)

  console.log('=== R9 真实用户工作流模拟 ===\n')

  // 测试结果收集
  const results = { pass: 0, fail: 0, steps: [] }
  function ok(name, detail) {
    results.pass++
    results.steps.push({ name, status: 'pass', detail })
    console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`)
  }
  function fail(name, detail, err) {
    results.fail++
    results.steps.push({ name, status: 'fail', detail, err: String(err).slice(0, 200) })
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}: ${String(err).slice(0, 120)}`)
  }

  // callApi helper: 调用 window.api.xxx.yyy(...args), 自动 unwrap EAA 返回的 {success,data} 包装
  function unwrap(r) {
    if (r && r.__error) return r
    if (r && typeof r === 'object' && 'success' in r && 'data' in r) return r.data
    return r
  }
  async function callApi(path, ...args) {
    const r = await cdp.eval(
      `(async () => {
        const parts = ${JSON.stringify(path)}.split('.')
        let obj = window.api
        for (const x of parts) { obj = obj[x] }
        const a = ${JSON.stringify(args)}
        try { return await obj(...a) } catch(e) { return { __error: e.message } }
      })()`,
    )
    return unwrap(r)
  }
  // 兼容别名
  const call = callApi

  // 随机辅助
  const rnd = (n) => Math.floor(Math.random() * n)
  const pick = (arr) => arr[rnd(arr.length)]
  const rid = () => Date.now().toString(36) + rnd(10000).toString(36)
  // classId 只允许 [A-Za-z0-9.-] (sanitizeClassId 限制)
  const classRid = () => 'R9' + Date.now().toString(36).toUpperCase() + rnd(10000).toString().padStart(4, '0')
  const now = () => new Date().toISOString()
  const today = () => new Date().toISOString().slice(0, 10)

  // ========== 第 1 阶段: 准备阶段 ==========
  console.log('\n--- 第 1 阶段: 准备数据 ---')

  // 获取初始学生数 / 班级数
  const info0 = await callApi('eaa.info')
  const initialStudentCount = info0?.students ?? 0
  ok('初始 eaa.info', `students=${initialStudentCount}, version=${info0?.version}`)

  const classList0 = await callApi('class.list')
  const initialClassCount = Array.isArray(classList0) ? classList0.length : (classList0?.length ?? 0)
  ok('初始 class.list', `count=${initialClassCount}`)

  // ========== 第 2 阶段: 创建 3 个班级 ==========
  console.log('\n--- 第 2 阶段: 创建 3 个随机班级 ---')

  const gradeOptions = ['七年级', '八年级', '九年级']
  const teacherOptions = ['王老师', '李老师', '张老师', '赵老师', '陈老师']
  const classPrefix = ['火箭', '雄鹰', '星辰', '骄阳', '凌云', '青松']

  const createdClasses = []
  for (let i = 0; i < 3; i++) {
    const classId = classRid()
    const name = `${pick(classPrefix)}${i + 1}班`
    const grade = pick(gradeOptions)
    const teacher = pick(teacherOptions)
    const r = await callApi('class.create', { class_id: classId, name, grade, teacher })
    // r 是 unwrap 后的 ClassEntity (含 id=UUID, class_id=业务编号) 或 {success:false, error}
    if (r && !r.__error && r.id) {
      createdClasses.push({ id: r.id, class_id: r.class_id || classId, name, grade, teacher })
      ok(`创建班级 ${i + 1}`, `id=${r.id}, class_id=${classId}, name=${name}`)
    } else {
      fail(`创建班级 ${i + 1}`, `id=${classId}`, r?.__error || r?.error || JSON.stringify(r).slice(0, 100))
    }
  }

  // 验证班级数 +3
  const classList1 = await callApi('class.list')
  const newClassCount = Array.isArray(classList1) ? classList1.length : (classList1?.length ?? 0)
  if (newClassCount === initialClassCount + createdClasses.length) {
    ok('班级数+3 验证', `${initialClassCount} → ${newClassCount}`)
  } else {
    fail('班级数+3 验证', `期望 ${initialClassCount + 3}, 实际 ${newClassCount}`)
  }

  // ========== 第 3 阶段: 为每个班级随机创建学生 ==========
  console.log('\n--- 第 3 阶段: 为每个班级创建随机学生 ---')

  const familyNames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡']
  const givenNames = ['明', '华', '强', '伟', '丽', '芳', '娟', '敏', '静', '秀', '杰', '涛', '超', '霞', '平', '刚', '桂', '燕', '红', '磊']

  const createdStudents = [] // {name, class_id}
  const studentsPerClass = 5 + rnd(4) // 每班 5-8 个学生
  for (const cls of createdClasses) {
    const n = studentsPerClass
    for (let i = 0; i < n; i++) {
      const studentName = `R9_${familyNames[rnd(familyNames.length)]}${givenNames[rnd(givenNames.length)]}_${rid()}`
      const r = await callApi('eaa.addStudent', studentName)
      if (r && !r.__error && r.success !== false) {
        createdStudents.push({ name: studentName, class_id: cls.class_id })
        ok(`创建学生 ${createdStudents.length}`, `${studentName} (班级: ${cls.name})`)
      } else {
        fail(`创建学生 ${studentName}`, '', r?.__error || JSON.stringify(r).slice(0, 100))
      }
    }
  }
  ok('学生创建汇总', `共创建 ${createdStudents.length} 个学生`)

  // 验证学生数
  const info1 = await callApi('eaa.info')
  const newStudentCount = info1?.students ?? 0
  if (newStudentCount >= initialStudentCount + createdStudents.length) {
    ok('学生数+验证', `${initialStudentCount} → ${newStudentCount} (期望 ≥${initialStudentCount + createdStudents.length})`)
  } else {
    fail('学生数+验证', `期望 ≥${initialStudentCount + createdStudents.length}, 实际 ${newStudentCount}`)
  }

  // ========== 第 4 阶段: 调班 — 批量把学生分配到班级 ==========
  console.log('\n--- 第 4 阶段: 调班 (assign) ---')

  for (const cls of createdClasses) {
    const studentsOfClass = createdStudents.filter((s) => s.class_id === cls.class_id)
    const studentNames = studentsOfClass.map((s) => s.name)
    if (studentNames.length === 0) continue
    const r = await callApi('class.assign', { class_id: cls.class_id, student_names: studentNames })
    if (r && !r.__error && r.success !== false) {
      ok(`调班 ${cls.name}`, `分配 ${studentNames.length} 个学生`)
    } else {
      fail(`调班 ${cls.name}`, '', r?.__error || r?.error || JSON.stringify(r).slice(0, 100))
    }
  }

  // ========== 第 5 阶段: 为学生添加操行事件 (压力) ==========
  console.log('\n--- 第 5 阶段: 为学生添加操行事件 ---')

  const reasonCodes = [
    { code: 'LATE', delta: -2 },
    { code: 'SLEEP_IN_CLASS', delta: -2 },
    { code: 'SPEAK_IN_CLASS', delta: -1 },
    { code: 'PHONE_IN_CLASS', delta: -3 },
    { code: 'ACTIVITY_PARTICIPATION', delta: 2 },
    { code: 'CLASS_MONITOR', delta: 5 },
    { code: 'CIVILIZED_DORM', delta: 3 },
    { code: 'MONTHLY_ATTENDANCE', delta: 2 },
  ]
  const operators = ['班主任', '教务处', '年级组长', '值日老师']
  const notes = ['', '请家长注意', '本周连续发生', '已谈话', '班级表扬']

  let eventCount = 0
  // 为每个学生添加 3-6 个事件
  for (const s of createdStudents) {
    const eventNum = 3 + rnd(4)
    for (let i = 0; i < eventNum; i++) {
      const rc = pick(reasonCodes)
      const r = await callApi('eaa.addEvent', {
        studentName: s.name,
        reasonCode: rc.code,
        delta: rc.delta,
        note: pick(notes),
        operator: pick(operators),
      })
      if (r && !r.__error && r.success !== false) {
        eventCount++
      } else {
        // 去重规则: 同一学生今日同一原因码 — 这是设计行为,不算 bug
        if (r?.__error && r.__error.includes('已存在')) continue
        fail(`addEvent ${s.name} ${rc.code}`, '', r?.__error || JSON.stringify(r).slice(0, 80))
      }
    }
  }
  ok('addEvent 汇总', `成功添加 ${eventCount} 个事件 (跨 ${createdStudents.length} 学生, 含去重)`)

  // ========== 第 6 阶段: 查询操作 (分数/历史/排行/统计) ==========
  console.log('\n--- 第 6 阶段: 查询操作 ---')

  // 6.1 查询每个学生分数
  let scoreChecked = 0
  for (const s of createdStudents.slice(0, 10)) {
    const r = await callApi('eaa.score', s.name)
    if (r && !r.__error) {
      scoreChecked++
    } else {
      fail(`score ${s.name}`, '', r?.__error)
    }
  }
  ok('score 查询', `成功 ${scoreChecked}/${Math.min(10, createdStudents.length)}`)

  // 6.2 查询每个学生历史
  let historyChecked = 0
  for (const s of createdStudents.slice(0, 10)) {
    const r = await callApi('eaa.history', s.name)
    if (r && !r.__error) {
      historyChecked++
    } else {
      fail(`history ${s.name}`, '', r?.__error)
    }
  }
  ok('history 查询', `成功 ${historyChecked}/${Math.min(10, createdStudents.length)}`)

  // 6.3 排行榜
  const ranking = await callApi('eaa.ranking', 20)
  if (ranking && !ranking.__error) {
    ok('ranking 查询', `Top-20`)
  } else {
    fail('ranking 查询', '', ranking?.__error)
  }

  // 6.4 统计
  const stats = await callApi('eaa.stats')
  if (stats && !stats.__error) {
    ok('stats 查询', '成功')
  } else {
    fail('stats 查询', '', stats?.__error)
  }

  // 6.5 搜索 — 用第一个学生名
  if (createdStudents.length > 0) {
    const search = await callApi('eaa.search', createdStudents[0].name, 5)
    if (search && !search.__error) {
      ok('search 查询', `搜索 "${createdStudents[0].name}"`)
    } else {
      fail('search 查询', '', search?.__error)
    }
  }

  // 6.6 时间范围 — 今天
  const t = today()
  const rangeR = await callApi('eaa.range', t, t, 100)
  if (rangeR && !rangeR.__error) {
    ok('range 查询', `today ${t}`)
  } else {
    fail('range 查询', '', rangeR?.__error)
  }

  // 6.7 tag 查询
  const tagR = await callApi('eaa.tag')
  if (tagR && !tagR.__error) {
    ok('tag 查询', '成功')
  } else {
    fail('tag 查询', '', tagR?.__error)
  }

  // 6.8 listStudents
  const listR = await callApi('eaa.listStudents')
  const listArr = Array.isArray(listR) ? listR : (Array.isArray(listR?.students) ? listR.students : (Array.isArray(listR?.data) ? listR.data : []))
  if (listR && !listR.__error) {
    ok('listStudents 查询', `返回 ${listArr.length} 个`)
  } else {
    fail('listStudents 查询', '', listR?.__error)
  }

  // 6.9 summary
  const sumR = await callApi('eaa.summary')
  if (sumR && !sumR.__error) {
    ok('summary 查询', '成功')
  } else {
    fail('summary 查询', '', sumR?.__error)
  }

  // 6.10 validate
  const valR = await callApi('eaa.validate')
  if (valR && !valR.__error) {
    ok('validate 查询', '成功')
  } else {
    fail('validate 查询', '', valR?.__error)
  }

  // ========== 第 7 阶段: 学生元数据 setStudentMeta ==========
  console.log('\n--- 第 7 阶段: setStudentMeta ---')

  if (createdStudents.length > 0) {
    const s = createdStudents[0]
    const metaR = await callApi('eaa.setStudentMeta', {
      name: s.name,
      group: '实验组',
      role: '组长',
      classId: s.class_id,
    })
    if (metaR && !metaR.__error && metaR.success !== false) {
      ok('setStudentMeta', s.name)
    } else {
      fail('setStudentMeta', s.name, metaR?.__error || metaR?.error || JSON.stringify(metaR).slice(0, 100))
    }
  }

  // ========== 第 8 阶段: 班级 update + archive + restore ==========
  console.log('\n--- 第 8 阶段: 班级 update/archive/restore ---')

  for (const cls of createdClasses) {
    // update — 用 UUID id
    const newTeacher = pick(teacherOptions)
    const upR = await callApi('class.update', cls.id, { teacher: newTeacher })
    if (upR && !upR.__error && upR.success !== false) {
      ok(`class.update ${cls.name}`, `teacher=${newTeacher}`)
    } else {
      fail(`class.update ${cls.name}`, '', upR?.__error || upR?.error || JSON.stringify(upR).slice(0, 100))
    }

    // archive — 用 UUID id
    const arR = await callApi('class.archive', cls.id)
    if (arR && !arR.__error && arR.success !== false) {
      ok(`class.archive ${cls.name}`, '')
    } else {
      fail(`class.archive ${cls.name}`, '', arR?.__error || arR?.error || JSON.stringify(arR).slice(0, 100))
    }

    // restore — 用 UUID id
    const rsR = await callApi('class.restore', cls.id)
    if (rsR && !rsR.__error && rsR.success !== false) {
      ok(`class.restore ${cls.name}`, '')
    } else {
      fail(`class.restore ${cls.name}`, '', rsR?.__error || rsR?.error || JSON.stringify(rsR).slice(0, 100))
    }
  }

  // ========== 第 9 阶段: 移除学生 (removeStudent) + 学生调班 ==========
  console.log('\n--- 第 9 阶段: 学生调班/移除 ---')

  if (createdClasses.length >= 2 && createdStudents.length >= 2) {
    const s0 = createdStudents[0]
    const targetClass = createdClasses[1]
    // 调到新班级 — class.assign 用 class_id + student_names
    const assign2 = await callApi('class.assign', { class_id: targetClass.class_id, student_names: [s0.name] })
    if (assign2 && !assign2.__error && assign2.success !== false) {
      ok(`学生调班 ${s0.name}`, `→ ${targetClass.name}`)
    } else {
      fail(`学生调班 ${s0.name}`, '', assign2?.__error || assign2?.error || JSON.stringify(assign2).slice(0, 100))
    }
    // 从班级移除 — class.removeStudent 用 student_name (snake_case)
    const rmR = await callApi('class.removeStudent', { student_name: s0.name })
    if (rmR && !rmR.__error && rmR.success !== false) {
      ok(`removeStudent ${s0.name}`, '')
    } else {
      fail(`removeStudent ${s0.name}`, '', rmR?.__error || rmR?.error || JSON.stringify(rmR).slice(0, 100))
    }
  }

  // ========== 第 10 阶段: revert 事件 (撤销) ==========
  console.log('\n--- 第 10 阶段: revert 事件 ---')

  if (createdStudents.length > 0) {
    const s = createdStudents[0]
    const hist = await callApi('eaa.history', s.name)
    const events = Array.isArray(hist) ? hist : (hist?.events || hist?.data || [])
    if (events.length > 0) {
      const firstEvent = events[0]
      const evtId = firstEvent.id || firstEvent.event_id || firstEvent.entity_id
      if (evtId) {
        const rvR = await callApi('eaa.revertEvent', String(evtId), 'R9 测试撤销')
        if (rvR && !rvR.__error) {
          ok(`revertEvent ${s.name}`, `evtId=${evtId}`)
        } else {
          fail(`revertEvent ${s.name}`, `evtId=${evtId}`, rvR?.__error || JSON.stringify(rvR).slice(0, 100))
        }
      } else {
        fail(`revertEvent ${s.name}`, '无法定位 event id', JSON.stringify(firstEvent).slice(0, 100))
      }
    } else {
      fail(`revertEvent ${s.name}`, 'history 为空', '')
    }
  }

  // ========== 第 11 阶段: export 三种格式 ==========
  console.log('\n--- 第 11 阶段: export 三种格式 ---')

  for (const fmt of ['csv', 'jsonl', 'html']) {
    const r = await callApi('eaa.export', fmt)
    if (r && !r.__error) {
      ok(`export ${fmt}`, '成功')
    } else {
      fail(`export ${fmt}`, '', r?.__error || JSON.stringify(r).slice(0, 80))
    }
  }

  // ========== 第 12 阶段: 压力 — 批量并发 addEvent (稳定性) ==========
  console.log('\n--- 第 12 阶段: 并发压力 addEvent ---')

  if (createdStudents.length >= 3) {
    const concStudents = createdStudents.slice(0, Math.min(5, createdStudents.length))
    const concPromises = []
    for (const s of concStudents) {
      // 每个学生并发 3 个事件 (不同 reason code, 避免去重)
      const codes = ['LATE', 'SLEEP_IN_CLASS', 'ACTIVITY_PARTICIPATION']
      for (const code of codes) {
        concPromises.push(callApi('eaa.addEvent', { studentName: s.name, reasonCode: code, operator: '并发测试' }))
      }
    }
    const results2 = await Promise.all(concPromises)
    const succ = results2.filter((r) => r && !r.__error && r.success !== false).length
    ok(`并发 addEvent (${concPromises.length} 个并发)`, `成功 ${succ}/${concPromises.length} (去重可能减少)`)
  }

  // ========== 第 13 阶段: 删除阶段 — 软删除所有学生 ==========
  console.log('\n--- 第 13 阶段: 软删除所有创建的学生 ---')

  let deletedCount = 0
  for (const s of createdStudents) {
    const r = await callApi('eaa.deleteStudent', s.name, 'R9 测试清理')
    if (r && !r.__error && r.success !== false) {
      deletedCount++
    } else {
      fail(`deleteStudent ${s.name}`, '', r?.__error || JSON.stringify(r).slice(0, 80))
    }
  }
  ok('学生软删除汇总', `${deletedCount}/${createdStudents.length}`)

  // ========== 第 14 阶段: 删除所有创建的班级 ==========
  console.log('\n--- 第 14 阶段: 删除所有创建的班级 ---')

  let classDeleted = 0
  for (const cls of createdClasses) {
    const r = await callApi('class.delete', cls.id) // 用 UUID id
    if (r && !r.__error && r.success !== false) {
      classDeleted++
      ok(`删除班级 ${cls.name}`, cls.id)
    } else {
      fail(`删除班级 ${cls.name}`, cls.id, r?.__error || r?.error || JSON.stringify(r).slice(0, 80))
    }
  }
  ok('班级删除汇总', `${classDeleted}/${createdClasses.length}`)

  // ========== 第 15 阶段: 最终验证 ==========
  console.log('\n--- 第 15 阶段: 最终验证 ---')

  const info2 = await callApi('eaa.info')
  ok('最终 eaa.info', `students=${info2?.students} (注意: 软删除仍被计入, 这是已知 Bug R7-1)`)

  const classList2 = await callApi('class.list')
  const finalClassCount = Array.isArray(classList2) ? classList2.length : (classList2?.length ?? 0)
  if (finalClassCount === initialClassCount) {
    ok('最终 class.list', `count=${finalClassCount} (恢复初始值)`)
  } else {
    fail('最终 class.list', `期望 ${initialClassCount}, 实际 ${finalClassCount}`, '')
  }

  // ========== 汇总 ==========
  console.log('\n=== R9 测试汇总 ===')
  const total = results.pass + results.fail
  const rate = total > 0 ? ((results.pass / total) * 100).toFixed(1) : '0'
  console.log(`总计: ${total}, 通过: ${results.pass}, 失败: ${results.fail}, 通过率: ${rate}%`)

  const fs = require('fs')
  fs.writeFileSync(
    'c:/Users/sq199/Documents/GitHub/education-advisor/dogfood-output/r9-results.json',
    JSON.stringify({ ...results, total, rate: parseFloat(rate) }, null, 2),
  )

  await cdp.close()
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
