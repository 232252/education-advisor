// 数据完整性测试 — 验证分数计算/排名/统计/搜索/导出的数学正确性
// 新角度: 不仅验证"不崩溃",更验证"计算结果正确"
// 测试: 已知输入 → 验证期望输出 (score/ranking/stats/search/export/dryRun/force/tag)
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(ROOT, 'test-results')
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })

function startSidecar(dataDir) {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: { ...process.env, EDU_APP_DATA_DIR: dataDir, EDU_RESOURCE_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1

  const ready = new Promise((resolveR, reject) => {
    const t = setTimeout(() => reject(new Error('ready timeout')), 25000)
    const checker = (line) => {
      try {
        const m = JSON.parse(line)
        if (m.type === 'event' && m.channel === '__sidecar__:ready') {
          clearTimeout(t); rl.off('line', checker); resolveR(m.data)
        }
      } catch {}
    }
    rl.on('line', checker)
  })

  rl.on('line', (line) => {
    let m; try { m = JSON.parse(line) } catch { return }
    if (m.type === 'result' && m.id != null) {
      const p = pending.get(m.id)
      if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) }
    }
  })

  function invoke(ch, args, timeoutMs = 30000) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n')
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs)
    })
  }
  function invokeQuiet(ch, args, timeoutMs = 30000) {
    return invoke(ch, args, timeoutMs).then(
      (data) => ({ ok: true, data }),
      (error) => ({ ok: false, error: error.message }),
    )
  }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} setTimeout(() => { try { child.kill() } catch {} }, 800) }
  return { ready, invoke, invokeQuiet, shutdown, child }
}

const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { console.log(`  ✗ ${msg}`); process.exitCode = 1 }
let passCount = 0, failCount = 0
const report = (cond, msg) => { if (cond) { ok(msg); passCount++ } else { bad(msg); failCount++ } }

// 原因码 delta 表 (从 config/reason-codes.json)
const DELTA = {
  LATE: -2,
  SPEAK_IN_CLASS: -2,
  SLEEP_IN_CLASS: -2,
  DESK_UNALIGNED: -1,
  OTHER_DEDUCT: -1,
  APPEARANCE_VIOLATION: -2,
  ACTIVITY_PARTICIPATION: 1,
  CIVILIZED_DORM: 3,
  MONTHLY_ATTENDANCE: 2,
  CLASS_COMMITTEE: 5,
}

