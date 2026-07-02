// =============================================================
// R56 — 端到端真实用户旅程模拟
//
// 模拟真实用户完整操作流程 (用户明确要求):
//   "随机创建3个班级,随机模拟学生从创建到各方面使用到删除"
//
// 旅程:
//   1. 创建 3 个随机班级
//   2. 创建 10 个随机学生,随机分配到班级 (部分不分配)
//   3. 给每个学生随机添加 2-5 个事件 (扣分/加分混合)
//   4. 随机选 2 个学生撤销最近事件
//   5. 随机调班 (1 个学生换班)
//   6. 查看仪表盘/排行榜/历史 (验证数据一致)
//   7. 随机存档 1 个班级,再恢复
//   8. 删除 3 个学生 (验证级联清理)
//   9. 删除 1 个班级 (验证学生保留)
//   10. 最终数据一致性校验
//   11. 清理所有 R56 数据
// =============================================================

const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

const RESULT = { pass: 0, fail: 0, warn: 0, errors: [] }
const ts = Date.now().toString().slice(-6)

function log(type, msg, detail) {
  const full = detail ? `${msg} — ${detail}` : msg
  if (type === 'PASS') {
    RESULT.pass++
    console.log(`  \u2212 ${full}`)
  } else if (type === 'FAIL') {
    RESULT.fail++
    RESULT.errors.push(full)
    console.log(`  \u2717 ${full}`)
  } else if (type === 'WARN') {
    RESULT.warn++
    console.log(`  ! ${full}`)
  }
}

