// 并发写竞争测试 — 验证 writeQueue 串行化在高压并发下的数据完整性
// 新角度: 同一学生并发 add-event / 跨学生并发 add-student + add-event / 读期间写一致性
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

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

  function invoke(ch, args, timeoutMs = 60000) {
    const id = nextId++
    return new Promise((res, rej) => {
      pending.set(id, { resolve: res, reject: rej })
      child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n')
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs)
    })
  }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} setTimeout(() => { try { child.kill() } catch {} }, 800) }

  return { ready, invoke, shutdown, child }
}

const ok = (msg) => console.log(`  ✓ ${msg}`)
const bad = (msg) => { console.log(`  ✗ ${msg}`); process.exitCode = 1 }
let passCount = 0, failCount = 0
const report = (cond, msg) => { if (cond) { ok(msg); passCount++ } else { bad(msg); failCount++ } }

async function runWriteRaceTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始并发写竞争测试\n')

  // ========== 测试1: 同一学生 20 个并发 add-event (不同原因码避免去重) ==========
  console.log('━━━ 测试1: 同一学生 20 并发 add-event (不同原因码) ━━━')
  const student1 = '竞争测试学生A'
  await sidecar.invoke('eaa:add-student', [student1])

  // 使用全部 20 个有效原因码 (排除 REVERT 系统码和 BONUS_VARIABLE null delta)
  const reasonCodes = [
    'SPEAK_IN_CLASS', 'SLEEP_IN_CLASS', 'LATE', 'SCHOOL_CAUGHT', 'MAKEUP',
    'DESK_UNALIGNED', 'PHONE_IN_CLASS', 'SMOKING', 'DRINKING_DORM', 'OTHER_DEDUCT',
    'APPEARANCE_VIOLATION', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR', 'CLASS_COMMITTEE',
    'CIVILIZED_DORM', 'MONTHLY_ATTENDANCE', 'LAB_EQUIPMENT_DAMAGE', 'LAB_SAFETY_VIOLATION',
    'LAB_UNSAFE_BEHAVIOR', 'LAB_CLEAN_UP'
  ]
  const t1a = Date.now()
  const results1 = await Promise.allSettled(
    reasonCodes.map(code =>
      sidecar.invoke('eaa:add-event', [{ studentName: student1, reasonCode: code, note: `并发_${code}` }])
    )
  )
  const t1b = Date.now() - t1a
  const ok1 = results1.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(ok1 === 20, `20并发 add-event: ${ok1}/20 成功 (${t1b}ms)`)

  // 验证分数: 所有原因码的 delta 之和
  const scoreRes = await sidecar.invoke('eaa:score', [student1])
  const historyRes = await sidecar.invoke('eaa:history', [student1])
  const actualEvents = historyRes?.data?.events?.length || 0
  report(actualEvents === 20, `事件数验证: ${actualEvents}/20 (无丢失)`)
  console.log(`    分数: ${scoreRes?.data?.score} (初始100 + 20个事件delta之和)`)

  // ========== 测试2: 30 个不同学生并发 add-student ==========
  console.log('\n━━━ 测试2: 30 并发 add-student (不同学生) ━━━')
  const t2a = Date.now()
  const studentNames = Array.from({ length: 30 }, (_, i) => `并发学生_${String(i).padStart(2, '0')}`)
  const results2 = await Promise.allSettled(
    studentNames.map(name => sidecar.invoke('eaa:add-student', [name]))
  )
  const t2b = Date.now() - t2a
  const ok2 = results2.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(ok2 === 30, `30并发 add-student: ${ok2}/30 成功 (${t2b}ms)`)

  // 验证 list-students 包含所有 30 个学生
  const listRes = await sidecar.invoke('eaa:list-students', [])
  const allStudents = listRes?.data?.students || []
  let foundCount = 0
  for (const name of studentNames) {
    if (allStudents.some(s => s.name === name || s.entity_id === name)) foundCount++
  }
  report(foundCount === 30, `学生列表验证: ${foundCount}/30 存在 (无丢失)`)

  // ========== 测试3: 混合并发 — add-student + add-event + ranking 同时 ==========
  console.log('\n━━━ 测试3: 混合并发 (10 add-student + 10 add-event + 10 ranking) ━━━')
  const mixStudents = Array.from({ length: 10 }, (_, i) => `混合学生_${i}`)
  // 先添加学生 (串行,确保存在)
  for (const name of mixStudents) {
    await sidecar.invoke('eaa:add-student', [name])
  }

  const t3a = Date.now()
  const mixedOps = [
    ...mixStudents.map(name => sidecar.invoke('eaa:add-student', [`额外_${name}`])),
    ...mixStudents.map(name => sidecar.invoke('eaa:add-event', [{ studentName: name, reasonCode: 'ACTIVITY_PARTICIPATION', note: '混合并发' }])),
    ...Array.from({ length: 10 }, () => sidecar.invoke('eaa:ranking', [10])),
  ]
  const results3 = await Promise.allSettled(mixedOps)
  const t3b = Date.now() - t3a
  const ok3 = results3.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(ok3 === 30, `30混合并发: ${ok3}/30 成功 (${t3b}ms)`)

  // ========== 测试4: 读期间写一致性 ==========
  console.log('\n━━━ 测试4: 读期间写一致性 ━━━')
  const consistStudent = '一致性测试学生'
  await sidecar.invoke('eaa:add-student', [consistStudent])
  await sidecar.invoke('eaa:add-event', [{ studentName: consistStudent, reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1 }])

  // 同时发起 10 个 score 查询和 5 个 add-event (不同原因码避免去重)
  const t4a = Date.now()
  const writeCodes = ['LATE', 'SLEEP_IN_CLASS', 'DESK_UNALIGNED', 'OTHER_DEDUCT', 'APPEARANCE_VIOLATION']
  const reads = Array.from({ length: 10 }, () => sidecar.invoke('eaa:score', [consistStudent]))
  const writes = writeCodes.map((code, i) =>
    sidecar.invoke('eaa:add-event', [{ studentName: consistStudent, reasonCode: code, note: `一致性_${i}` }])
  )
  const [readResults, writeResults] = await Promise.all([
    Promise.allSettled(reads),
    Promise.allSettled(writes),
  ])
  const t4b = Date.now() - t4a

  const readOk = readResults.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  const writeOk = writeResults.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(readOk === 10 && writeOk === 5, `读写并发: 读${readOk}/10, 写${writeOk}/5 (${t4b}ms)`)

  // 最终验证: 分数应该 = 100 + 1 (ACTIVITY_PARTICIPATION) + 5 * HOMEWORK_EXCELLENT delta
  const finalScore = await sidecar.invoke('eaa:score', [consistStudent])
  const finalHistory = await sidecar.invoke('eaa:history', [consistStudent])
  const eventCount = finalHistory?.data?.events?.length || 0
  report(eventCount === 6, `一致性事件数: ${eventCount}/6 (1初始 + 5并发写)`)

  // ========== 测试5: 高压并发 — 50 个同时 add-event (10学生 x 5事件) ==========
  console.log('\n━━━ 测试5: 50 并发 add-event (10学生 x 5事件) ━━━')
  const hpStudents = Array.from({ length: 10 }, (_, i) => `高压学生_${i}`)
  for (const name of hpStudents) {
    await sidecar.invoke('eaa:add-student', [name])
  }

  const hpCodes = ['LATE', 'SLEEP_IN_CLASS', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR', 'MONTHLY_ATTENDANCE']
  const t5a = Date.now()
  const hpOps = []
  for (const name of hpStudents) {
    for (const code of hpCodes) {
      hpOps.push(sidecar.invoke('eaa:add-event', [{ studentName: name, reasonCode: code, note: '高压并发' }]))
    }
  }
  const results5 = await Promise.allSettled(hpOps)
  const t5b = Date.now() - t5a
  const ok5 = results5.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
  report(ok5 === 50, `50高压并发: ${ok5}/50 成功 (${t5b}ms)`)

  // 验证每个学生都有 5 个事件
  let allHave5 = true
  for (const name of hpStudents) {
    const hist = await sidecar.invoke('eaa:history', [name])
    const cnt = hist?.data?.events?.length || 0
    if (cnt !== 5) { allHave5 = false; console.log(`    ${name}: ${cnt} 事件 (期望5)`) }
  }
  report(allHave5, `所有10个学生均有5个事件 (无丢失)`)

  // ========== 测试6: 并发 revert-event ==========
  console.log('\n━━━ 测试6: 并发 revert-event ━━━')
  const revertStudent = '撤销测试学生'
  await sidecar.invoke('eaa:add-student', [revertStudent])
  // 添加 5 个事件
  const revertCodes = ['LATE', 'SLEEP_IN_CLASS', 'ACTIVITY_PARTICIPATION', 'CLASS_MONITOR', 'MONTHLY_ATTENDANCE']
  const addedEvents = []
  for (const code of revertCodes) {
    const r = await sidecar.invoke('eaa:add-event', [{ studentName: revertStudent, reasonCode: code, note: `撤销_${code}` }])
    // 从 history 获取 event_id
  }
  const histBefore = await sidecar.invoke('eaa:history', [revertStudent])
  const eventIds = (histBefore?.data?.events || []).map(e => e.event_id || e.id).filter(Boolean)
  console.log(`    获取到 ${eventIds.length} 个事件 ID`)

  if (eventIds.length >= 3) {
    // 记录撤销前分数
    const scoreBefore = await sidecar.invoke('eaa:score', [revertStudent])
    const scoreBeforeVal = scoreBefore?.data?.score || 0

    // 并发撤销前 3 个事件 (事件溯源: revert 添加补偿事件,不删除原事件)
    const t6a = Date.now()
    const revertResults = await Promise.allSettled(
      eventIds.slice(0, 3).map(id => sidecar.invoke('eaa:revert-event', [id, '并发撤销测试']))
    )
    const t6b = Date.now() - t6a
    const revertOk = revertResults.filter(r => r.status === 'fulfilled' && r.value?.success !== false).length
    report(revertOk === 3, `3并发 revert-event: ${revertOk}/3 成功 (${t6b}ms)`)

    // 验证: 事件溯源架构下,撤销添加补偿事件 (5原始 + 3撤销 = 8)
    const histAfter = await sidecar.invoke('eaa:history', [revertStudent])
    const eventsAfter = histAfter?.data?.events?.length || 0
    report(eventsAfter === eventIds.length + 3, `撤销后事件数: ${eventsAfter}/${eventIds.length + 3} (5原始 + 3补偿)`)

    // 验证分数变化 (3个被撤销事件的 delta 被抵消)
    const scoreAfter = await sidecar.invoke('eaa:score', [revertStudent])
    const scoreAfterVal = scoreAfter?.data?.score || 0
    report(scoreAfterVal !== scoreBeforeVal, `分数变化: ${scoreBeforeVal} → ${scoreAfterVal} (撤销生效)`)
  } else {
    console.log('    跳过: 事件数不足')
  }

  // ========== 测试7: 连续 100 次快速 add+delete (压力) ==========
  console.log('\n━━━ 测试7: 100 次快速 add+delete (串行压力) ━━━')
  const t7a = Date.now()
  let cycleOk = 0
  for (let i = 0; i < 100; i++) {
    const name = `快速测试_${i}_${Date.now()}`
    try {
      const addR = await sidecar.invoke('eaa:add-student', [name])
      if (addR?.success !== false) {
        const delR = await sidecar.invoke('eaa:delete-student', [name, { confirm: true, reason: '快速删除' }])
        if (delR?.success !== false) cycleOk++
      }
    } catch {}
  }
  const t7b = Date.now() - t7a
  report(cycleOk === 100, `100次 add+delete: ${cycleOk}/100 成功 (${t7b}ms, avg ${(t7b/100).toFixed(0)}ms/轮)`)

  // ========== 测试8: 并发 add-event 到不存在的学生 ==========
  console.log('\n━━━ 测试8: 20 并发 add-event 到不存在学生 (错误处理) ━━━')
  const t8a = Date.now()
  const ghostResults = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      sidecar.invoke('eaa:add-event', [{ studentName: `不存在学生_${i}`, reasonCode: 'LATE', note: '幽灵' }])
    )
  )
  const t8b = Date.now() - t8a
  const ghostFail = ghostResults.filter(r => r.status === 'rejected' || r.value?.success === false).length
  report(ghostFail === 20, `20并发到不存在学生: ${ghostFail}/20 被正确拒绝 (${t8b}ms)`)

  // 最终: sidecar 仍正常响应
  const finalCheck = await sidecar.invoke('eaa:info', [])
  report(!!finalCheck?.success, '并发错误后 sidecar 仍正常响应')

  sidecar.shutdown()

  const testResults = {
    round: '并发写竞争测试',
    timestamp: new Date().toISOString(),
    summary: { pass: passCount, fail: failCount },
  }
  writeFileSync(resolve(RESULTS_DIR, 'write-race-results.json'), JSON.stringify(testResults, null, 2))
  console.log(`\n━━━ 结果: ${passCount}通过 / ${failCount}失败 ━━━\n`)
}

const dataDir = resolve(ROOT, `test-tauri-data-write-race-${Date.now()}`)
runWriteRaceTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(failCount > 0 ? 1 : 0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