async function runDataIntegrityTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始数据完整性测试\n')

  // ========== 准备: 创建已知数据集 ==========
  console.log('━━━ 准备: 创建已知数据集 ━━━')
  // EAA 系统使用基准分 100, delta 在 100 之上加减
  // 学生A: 100 + LATE(-2) + SPEAK_IN_CLASS(-2) + ACTIVITY_PARTICIPATION(+1) = 97
  // 学生B: 100 + CIVILIZED_DORM(+3) + MONTHLY_ATTENDANCE(+2) = 105
  // 学生C: 100 + DESK_UNALIGNED(-1) + OTHER_DEDUCT(-1) + APPEARANCE_VIOLATION(-2) = 96
  // 学生D: 100 + CLASS_COMMITTEE(+5) + ACTIVITY_PARTICIPATION(+1) = 106
  const students = ['完整测试A', '完整测试B', '完整测试C', '完整测试D']
  for (const s of students) {
    await sidecar.invokeQuiet('eaa:add-student', [s])
  }

  // 学生A 的事件
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试A', reasonCode: 'LATE', delta: -2, note: '迟到一次' }])
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试A', reasonCode: 'SPEAK_IN_CLASS', delta: -2, note: '课堂讲话' }])
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试A', reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1, note: '活动参与' }])

  // 学生B 的事件
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试B', reasonCode: 'CIVILIZED_DORM', delta: 3, note: '文明寝室' }])
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试B', reasonCode: 'MONTHLY_ATTENDANCE', delta: 2, note: '月勤奖励' }])

  // 学生C 的事件
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试C', reasonCode: 'DESK_UNALIGNED', delta: -1, note: '桌椅不齐' }])
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试C', reasonCode: 'OTHER_DEDUCT', delta: -1, note: '其他扣分' }])
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试C', reasonCode: 'APPEARANCE_VIOLATION', delta: -2, note: '仪容违纪' }])

  // 学生D 的事件
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试D', reasonCode: 'CLASS_COMMITTEE', delta: 5, note: '班委履职' }])
  await sidecar.invokeQuiet('eaa:add-event', [{ studentName: '完整测试D', reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1, note: '活动参与' }])

  console.log(`    已创建 ${students.length} 个学生, 共 10 个事件`)

  // ========== 测试1: 分数计算正确性 ==========
  console.log('\n━━━ 测试1: 分数计算正确性 ━━━')
  const expectedScores = {
    '完整测试A': 97,   // 100 + (-2) + (-2) + 1
    '完整测试B': 105,  // 100 + 3 + 2
    '完整测试C': 96,   // 100 + (-1) + (-1) + (-2)
    '完整测试D': 106,  // 100 + 5 + 1
  }

  for (const [name, expected] of Object.entries(expectedScores)) {
    const r = await sidecar.invokeQuiet('eaa:score', [name])
    const actual = r.data?.data?.score ?? r.data?.score
    report(actual === expected, `${name} 分数: ${actual} (期望 ${expected})`)
  }

  // ========== 测试2: 排名顺序正确性 ==========
  console.log('\n━━━ 测试2: 排名顺序正确性 ━━━')
  // 期望排名: D(+6) > B(+5) > A(-3) > C(-4)
  const rankingRes = await sidecar.invokeQuiet('eaa:ranking', [10])
  const ranking = rankingRes.data?.data?.ranking || rankingRes.data?.ranking || []
  report(ranking.length >= 4, `排名数量: ${ranking.length} (应>=4)`)

  if (ranking.length >= 4) {
    // 找到我们的4个测试学生
    const testStudents = ranking.filter(r => students.includes(r.name))
    testStudents.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    const expectedOrder = ['完整测试D', '完整测试B', '完整测试A', '完整测试C']
    const actualOrder = testStudents.map(s => s.name)
    report(JSON.stringify(actualOrder) === JSON.stringify(expectedOrder),
      `排名顺序: ${actualOrder.join(' > ')} (期望 ${expectedOrder.join(' > ')})`)

    // 验证排名中的分数也正确
    for (const s of testStudents) {
      report(s.score === expectedScores[s.name],
        `排名中 ${s.name} 分数: ${s.score} (期望 ${expectedScores[s.name]})`)
    }
  }

  // ========== 测试3: 历史完整性 ==========
  console.log('\n━━━ 测试3: 历史完整性 ━━━')
  for (const [name, expected] of Object.entries({ '完整测试A': 3, '完整测试B': 2, '完整测试C': 3, '完整测试D': 2 })) {
    const r = await sidecar.invokeQuiet('eaa:history', [name])
    const events = r.data?.data?.events || r.data?.events || []
    report(events.length === expected, `${name} 历史事件数: ${events.length} (期望 ${expected})`)
  }

  // ========== 测试4: 统计数据正确性 ==========
  console.log('\n━━━ 测试4: 统计数据正确性 ━━━')
  const statsRes = await sidecar.invokeQuiet('eaa:stats', [])
  report(statsRes.ok, `eaa:stats: ${statsRes.ok ? '成功' : statsRes.error}`)
  if (statsRes.ok) {
    const stats = statsRes.data?.data || statsRes.data
    console.log(`    统计: ${JSON.stringify(stats).slice(0, 200)}`)
    // stats 至少应该有数据
    report(stats != null, `统计数据非空`)
  }

  // ========== 测试5: 搜索准确性 ==========
  console.log('\n━━━ 测试5: 搜索准确性 ━━━')
  // 搜索 note 包含 "活动参与" 的事件
  const searchRes = await sidecar.invokeQuiet('eaa:search', ['活动参与'])
  report(searchRes.ok, `eaa:search "活动参与": ${searchRes.ok ? '成功' : searchRes.error}`)
  if (searchRes.ok) {
    const searchResults = searchRes.data?.data?.events || searchRes.data?.events || searchRes.data?.data || []
    const searchCount = Array.isArray(searchResults) ? searchResults.length : (searchRes.data?.data?.count || 0)
    console.log(`    搜索结果数: ${searchCount}`)
    report(searchCount >= 2, `搜索"活动参与"结果: ${searchCount} (应>=2, A和D都有)`)
  }

  // 搜索不存在的内容
  const searchEmpty = await sidecar.invokeQuiet('eaa:search', ['完全不存在的查询内容XYZ123'])
  report(searchEmpty.ok, `eaa:search 不存在内容: ${searchEmpty.ok ? '成功返回' : searchEmpty.error}`)

  // ========== 测试6: 日期范围查询 ==========
  console.log('\n━━━ 测试6: 日期范围查询 ━━━')
  // 修复: EAA CLI 用 chrono::Local::now() 记录 timestamp, 测试必须用本地日期
  // 旧代码用 new Date().toISOString() (UTC), 跨天时(UTC+8 凌晨0-8点)会差一天
  const _now = new Date()
  const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`
  const rangeRes = await sidecar.invokeQuiet('eaa:range', [today, today])
  report(rangeRes.ok, `eaa:range 今日: ${rangeRes.ok ? '成功' : rangeRes.error}`)
  if (rangeRes.ok) {
    const rangeData = rangeRes.data?.data?.events || rangeRes.data?.events || []
    console.log(`    今日事件数: ${Array.isArray(rangeData) ? rangeData.length : '?'}`)
    report(Array.isArray(rangeData) && rangeData.length >= 10, `今日事件数: ${rangeData.length} (应>=10)`)
  }

  // 日期范围校验: start > end 应被拒绝
  const rangeBad = await sidecar.invokeQuiet('eaa:range', ['2025-12-31', '2025-01-01'])
  report(rangeBad.ok === false, `eaa:range start>end 被拒绝`)

  // 非法日期格式
  const rangeBadFmt = await sidecar.invokeQuiet('eaa:range', ['invalid', 'also-invalid'])
  report(rangeBadFmt.ok === false, `eaa:range 非法格式被拒绝`)

  // ========== 测试7: Dry-Run 模式 ==========
  console.log('\n━━━ 测试7: Dry-Run 模式 ━━━')
  // 记录 dry-run 前的分数
  const scoreBefore = await sidecar.invokeQuiet('eaa:score', ['完整测试A'])
  const scoreBeforeVal = scoreBefore.data?.data?.score ?? scoreBefore.data?.score

  // dry-run 添加事件 (不应改变分数)
  const dryRunRes = await sidecar.invokeQuiet('eaa:add-event', [{
    studentName: '完整测试A', reasonCode: 'LATE', delta: -2, note: 'dry-run测试', dryRun: true,
  }])
  report(dryRunRes.ok, `eaa:add-event dryRun: ${dryRunRes.ok ? '成功' : dryRunRes.error}`)

  // 验证分数未变
  const scoreAfter = await sidecar.invokeQuiet('eaa:score', ['完整测试A'])
  const scoreAfterVal = scoreAfter.data?.data?.score ?? scoreAfter.data?.score
  report(scoreAfterVal === scoreBeforeVal, `dryRun 后分数不变: ${scoreBeforeVal} → ${scoreAfterVal}`)

  // ========== 测试8: 事件去重与 Force 模式 ==========
  console.log('\n━━━ 测试8: 事件去重与 Force 模式 ━━━')
  // 同一学生同一日同一原因码应被去重 (EAA CLI 始终去重, force 不绕过去重)
  const dupRes = await sidecar.invokeQuiet('eaa:add-event', [{
    studentName: '完整测试B', reasonCode: 'CIVILIZED_DORM', delta: 3, note: '重复事件',
  }])
  report(dupRes.data?.success === false,
    `重复事件被拒绝: ${dupRes.data?.success === false ? '是' : '否'}`)

  // force 模式不绕过去重, 但可绕过 delta 范围校验
  // 用不同原因码 + 超范围 delta + force 来验证 force 绕过 delta 校验
  const forceRes = await sidecar.invokeQuiet('eaa:add-event', [{
    studentName: '完整测试B', reasonCode: 'OTHER_DEDUCT', delta: -50, note: 'force超范围', force: true,
  }])
  report(forceRes.data?.success !== false,
    `eaa:add-event force(超范围delta): ${forceRes.data?.success !== false ? '成功' : forceRes.data?.stderr || forceRes.error}`)

  // 验证分数变化 (105 + (-50) = 55)
  if (forceRes.data?.success !== false) {
    const scoreAfterForce = await sidecar.invokeQuiet('eaa:score', ['完整测试B'])
    const scoreAfterForceVal = scoreAfterForce.data?.data?.score ?? scoreAfterForce.data?.score
    report(scoreAfterForceVal === 55, `force后分数: ${scoreAfterForceVal} (期望 55 = 105-50)`)
  }

  // force 不能绕过去重 (同一原因码)
  const forceDupRes = await sidecar.invokeQuiet('eaa:add-event', [{
    studentName: '完整测试B', reasonCode: 'CIVILIZED_DORM', delta: 3, note: 'force重复', force: true,
  }])
  report(forceDupRes.data?.success === false,
    `force不能绕过去重: ${forceDupRes.data?.success === false ? '是' : '否'}`)

  // ========== 测试9: Tag 管理 ==========
  console.log('\n━━━ 测试9: Tag 管理 ━━━')
  // 添加带 tag 的事件
  const tagRes = await sidecar.invokeQuiet('eaa:add-event', [{
    studentName: '完整测试A', reasonCode: 'SLEEP_IN_CLASS', delta: -2, note: '带标签事件', tags: ['test-tag-xyz'],
  }])
  report(tagRes.ok, `eaa:add-event with tag: ${tagRes.ok ? '成功' : tagRes.error}`)

  // 查询 tag
  const tagQuery = await sidecar.invokeQuiet('eaa:tag', ['test-tag-xyz'])
  report(tagQuery.ok, `eaa:tag 查询: ${tagQuery.ok ? '成功' : tagQuery.error}`)
  if (tagQuery.ok) {
    const tagData = tagQuery.data?.data || tagQuery.data
    console.log(`    Tag 数据: ${JSON.stringify(tagData).slice(0, 100)}`)
  }

  // 列出所有 tag
  const tagList = await sidecar.invokeQuiet('eaa:tag', [])
  report(tagList.ok, `eaa:tag 列表: ${tagList.ok ? '成功' : tagList.error}`)

  // ========== 测试10: 导出完整性 ==========
  console.log('\n━━━ 测试10: 导出完整性 ━━━')
  // 导出 CSV
  const csvFile = join(dataDir, `export-integrity-${Date.now()}.csv`)
  const exportCsv = await sidecar.invokeQuiet('eaa:export', ['csv', csvFile])
  report(exportCsv.ok, `eaa:export csv: ${exportCsv.ok ? '成功' : exportCsv.error}`)

  // 验证文件存在且非空
  if (existsSync(csvFile)) {
    const csvContent = readFileSync(csvFile, 'utf-8')
    report(csvContent.length > 0, `CSV 文件非空: ${csvContent.length} 字符`)
    // 验证包含测试学生
    const hasTestStudent = csvContent.includes('完整测试')
    report(hasTestStudent, `CSV 包含测试学生数据`)
    console.log(`    CSV 前 200 字符: ${csvContent.slice(0, 200)}`)
  } else {
    report(false, `CSV 文件不存在: ${csvFile}`)
  }

  // 导出 JSONL
  const jsonlFile = join(dataDir, `export-integrity-${Date.now()}.jsonl`)
  const exportJsonl = await sidecar.invokeQuiet('eaa:export', ['jsonl', jsonlFile])
  report(exportJsonl.ok, `eaa:export jsonl: ${exportJsonl.ok ? '成功' : exportJsonl.error}`)

  if (existsSync(jsonlFile)) {
    const jsonlContent = readFileSync(jsonlFile, 'utf-8')
    report(jsonlContent.length > 0, `JSONL 文件非空: ${jsonlContent.length} 字符`)
    // 验证每行是合法 JSON
    const lines = jsonlContent.trim().split('\n').filter(l => l.trim())
    let jsonOk = 0
    for (const line of lines) {
      try { JSON.parse(line); jsonOk++ } catch {}
    }
    report(jsonOk === lines.length, `JSONL 每行合法: ${jsonOk}/${lines.length}`)
  }

  // ========== 测试11: Revert 完整性 ==========
  console.log('\n━━━ 测试11: Revert 完整性 ━━━')
  // 获取学生D的历史
  const histD = await sidecar.invokeQuiet('eaa:history', ['完整测试D'])
  const eventsD = histD.data?.data?.events || histD.data?.events || []
  report(eventsD.length === 2, `学生D 事件数: ${eventsD.length} (期望 2)`)

  if (eventsD.length > 0) {
    const evtToRevert = eventsD[0]
    const evtId = evtToRevert.event_id || evtToRevert.id || evtToRevert.entity_id
    // EAA history 事件用 score_delta 字段 (Rust struct field name)
    const evtDelta = evtToRevert.score_delta ?? evtToRevert.delta ?? 0
    if (evtId) {
      const scoreBeforeRevert = await sidecar.invokeQuiet('eaa:score', ['完整测试D'])
      const scoreBeforeRevertVal = scoreBeforeRevert.data?.data?.score ?? scoreBeforeRevert.data?.score

      // revert 事件
      const revertRes = await sidecar.invokeQuiet('eaa:revert-event', [evtId, '测试撤销'])
      report(revertRes.ok, `eaa:revert-event: ${revertRes.ok ? '成功' : revertRes.error}`)

      // 验证事件数增加 (事件溯源: 2 + 1补偿 = 3)
      const histAfterRevert = await sidecar.invokeQuiet('eaa:history', ['完整测试D'])
      const eventsAfterRevert = histAfterRevert.data?.data?.events || histAfterRevert.data?.events || []
      report(eventsAfterRevert.length === 3, `revert 后事件数: ${eventsAfterRevert.length} (期望 3 = 2+1补偿)`)

      // 验证分数变化 (撤销事件的 delta 被反向扣除)
      const scoreAfterRevert = await sidecar.invokeQuiet('eaa:score', ['完整测试D'])
      const scoreAfterRevertVal = scoreAfterRevert.data?.data?.score ?? scoreAfterRevert.data?.score
      const expectedAfterRevert = scoreBeforeRevertVal - evtDelta
      report(scoreAfterRevertVal === expectedAfterRevert,
        `revert 后分数: ${scoreAfterRevertVal} (期望 ${expectedAfterRevert} = ${scoreBeforeRevertVal} - ${evtDelta})`)
    } else {
      report(false, `无法获取事件ID: ${JSON.stringify(evtToRevert).slice(0, 100)}`)
    }
  }

  // ========== 测试12: 班级生命周期 ==========
  console.log('\n━━━ 测试12: 班级生命周期 ━━━')
  // 创建班级
  const classId = `TEST-${Date.now()}`
  const createClass = await sidecar.invokeQuiet('class:create', [{
    class_id: classId,
    name: '测试班级',
    grade: '七年级',
    teacher: '张老师',
  }])
  // class:create 返回 {success:true, data:{...}} 或 {success:false, error:...}
  report(createClass.ok && createClass.data?.success !== false,
    `class:create: ${createClass.data?.success !== false ? '成功' : createClass.data?.error || createClass.error}`)
  if (createClass.data?.success === false) {
    console.log(`    ⚠️ class:create 失败: ${createClass.data?.error}`)
  }

  // 列出班级
  const listClass = await sidecar.invokeQuiet('class:list', [])
  report(listClass.ok, `class:list: ${listClass.ok ? '成功' : listClass.error}`)

  // 分配学生到班级
  const assignClass = await sidecar.invokeQuiet('class:assign', [{
    class_id: classId,
    student_names: ['完整测试A', '完整测试B'],
  }])
  report(assignClass.ok && assignClass.data?.success !== false, `class:assign: ${assignClass.ok ? '成功' : assignClass.error}`)

  // 验证学生的 class_id
  const studentsAfterAssign = await sidecar.invokeQuiet('eaa:list-students', [])
  if (studentsAfterAssign.ok) {
    const allStudents = studentsAfterAssign.data?.data?.students || []
    const testA = allStudents.find(s => s.name === '完整测试A')
    report(testA?.class_id === classId, `学生A class_id: ${testA?.class_id} (期望 ${classId})`)
  }

  // 存档班级
  const archiveClass = await sidecar.invokeQuiet('class:archive', [classId])
  report(archiveClass.ok, `class:archive: ${archiveClass.ok ? '成功' : archiveClass.error}`)

  // 恢复班级
  const restoreClass = await sidecar.invokeQuiet('class:restore', [classId])
  report(restoreClass.ok, `class:restore: ${restoreClass.ok ? '成功' : restoreClass.error}`)

  // 删除班级
  const deleteClass = await sidecar.invokeQuiet('class:delete', [classId])
  report(deleteClass.ok, `class:delete: ${deleteClass.ok ? '成功' : deleteClass.error}`)

  // ========== 测试13: 清理 ==========
  console.log('\n━━━ 测试13: 清理测试数据 ━━━')
  for (const s of students) {
    const r = await sidecar.invokeQuiet('eaa:delete-student', [s, { confirm: true, reason: '测试清理' }])
    report(r.ok, `删除 ${s}: ${r.ok ? '成功' : r.error}`)
  }

  // 最终检查
  const finalCheck = await sidecar.invokeQuiet('eaa:info', [])
  report(finalCheck.ok && finalCheck.data?.success === true, '数据完整性测试后 sidecar 正常响应')

  sidecar.shutdown()

  const testResults = {
    round: '数据完整性测试',
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount },
  }
  writeFileSync(resolve(RESULTS_DIR, 'data-integrity-results.json'), JSON.stringify(testResults, null, 2))
  console.log(`\n━━━ 结果: ${passCount}通过 / ${failCount}失败 ━━━\n`)
}

const dataDir = resolve(ROOT, `test-tauri-data-integrity-${Date.now()}`)
runDataIntegrityTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(failCount > 0 ? 1 : 0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