function rand(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// 事件模板 (来自 reason-codes)
const EVENT_TEMPLATES = [
  { code: 'LATE', delta: -2, type: 'deduct' },
  { code: 'SLEEP_IN_CLASS', delta: -2, type: 'deduct' },
  { code: 'SPEAK_IN_CLASS', delta: -2, type: 'deduct' },
  { code: 'SCHOOL_CAUGHT', delta: -5, type: 'deduct' },
  { code: 'PHONE_IN_CLASS', delta: -5, type: 'deduct' },
  { code: 'SMOKING', delta: -10, type: 'deduct' },
  { code: 'DESK_UNALIGNED', delta: -1, type: 'deduct' },
  { code: 'OTHER_DEDUCT', delta: -1, type: 'deduct' },
  { code: 'ACTIVITY_PARTICIPATION', delta: 1, type: 'bonus' },
  { code: 'CLASS_MONITOR', delta: 10, type: 'bonus' },
  { code: 'CLASS_COMMITTEE', delta: 5, type: 'bonus' },
  { code: 'CIVILIZED_DORM', delta: 3, type: 'bonus' },
  { code: 'MONTHLY_ATTENDANCE', delta: 2, type: 'bonus' },
]

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find(x => x.type === 'page'); resolve(p?.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject); req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 60000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 50000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  async api(code) { const v = await this.eval(`(async()=>{try{const r=${code};return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`); if (typeof v === 'string' && v.startsWith('ERR:')) return { __error: v.slice(4) }; try { return v ? JSON.parse(v) : null } catch (e) { return v } }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('=== R56 端到端真实用户旅程模拟 ===')
  console.log('时间戳后缀:', ts)
  console.log('随机种子:', Math.random().toString(36).slice(2, 8))
  console.log('')

  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const createdClassIds = [] // [{class_id, id, name}]
  const createdStudents = [] // [{name, class_id, entity_id}]
  const createdEvents = [] // [{student, code, delta, event_id}]

  try {
    // =============================================================
    // 阶段 1: 创建 3 个随机班级
    // =============================================================
    console.log('--- 阶段 1: 创建 3 个随机班级 ---')
    const classNames = [
      `R56-${ts}-高一${randInt(1, 9)}班`,
      `R56-${ts}-高二${randInt(1, 9)}班`,
      `R56-${ts}-高三${randInt(1, 9)}班`,
    ]
    const grades = ['高一', '高二', '高三']
    for (let i = 0; i < 3; i++) {
      const cid = `R56C${i}-${ts}`
      const r = await cdp.api(`await window.api.class.create({class_id:'${cid}',name:'${classNames[i]}',grade:'${grades[i]}'})`)
      if (r?.success) {
        log('PASS', `创建班级 ${classNames[i]}`, cid)
        createdClassIds.push({ class_id: cid, id: r.data?.id, name: classNames[i] })
      } else {
        log('FAIL', `创建班级 ${classNames[i]}`, r?.__error || JSON.stringify(r))
      }
    }
    if (createdClassIds.length !== 3) throw new Error('班级创建失败,终止')

    console.log('')

    // =============================================================
    // 阶段 2: 创建 10 个随机学生并随机分班
    // =============================================================
    console.log('--- 阶段 2: 创建 10 个随机学生 + 随机分班 ---')
    const firstNames = ['张', '王', '李', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙']
    const givenNames = ['伟', '芳', '娜', '敏', '静', '丽', '强', '磊', '军', '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '霞', '平', '刚']
    const studentNames = new Set()
    while (studentNames.size < 10) {
      studentNames.add(`${rand(firstNames)}${rand(givenNames)}_R56${ts}`)
    }
    const studentList = Array.from(studentNames)

    for (let i = 0; i < studentList.length; i++) {
      const name = studentList[i]
      const r = await cdp.api(`await window.api.eaa.addStudent('${name}')`)
      if (r?.success) {
        // 随机分班 (80% 分到某班, 20% 不分班)
        let assignedClass = null
        if (Math.random() < 0.8) {
          assignedClass = rand(createdClassIds)
          const ar = await cdp.api(`await window.api.class.assign({class_id:'${assignedClass.class_id}',student_names:['${name}']})`)
          if (ar?.success) {
            log('PASS', `学生 ${name} → ${assignedClass.name}`)
          } else {
            log('WARN', `学生 ${name} 分班失败`, ar?.__error)
            assignedClass = null
          }
        } else {
          log('PASS', `学生 ${name} (未分班)`)
        }
        createdStudents.push({ name, class_id: assignedClass?.class_id || null })
      } else {
        log('FAIL', `创建学生 ${name}`, r?.__error)
      }
    }

    console.log('')

    // =============================================================
    // 阶段 3: 给每个学生随机添加 2-5 个事件
    // =============================================================
    console.log('--- 阶段 3: 随机添加事件 (2-5 个/学生) ---')
    let totalEventsAdded = 0
    for (const s of createdStudents) {
      const eventCount = randInt(2, 5)
      for (let i = 0; i < eventCount; i++) {
        const tpl = rand(EVENT_TEMPLATES)
        const tags = [`R56_${ts}`, tpl.type]
        if (s.class_id) tags.push('有班级')
        else tags.push('无班级')
        const r = await cdp.api(`await window.api.eaa.addEvent({studentName:'${s.name}',reasonCode:'${tpl.code}',tags:${JSON.stringify(tags)}})`)
        if (r?.success) {
          totalEventsAdded++
          createdEvents.push({ student: s.name, code: tpl.code, delta: tpl.delta })
        } else {
          log('WARN', `事件失败 ${s.name} ${tpl.code}`, r?.__error)
        }
      }
    }
    log('PASS', `共添加 ${totalEventsAdded} 个事件 (10 学生)`)

    console.log('')

    // =============================================================
    // 阶段 4: 随机撤销 2 个学生的最近事件
    // =============================================================
    console.log('--- 阶段 4: 随机撤销 2 个学生最近事件 ---')
    const revertCandidates = [...createdStudents].sort(() => Math.random() - 0.5).slice(0, 2)
    for (const s of revertCandidates) {
      // 获取历史
      const hist = await cdp.api(`await window.api.eaa.history('${s.name}')`)
      const histData = hist?.data
      const events = Array.isArray(histData) ? histData : (histData?.events || histData?.timeline || [])
      if (events.length > 0) {
        const ev = events[events.length - 1] // 最近一个
        const eventId = ev.event_id || ev.id || ev.eventId
        if (eventId) {
          const beforeScore = await cdp.api(`await window.api.eaa.score('${s.name}')`)
          const beforeVal = beforeScore?.data?.score ?? beforeScore?.data?.parsed?.score
          const rev = await cdp.api(`await window.api.eaa.revertEvent('${eventId}','R56随机撤销')`)
          if (rev?.success) {
            const afterScore = await cdp.api(`await window.api.eaa.score('${s.name}')`)
            const afterVal = afterScore?.data?.score ?? afterScore?.data?.parsed?.score
            // 撤销后分数应 = before - delta (撤销 +|delta|)
            const expectedDelta = -ev.score_delta // 撤销后应反向
            if (typeof beforeVal === 'number' && typeof afterVal === 'number') {
              if (Math.abs(afterVal - (beforeVal - ev.score_delta)) < 0.1) {
                log('PASS', `撤销 ${s.name} 事件 ${eventId.slice(0, 16)}`, `分数 ${beforeVal}→${afterVal}`)
              } else {
                log('WARN', `撤销 ${s.name} 分数变化`, `期望 ${beforeVal - ev.score_delta} 实际 ${afterVal}`)
              }
            } else {
              log('PASS', `撤销 ${s.name} 事件`)
            }
          } else {
            log('WARN', `撤销 ${s.name} 失败`, rev?.__error)
          }
        }
      } else {
        log('WARN', `${s.name} 无历史事件可撤销`)
      }
    }

    console.log('')

    // =============================================================
    // 阶段 5: 随机调班 (1 个学生换班)
    // =============================================================
    console.log('--- 阶段 5: 随机调班 ---')
    const studentsWithClass = createdStudents.filter(s => s.class_id)
    if (studentsWithClass.length > 0) {
      const target = rand(studentsWithClass)
      const otherClasses = createdClassIds.filter(c => c.class_id !== target.class_id)
      if (otherClasses.length > 0) {
        const newClass = rand(otherClasses)
        const r = await cdp.api(`await window.api.class.assign({class_id:'${newClass.class_id}',student_names:['${target.name}']})`)
        if (r?.success) {
          target.class_id = newClass.class_id
          log('PASS', `调班 ${target.name} → ${newClass.name}`)
        } else {
          log('WARN', `调班失败`, r?.__error)
        }
      }
    }

    // 把一个有班学生调到未分班 (clearClassId)
    if (studentsWithClass.length > 1) {
      const target2 = rand(studentsWithClass)
      const r = await cdp.api(`await window.api.eaa.setStudentMeta({name:'${target2.name}',clearClassId:true})`)
      if (r?.success) {
        target2.class_id = null
        log('PASS', `${target2.name} 移出班级 (未分班)`)
      } else {
        log('WARN', `移出班级失败`, r?.__error)
      }
    }

    console.log('')

    // =============================================================
    // 阶段 6: 查看仪表盘/排行榜/历史 (验证数据一致)
    // =============================================================
    console.log('--- 阶段 6: 数据查询验证 ---')
    // 排行榜
    const ranking = await cdp.api(`await window.api.eaa.ranking(100)`)
    const rankData = ranking?.data
    const rankArr = Array.isArray(rankData) ? rankData : (rankData?.ranking || rankData?.students || [])
    const r56InRank = rankArr.filter(r => String(r.name || r.entity_id || '').includes(`R56${ts}`))
    if (r56InRank.length === createdStudents.length)
      log('PASS', `排行榜包含所有 R56 学生 (${r56InRank.length}/${createdStudents.length})`)
    else
      log('WARN', `排行榜 R56 学生数`, `${r56InRank.length}/${createdStudents.length}`)

    // listStudents 验证
    const listR = await cdp.api(`await window.api.eaa.listStudents()`)
    const allStudents = listR?.data?.students || []
    const activeStudents = allStudents.filter(s => s.status !== 'Deleted')
    const r56Active = activeStudents.filter(s => s.name.includes(`R56${ts}`))
    if (r56Active.length === createdStudents.length)
      log('PASS', `listStudents 包含所有 R56 学生 (${r56Active.length})`)
    else
      log('FAIL', `listStudents R56 数量不符`, `${r56Active.length}/${createdStudents.length}`)

    // 每个 R56 学生查询分数和历史
    let scoreOkCount = 0
    let historyOkCount = 0
    for (const s of createdStudents) {
      const sc = await cdp.api(`await window.api.eaa.score('${s.name}')`)
      const scVal = sc?.data?.score ?? sc?.data?.parsed?.score
      if (typeof scVal === 'number') scoreOkCount++
      const hist = await cdp.api(`await window.api.eaa.history('${s.name}')`)
      const histData = hist?.data
      const events = Array.isArray(histData) ? histData : (histData?.events || histData?.timeline || [])
      if (events.length > 0) historyOkCount++
    }
    if (scoreOkCount === createdStudents.length) log('PASS', `所有学生分数查询成功`)
    else log('FAIL', `分数查询失败`, `${scoreOkCount}/${createdStudents.length}`)
    if (historyOkCount > 0) log('PASS', `历史查询成功 (${historyOkCount} 学生有事件)`)
    else log('WARN', `无学生有历史事件`)

    // 班级列表验证
    const classListR = await cdp.api(`await window.api.class.list()`)
    const classList = classListR?.data || []
    const r56Classes = classList.filter(c => c.class_id.startsWith(`R56C`) && c.name.includes(ts))
    if (r56Classes.length === 3) log('PASS', `class.list 包含 3 个 R56 班级`)
    else log('FAIL', `class.list R56 班级数`, `${r56Classes.length}/3`)

    // 导航到仪表盘 (轮询等待渲染,防止瞬时渲染时序问题)
    await cdp.eval(`window.location.hash = '#/dashboard'`)
    let dashText = 0
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(500)
      dashText = await cdp.eval(`document.body.innerText.length`)
      if (dashText > 500) break
    }
    if (dashText > 500) log('PASS', `仪表盘 UI 渲染正常 (${dashText} 字符)`)
    else log('FAIL', `仪表盘 UI 渲染异常`)

    console.log('')

    // =============================================================
    // 阶段 7: 随机存档 1 个班级,再恢复
    // =============================================================
    console.log('--- 阶段 7: 存档/恢复班级 ---')
    const archiveTarget = rand(createdClassIds)
    const ar1 = await cdp.api(`await window.api.class.archive('${archiveTarget.id}')`)
    if (ar1?.success) log('PASS', `存档 ${archiveTarget.name}`)
    else log('FAIL', `存档失败`, ar1?.__error)

    // 验证存档后 class.list 仍包含 (archived=true)
    const listAfterArchive = await cdp.api(`await window.api.class.list()`)
    const archivedClass = (listAfterArchive?.data || []).find(c => c.id === archiveTarget.id)
    if (archivedClass?.archived) log('PASS', `存档状态正确 (archived=true)`)
    else log('WARN', `存档状态异常`)

    // 恢复
    const ar2 = await cdp.api(`await window.api.class.restore('${archiveTarget.id}')`)
    if (ar2?.success) log('PASS', `恢复 ${archiveTarget.name}`)
    else log('FAIL', `恢复失败`, ar2?.__error)

    const listAfterRestore = await cdp.api(`await window.api.class.list()`)
    const restoredClass = (listAfterRestore?.data || []).find(c => c.id === archiveTarget.id)
    if (restoredClass && !restoredClass.archived) log('PASS', `恢复状态正确 (archived=false)`)
    else log('WARN', `恢复状态异常`)

    console.log('')

    // =============================================================
    // 阶段 8: 删除 3 个学生 (验证级联清理)
    // =============================================================
    console.log('--- 阶段 8: 删除 3 个学生 ---')
    const deleteTargets = [...createdStudents].sort(() => Math.random() - 0.5).slice(0, 3)
    for (const s of deleteTargets) {
      const r = await cdp.api(`await window.api.eaa.deleteStudent('${s.name}','R56删除测试')`)
      if (r?.success) {
        s.deleted = true
        log('PASS', `删除学生 ${s.name}`)
      } else {
        log('FAIL', `删除 ${s.name} 失败`, r?.__error)
      }
    }
    // 验证 listStudents 不再包含已删除学生 (status=Deleted)
    const listAfterDel = await cdp.api(`await window.api.eaa.listStudents()`)
    const afterDelStudents = (listAfterDel?.data?.students || []).filter(s => s.status !== 'Deleted')
    const r56AfterDel = afterDelStudents.filter(s => s.name.includes(`R56${ts}`))
    const expectedAfterDel = createdStudents.length - deleteTargets.length
    if (r56AfterDel.length === expectedAfterDel)
      log('PASS', `删除后 R56 活跃学生数正确 (${r56AfterDel.length})`)
    else
      log('FAIL', `删除后学生数不符`, `${r56AfterDel.length}/${expectedAfterDel}`)

    console.log('')

    // =============================================================
    // 阶段 9: 删除 1 个班级 (验证学生保留)
    // =============================================================
    console.log('--- 阶段 9: 删除 1 个班级 (学生应保留) ---')
    const delClassTarget = rand(createdClassIds)
    const dcr = await cdp.api(`await window.api.class.delete('${delClassTarget.id}')`)
    if (dcr?.success) log('PASS', `删除班级 ${delClassTarget.name}`)
    else log('FAIL', `删除班级失败`, dcr?.__error)

    // 验证 class.list 不再包含该班
    const classListAfter = await cdp.api(`await window.api.class.list()`)
    const classStillExists = (classListAfter?.data || []).find(c => c.id === delClassTarget.id)
    if (!classStillExists) log('PASS', `class.list 已不含被删班级`)
    else log('FAIL', `被删班级仍在 class.list`)

    // 验证该班的学生仍存在 (EAA 学生独立, class.delete 仅删本地记录)
    const studentsInDeletedClass = createdStudents.filter(s => s.class_id === delClassTarget.class_id && !s.deleted)
    if (studentsInDeletedClass.length > 0) {
      let stillExistCount = 0
      for (const s of studentsInDeletedClass) {
        const sc = await cdp.api(`await window.api.eaa.score('${s.name}')`)
        if (sc?.success) stillExistCount++
      }
      if (stillExistCount === studentsInDeletedClass.length)
        log('PASS', `被删班级的 ${stillExistCount} 个学生仍存在 (数据保留)`)
      else
        log('FAIL', `学生保留数不符`, `${stillExistCount}/${studentsInDeletedClass.length}`)
    } else {
      log('PASS', `被删班级无活跃学生 (无需验证保留)`)
    }

    console.log('')

    // =============================================================
    // 阶段 10: 最终数据一致性校验
    // =============================================================
    console.log('--- 阶段 10: 最终数据一致性校验 ---')
    // stats
    const statsR = await cdp.api(`await window.api.eaa.stats()`)
    if (statsR?.success) log('PASS', `stats API 正常`)
    else log('FAIL', `stats API 失败`)

    // search R56
    const searchR = await cdp.api(`await window.api.eaa.search('R56${ts}', 100)`)
    if (searchR?.success) log('PASS', `search R56 正常`)
    else log('WARN', `search R56 异常`)

    // summary
    const summaryR = await cdp.api(`await window.api.eaa.summary()`)
    if (summaryR?.success) log('PASS', `summary API 正常`)
    else log('FAIL', `summary API 失败`)

    // doctor 健康检查
    const doctorR = await cdp.api(`await window.api.eaa.doctor()`)
    if (doctorR?.success) {
      const healthy = doctorR?.data?.healthy
      if (healthy) log('PASS', `doctor 健康检查通过`)
      else log('WARN', `doctor 健康检查异常`, JSON.stringify(doctorR?.data?.issues || []).slice(0, 100))
    } else log('FAIL', `doctor API 失败`)

    console.log('')

  } catch (e) {
    log('FAIL', '测试执行异常', e.message)
    console.error(e.stack)
  } finally {
    // =============================================================
    // 阶段 11: 清理所有 R56 数据
    // =============================================================
    console.log('--- 阶段 11: 清理所有 R56 数据 ---')
    try {
      // 清理学生
      const listR = await cdp.api(`await window.api.eaa.listStudents()`)
      const allStudents = listR?.data?.students || []
      const r56Students = allStudents.filter(s => s.name.includes(`R56${ts}`))
      let delStu = 0
      for (const s of r56Students) {
        if (s.status === 'Deleted') { delStu++; continue }
        const r = await cdp.api(`await window.api.eaa.deleteStudent('${s.name}','R56清理')`)
        if (r?.success) delStu++
      }
      console.log(`  清理学生: ${delStu}/${r56Students.length}`)

      // 清理班级
      const classListR = await cdp.api(`await window.api.class.list()`)
      const allClasses = classListR?.data || []
      const r56Classes = allClasses.filter(c => c.class_id.startsWith('R56C') && c.name.includes(ts))
      let delCls = 0
      for (const c of r56Classes) {
        const r = await cdp.api(`await window.api.class.delete('${c.id}')`)
        if (r?.success) delCls++
      }
      console.log(`  清理班级: ${delCls}/${r56Classes.length}`)

      // 验证
      const afterList = await cdp.api(`await window.api.eaa.listStudents()`)
      const afterActive = (afterList?.data?.students || []).filter(s => s.status !== 'Deleted')
      const r56Left = afterActive.filter(s => s.name.includes(`R56${ts}`))
      if (r56Left.length === 0) log('PASS', `清理后无 R56 学生残留`)
      else log('FAIL', `清理后仍有 ${r56Left.length} 个 R56 学生`)

    } catch (e) {
      log('WARN', '清理异常', e.message)
    }

    ws.close()
  }

  // =============================================================
  // 结果
  // =============================================================
  console.log('')
  console.log('=== R56 测试完成 ===')
  const total = RESULT.pass + RESULT.fail + RESULT.warn
  const rate = total > 0 ? ((RESULT.pass / total) * 100).toFixed(1) : '0.0'
  console.log(`结果: ${RESULT.pass} pass, ${RESULT.fail} fail, ${RESULT.warn} warn`)
  console.log(`通过率: ${rate}%`)

  if (RESULT.errors.length > 0) {
    console.log('')
    console.log('失败项:')
    RESULT.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`))
  }

  fs.writeFileSync(
    'dogfood-output/r56-e2e-result.json',
    JSON.stringify({ test: 'R56', timestamp: new Date().toISOString(), summary: { pass: RESULT.pass, fail: RESULT.fail, warn: RESULT.warn, rate: rate + '%' }, errors: RESULT.errors }, null, 2),
    'utf-8',
  )

  process.exit(RESULT.fail > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2) })
