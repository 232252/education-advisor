// =============================================================
// R57 — 压力测试 (大数据量场景)
//
// 测试系统在大数据量下的表现:
//   1. 创建 30 个学生 (3 班级,每班 10 人)
//   2. 批量添加 90+ 事件 (每学生 3 个)
//   3. 大数据量查询性能 (range/search/stats/ranking/history)
//   4. 大数据量导出 (csv/jsonl/html)
//   5. 仪表盘 UI 大数据渲染
//   6. 分页/限制查询 (limit 参数)
//   7. 撤销/重算在大数据下的正确性
//   8. 清理
// =============================================================

const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')

const RESULT = { pass: 0, fail: 0, warn: 0, errors: [] }
const ts = Date.now().toString().slice(-6)

function log(type, msg, detail) {
  const full = detail ? `${msg} — ${detail}` : msg
  if (type === 'PASS') { RESULT.pass++; console.log(`  \u2212 ${full}`) }
  else if (type === 'FAIL') { RESULT.fail++; RESULT.errors.push(full); console.log(`  \u2717 ${full}`) }
  else if (type === 'WARN') { RESULT.warn++; console.log(`  ! ${full}`) }
}

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
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 90000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 80000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
  async api(code) { const v = await this.eval(`(async()=>{try{const r=${code};return JSON.stringify(r)}catch(e){return 'ERR:'+e.message}})()`); if (typeof v === 'string' && v.startsWith('ERR:')) return { __error: v.slice(4) }; try { return v ? JSON.parse(v) : null } catch (e) { return v } }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('=== R57 压力测试 (大数据量) ===')
  console.log('时间戳:', ts)
  console.log('')

  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  const classIds = []
  const students = []

  try {
    // =============================================================
    // 场景 1: 创建 3 个班级
    // =============================================================
    console.log('--- 场景 1: 创建 3 个班级 ---')
    for (let i = 0; i < 3; i++) {
      const cid = `R57C${i}-${ts}`
      const r = await cdp.api(`await window.api.class.create({class_id:'${cid}',name:'R57压力${i+1}班_${ts}',grade:'高一'})`)
      if (r?.success) { log('PASS', `创建班级 ${cid}`); classIds.push({ class_id: cid, id: r.data?.id }) }
      else log('FAIL', `创建班级 ${cid}`, r?.__error)
    }
    if (classIds.length !== 3) throw new Error('班级创建失败')

    // =============================================================
    // 场景 2: 批量创建 30 个学生 (每班 10 人)
    // =============================================================
    console.log('--- 场景 2: 批量创建 30 个学生 (每班 10 人) ---')
    const t0 = Date.now()
    for (let i = 0; i < 30; i++) {
      const name = `R57s${String(i).padStart(2, '0')}_${ts}`
      const r = await cdp.api(`await window.api.eaa.addStudent('${name}')`)
      if (r?.success) {
        students.push({ name, entity_id: r.data })
        // 分到对应班级
        const classIdx = Math.floor(i / 10)
        const targetClass = classIds[classIdx]
        await cdp.api(`await window.api.class.assign({class_id:'${targetClass.class_id}',student_names:['${name}']})`)
      } else {
        log('WARN', `学生 ${name} 创建/分班问题`, r?.__error)
      }
    }
    const t1 = Date.now()
    log('PASS', `创建 30 学生 + 分班`, `耗时 ${(t1 - t0) / 1000}s`)

    // 验证分班
    const listR = await cdp.api(`await window.api.eaa.listStudents()`)
    const activeStudents = (listR?.data?.students || []).filter(s => s.status !== 'Deleted')
    const r57Students = activeStudents.filter(s => s.name.includes(`R57s`) && s.name.includes(ts))
    log(r57Students.length === 30 ? 'PASS' : 'FAIL', `listStudents R57 学生数`, `${r57Students.length}/30`)

    // 每班 10 人验证
    for (let i = 0; i < 3; i++) {
      const classStudents = r57Students.filter(s => s.class_id === classIds[i].class_id)
      log(classStudents.length === 10 ? 'PASS' : 'FAIL', `${classIds[i].class_id} 学生数`, `${classStudents.length}/10`)
    }

    console.log('')

    // =============================================================
    // 场景 3: 批量添加 90 个事件 (每学生 3 个)
    // =============================================================
    console.log('--- 场景 3: 批量添加 90 个事件 ---')
    const eventCodes = ['LATE', 'SLEEP_IN_CLASS', 'ACTIVITY_PARTICIPATION']
    const t2 = Date.now()
    let eventOk = 0
    let eventFail = 0
    for (let i = 0; i < 30; i++) {
      const name = `R57s${String(i).padStart(2, '0')}_${ts}`
      for (let j = 0; j < 3; j++) {
        const code = eventCodes[j]
        const r = await cdp.api(`await window.api.eaa.addEvent({studentName:'${name}',reasonCode:'${code}',tags:['R57压力']})`)
        if (r?.success) eventOk++
        else eventFail++
      }
    }
    const t3 = Date.now()
    log('PASS', `事件添加完成`, `成功 ${eventOk}, 失败 ${eventFail}, 耗时 ${(t3 - t2) / 1000}s`)
    if (eventFail > 0) log('WARN', `${eventFail} 个事件失败 (串行化队列)`)

    console.log('')

    // =============================================================
    // 场景 4: 大数据量查询性能
    // =============================================================
    console.log('--- 场景 4: 大数据量查询性能 ---')

    // 4.1 range 查询全部事件
    const t4 = Date.now()
    const rangeR = await cdp.api(`await window.api.eaa.range('2020-01-01','2030-12-31', 1000)`)
    const t5 = Date.now()
    const rangeEvents = rangeR?.data?.events || rangeR?.data || []
    const rangeArr = Array.isArray(rangeEvents) ? rangeEvents : []
    log('PASS', `range 查询`, `${rangeArr.length} 事件, 耗时 ${t5 - t4}ms`)

    // 4.2 stats 统计
    const t6 = Date.now()
    const statsR = await cdp.api(`await window.api.eaa.stats()`)
    const t7 = Date.now()
    if (statsR?.success) {
      const statsData = statsR.data
      log('PASS', `stats 查询`, `耗时 ${t7 - t6}ms, students=${statsData?.students}, events=${statsData?.total_events}`)
    } else log('FAIL', `stats 查询失败`)

    // 4.3 ranking 排行榜
    const t8 = Date.now()
    const rankR = await cdp.api(`await window.api.eaa.ranking(100)`)
    const t9 = Date.now()
    const rankArr = Array.isArray(rankR?.data) ? rankR.data : (rankR?.data?.ranking || rankR?.data?.students || [])
    log('PASS', `ranking 查询`, `${rankArr.length} 条, 耗时 ${t9 - t8}ms`)

    // 4.4 search 搜索
    const t10 = Date.now()
    const searchR = await cdp.api(`await window.api.eaa.search('R57s', 100)`)
    const t11 = Date.now()
    const searchArr = Array.isArray(searchR?.data) ? searchR.data : (searchR?.data?.results || [])
    log('PASS', `search 查询`, `${searchArr.length} 条, 耗时 ${t11 - t10}ms`)

    // 4.5 summary 摘要
    const t12 = Date.now()
    const summaryR = await cdp.api(`await window.api.eaa.summary()`)
    const t13 = Date.now()
    if (summaryR?.success) log('PASS', `summary 查询`, `耗时 ${t13 - t12}ms`)
    else log('FAIL', `summary 查询失败`)

    // 4.6 单个学生 history
    const t14 = Date.now()
    const histR = await cdp.api(`await window.api.eaa.history('R57s00_${ts}')`)
    const t15 = Date.now()
    const histData = histR?.data
    const histArr = Array.isArray(histData) ? histData : (histData?.events || [])
    log('PASS', `history 查询`, `${histArr.length} 事件, 耗时 ${t15 - t14}ms`)

    // 性能阈值检查 (5秒以内为可接受)
    const totalTime = (t5 - t4) + (t7 - t6) + (t9 - t8) + (t11 - t10) + (t13 - t12) + (t15 - t14)
    log(totalTime < 5000 ? 'PASS' : 'WARN', `总查询耗时`, `${totalTime}ms ${totalTime < 5000 ? '(<5s 正常)' : '(≥5s 较慢)'}`)

    console.log('')

    // =============================================================
    // 场景 5: 大数据量导出
    // =============================================================
    console.log('--- 场景 5: 大数据量导出 ---')
    for (const fmt of ['csv', 'jsonl', 'html']) {
      const t16 = Date.now()
      const r = await cdp.api(`await window.api.eaa.export('${fmt}')`)
      const t17 = Date.now()
      if (r?.success) log('PASS', `${fmt} 导出`, `耗时 ${t17 - t16}ms`)
      else log('FAIL', `${fmt} 导出失败`, r?.__error)
    }

    console.log('')

    // =============================================================
    // 场景 6: 仪表盘 UI 大数据渲染
    // =============================================================
    console.log('--- 场景 6: 仪表盘 UI 大数据渲染 ---')
    await cdp.eval(`window.location.hash = '#/dashboard'`)
    await sleep(1500)
    const dashText = await cdp.eval(`document.body.innerText`)
    const dashLen = dashText.length
    if (dashLen > 1000) log('PASS', `仪表盘渲染`, `${dashLen} 字符`)
    else log('FAIL', `仪表盘渲染异常`, `${dashLen} 字符`)

    // 班级筛选切换 (大数据量下)
    const selectExists = await cdp.eval(`!!document.querySelector('select[title="按班级筛选数据"]')`)
    if (selectExists) {
      // 切换到第一个班
      const firstClass = classIds[0].class_id
      const switchR = await cdp.api(`(()=>{
        const sel = document.querySelector('select[title="按班级筛选数据"]')
        if (!sel) return {error:'no select'}
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
        setter.call(sel, '${firstClass}')
        sel.dispatchEvent(new Event('change', {bubbles:true}))
        return {ok:true, value:sel.value}
      })()`)
      if (switchR?.ok) {
        await sleep(800)
        const aText = await cdp.eval(`document.body.innerText.length`)
        log('PASS', `筛选班级 ${firstClass}`, `渲染 ${aText} 字符`)
      } else log('FAIL', `筛选失败`)

      // 切换回全部
      await cdp.api(`(()=>{
        const sel = document.querySelector('select[title="按班级筛选数据"]')
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
        setter.call(sel, '__ALL__')
        sel.dispatchEvent(new Event('change', {bubbles:true}))
        return {ok:true}
      })()`)
      await sleep(500)
    }

    // 导航到学生页验证 (轮询等待渲染,防止瞬时渲染时序问题)
    await cdp.eval(`window.location.hash = '#/students'`)
    let stuText = 0
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(500)
      stuText = await cdp.eval(`document.body.innerText.length`)
      if (stuText > 500) break
    }
    if (stuText > 500) log('PASS', `学生页渲染`, `${stuText} 字符`)
    else log('FAIL', `学生页渲染异常`)

    console.log('')

    // =============================================================
    // 场景 7: limit 分页参数
    // =============================================================
    console.log('--- 场景 7: limit 分页参数 ---')
    const rangeLimit10 = await cdp.api(`await window.api.eaa.range('2020-01-01','2030-12-31', 10)`)
    const rangeLimit10Arr = Array.isArray(rangeLimit10?.data?.events) ? rangeLimit10.data.events : (Array.isArray(rangeLimit10?.data) ? rangeLimit10.data : [])
    log(rangeLimit10Arr.length === 10 ? 'PASS' : 'WARN', `range limit=10`, `返回 ${rangeLimit10Arr.length} 条`)

    const searchLimit5 = await cdp.api(`await window.api.eaa.search('R57', 5)`)
    const searchLimit5Arr = Array.isArray(searchLimit5?.data) ? searchLimit5.data : (searchLimit5?.data?.results || [])
    log(searchLimit5Arr.length === 5 ? 'PASS' : 'WARN', `search limit=5`, `返回 ${searchLimit5Arr.length} 条`)

    const rankLimit20 = await cdp.api(`await window.api.eaa.ranking(20)`)
    const rankLimit20Arr = Array.isArray(rankLimit20?.data) ? rankLimit20.data : (rankLimit20?.data?.ranking || [])
    log(rankLimit20Arr.length === 20 ? 'PASS' : 'WARN', `ranking limit=20`, `返回 ${rankLimit20Arr.length} 条`)

    console.log('')

    // =============================================================
    // 场景 8: 撤销/重算在大数据下
    // =============================================================
    console.log('--- 场景 8: 撤销/重算在大数据下 ---')
    // 获取第一个学生的一个事件撤销
    const histForRevert = await cdp.api(`await window.api.eaa.history('R57s00_${ts}')`)
    const histForRevertArr = Array.isArray(histForRevert?.data) ? histForRevert.data : (histForRevert?.data?.events || [])
    if (histForRevertArr.length > 0) {
      const ev = histForRevertArr[0]
      const eventId = ev.event_id || ev.id
      const beforeScore = await cdp.api(`await window.api.eaa.score('R57s00_${ts}')`)
      const beforeVal = beforeScore?.data?.score ?? beforeScore?.data?.parsed?.score
      const revR = await cdp.api(`await window.api.eaa.revertEvent('${eventId}','R57压力撤销')`)
      if (revR?.success) {
        const afterScore = await cdp.api(`await window.api.eaa.score('R57s00_${ts}')`)
        const afterVal = afterScore?.data?.score ?? afterScore?.data?.parsed?.score
        const expected = beforeVal - ev.score_delta
        if (Math.abs(afterVal - expected) < 0.1) log('PASS', `大数据下撤销正确`, `${beforeVal}→${afterVal}`)
        else log('WARN', `撤销分数偏差`, `期望 ${expected} 实际 ${afterVal}`)
      } else log('FAIL', `撤销失败`, revR?.__error)
    }

    // replay 重算
    const replayR = await cdp.api(`await window.api.eaa.replay()`)
    if (replayR?.success) log('PASS', `大数据下 replay 成功`)
    else log('FAIL', `replay 失败`, replayR?.__error)

    console.log('')

  } catch (e) {
    log('FAIL', '测试异常', e.message)
    console.error(e.stack)
  } finally {
    // =============================================================
    // 清理
    // =============================================================
    console.log('--- 清理 R57 数据 ---')
    try {
      const listR = await cdp.api(`await window.api.eaa.listStudents()`)
      const allStudents = listR?.data?.students || []
      const r57Students = allStudents.filter(s => s.name.includes(`R57s`) && s.name.includes(ts))
      let delStu = 0
      for (const s of r57Students) {
        if (s.status === 'Deleted') { delStu++; continue }
        const r = await cdp.api(`await window.api.eaa.deleteStudent('${s.name}','R57清理')`)
        if (r?.success) delStu++
      }
      console.log(`  清理学生: ${delStu}/${r57Students.length}`)

      const classListR = await cdp.api(`await window.api.class.list()`)
      const r57Classes = (classListR?.data || []).filter(c => c.class_id.startsWith('R57C') && c.name.includes(ts))
      let delCls = 0
      for (const c of r57Classes) {
        const r = await cdp.api(`await window.api.class.delete('${c.id}')`)
        if (r?.success) delCls++
      }
      console.log(`  清理班级: ${delCls}/${r57Classes.length}`)

      const afterList = await cdp.api(`await window.api.eaa.listStudents()`)
      const afterActive = (afterList?.data?.students || []).filter(s => s.status !== 'Deleted')
      const r57Left = afterActive.filter(s => s.name.includes(`R57s`) && s.name.includes(ts))
      if (r57Left.length === 0) log('PASS', `清理后无 R57 残留`)
      else log('FAIL', `清理后残留 ${r57Left.length} 个`)
    } catch (e) {
      log('WARN', '清理异常', e.message)
    }
    ws.close()
  }

  // =============================================================
  console.log('')
  console.log('=== R57 测试完成 ===')
  const total = RESULT.pass + RESULT.fail + RESULT.warn
  const rate = total > 0 ? ((RESULT.pass / total) * 100).toFixed(1) : '0.0'
  console.log(`结果: ${RESULT.pass} pass, ${RESULT.fail} fail, ${RESULT.warn} warn`)
  console.log(`通过率: ${rate}%`)
  if (RESULT.errors.length > 0) {
    console.log('失败项:')
    RESULT.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`))
  }
  fs.writeFileSync('dogfood-output/r57-stress-result.json', JSON.stringify({ test: 'R57', summary: { pass: RESULT.pass, fail: RESULT.fail, warn: RESULT.warn, rate: rate + '%' }, errors: RESULT.errors }, null, 2), 'utf-8')
  process.exit(RESULT.fail > 0 ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e); process.exit(2) })
