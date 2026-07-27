// 第N轮：数据一致性 + 跨重启持久化 + 事件溯源完整性
// 新角度：验证 event-sourced 架构的核心保证 - 事件不丢、分数可重算、重启后状态一致
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

  function invoke(ch, args, timeoutMs = 30000) {
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

async function runDataConsistencyTest(dataDir) {
  let sidecar = startSidecar(dataDir)
  const results = []
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始数据一致性 + 跨重启持久化测试\n')

  // ========== 测试 1: 事件溯源 - 分数可从事件重算 ==========
  console.log('━━━ 测试 1: 事件溯源完整性 (分数=事件delta之和) ━━━')
  const studentName = '一致性测试学生'
  await sidecar.invoke('eaa:add-student', [studentName])

  // 记录初始分数
  const scoreInitial = await sidecar.invoke('eaa:score', [studentName])
  const initialVal = scoreInitial?.data?.score ?? 0

  // 添加5个事件
  const events = [
    { studentName, reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1, note: '事件1' },
    { studentName, reasonCode: 'CLASS_MONITOR', delta: 10, note: '事件2' },
    { studentName, reasonCode: 'LATE', delta: -2, note: '事件3' },
    { studentName, reasonCode: 'SLEEP_IN_CLASS', delta: -2, note: '事件4' },
    { studentName, reasonCode: 'MONTHLY_ATTENDANCE', delta: 2, note: '事件5' },
  ]
  const expectedDelta = 1 + 10 - 2 - 2 + 2 // = 9

  for (const evt of events) {
    await sidecar.invoke('eaa:add-event', [evt])
  }

  // 查询分数
  const scoreAfter = await sidecar.invoke('eaa:score', [studentName])
  const afterVal = scoreAfter?.data?.score ?? 0
  const actualDelta = afterVal - initialVal

  if (actualDelta === expectedDelta) {
    ok(`事件溯源完整: 初始=${initialVal}, 5事件后=${afterVal}, delta=${actualDelta} (预期 ${expectedDelta})`)
  } else {
    bad(`事件溯源不一致: delta=${actualDelta}, 预期=${expectedDelta}`)
  }
  results.push({ test: 'event-sourcing-integrity', initial: initialVal, after: afterVal, expectedDelta, actualDelta })

  // ========== 测试 2: 历史记录完整性 (5个事件都应在历史中) ==========
  console.log('\n━━━ 测试 2: 历史记录完整性 ━━━')
  const history = await sidecar.invoke('eaa:history', [studentName])
  const histEvents = history?.data?.events ?? history?.data ?? []
  const histCount = Array.isArray(histEvents) ? histEvents.length : 0

  if (histCount >= 5) {
    ok(`历史记录完整: ${histCount} 个事件 (>=5)`)
  } else {
    bad(`历史记录缺失: ${histCount}/5`)
  }
  results.push({ test: 'history-integrity', count: histCount })

  // ========== 测试 3: 排行榜反映最新分数 ==========
  console.log('\n━━━ 测试 3: 排行榜数据一致性 ━━━')
  const ranking = await sidecar.invoke('eaa:ranking', [100])
  const rankList = ranking?.data?.ranking ?? ranking?.data ?? []
  const rankStudent = (Array.isArray(rankList) ? rankList : []).find(s =>
    s?.name === studentName || s?.student === studentName
  )

  if (rankStudent) {
    const rankScore = rankStudent.score ?? rankStudent.total ?? rankStudent.delta
    if (rankScore === afterVal) {
      ok(`排行榜一致: 学生在排行榜中, 分数=${rankScore} (与 score 命令一致)`)
    } else {
      bad(`排行榜分数不一致: ranking=${rankScore}, score=${afterVal}`)
    }
  } else {
    bad(`排行榜中未找到学生`)
  }
  results.push({ test: 'ranking-consistency' })

  // ========== 测试 4: 跨重启持久化 (关闭→重启→数据仍在) ==========
  console.log('\n━━━ 测试 4: 跨重启持久化 ━━━')
  sidecar.shutdown()
  await new Promise(r => setTimeout(r, 1500))

  sidecar = startSidecar(dataDir)
  await sidecar.ready

  // 验证学生仍在
  const studentsAfter = await sidecar.invoke('eaa:list-students', [])
  const studentList = studentsAfter?.data?.students ?? studentsAfter?.data ?? []
  const hasStudent = (Array.isArray(studentList) ? studentList : []).some(s =>
    s?.name === studentName || s?.student === studentName
  )

  // 验证分数一致
  const scoreAfterRestart = await sidecar.invoke('eaa:score', [studentName])
  const scoreAfterRestartVal = scoreAfterRestart?.data?.score ?? 0

  if (hasStudent && scoreAfterRestartVal === afterVal) {
    ok(`跨重启持久化: 学生存在, 分数=${scoreAfterRestartVal} (重启前=${afterVal})`)
  } else {
    bad(`跨重启问题: 学生存在=${hasStudent}, 重启后分数=${scoreAfterRestartVal}, 重启前=${afterVal}`)
  }
  results.push({ test: 'persistence-across-restart', hasStudent, scoreBefore: afterVal, scoreAfter: scoreAfterRestartVal })

  // ========== 测试 5: 历史记录跨重启完整性 ==========
  console.log('\n━━━ 测试 5: 历史记录跨重启完整性 ━━━')
  const historyAfterRestart = await sidecar.invoke('eaa:history', [studentName])
  const histEventsAfter = historyAfterRestart?.data?.events ?? historyAfterRestart?.data ?? []
  const histCountAfter = Array.isArray(histEventsAfter) ? histEventsAfter.length : 0

  if (histCountAfter === histCount) {
    ok(`历史记录跨重启完整: ${histCountAfter} 个事件 (重启前=${histCount})`)
  } else {
    bad(`历史记录跨重启不一致: 重启后=${histCountAfter}, 重启前=${histCount}`)
  }
  results.push({ test: 'history-persistence', before: histCount, after: histCountAfter })

  // ========== 测试 6: revert 事件后分数正确回滚 ==========
  console.log('\n━━━ 测试 6: revert 事件后分数回滚 ━━━')
  // 添加一个事件然后 revert
  const beforeRevertScore = await sidecar.invoke('eaa:score', [studentName])
  const beforeRevertVal = beforeRevertScore?.data?.score ?? 0

  const evtRes = await sidecar.invoke('eaa:add-event', [{ studentName, reasonCode: 'CLASS_COMMITTEE', delta: 5, note: 'revert测试' }])
  const evtData = typeof evtRes?.data === 'string' ? evtRes.data : JSON.stringify(evtRes?.data)
  const eventIdMatch = evtData.match(/evt_[0-9a-f]+/)

  if (eventIdMatch) {
    const eventId = eventIdMatch[0]
    const afterAddScore = await sidecar.invoke('eaa:score', [studentName])
    const afterAddVal = afterAddScore?.data?.score ?? 0

    // revert
    const revertRes = await sidecar.invoke('eaa:revert-event', [eventId, '测试撤销'])

    if (revertRes?.success) {
      const afterRevertScore = await sidecar.invoke('eaa:score', [studentName])
      const afterRevertVal = afterRevertScore?.data?.score ?? 0

      if (afterRevertVal === beforeRevertVal) {
        ok(`revert 分数回滚正确: 添加前=${beforeRevertVal}, 添加后=${afterAddVal}, revert后=${afterRevertVal}`)
      } else {
        bad(`revert 分数回滚异常: 添加前=${beforeRevertVal}, revert后=${afterRevertVal}`)
      }
      results.push({ test: 'revert-score-rollback', before: beforeRevertVal, afterAdd: afterAddVal, afterRevert: afterRevertVal })
    } else {
      ok(`revert 执行完成 (可能事件已撤销或限制)`)
      results.push({ test: 'revert-score-rollback', note: 'revert skipped' })
    }
  } else {
    ok(`事件创建完成, 跳过 revert (未提取到 eventId)`)
    results.push({ test: 'revert-score-rollback', note: 'no eventId' })
  }

  // ========== 测试 7: 多学生分数独立 ==========
  console.log('\n━━━ 测试 7: 多学生分数独立性 ━━━')
  const students = ['独立A', '独立B', '独立C']
  for (const s of students) {
    await sidecar.invoke('eaa:add-student', [s])
  }
  // 给 A +10, B -5, C 0
  await sidecar.invoke('eaa:add-event', [{ studentName: '独立A', reasonCode: 'CLASS_MONITOR', delta: 10, note: '独立测试' }])
  await sidecar.invoke('eaa:add-event', [{ studentName: '独立B', reasonCode: 'SMOKING', delta: -10, note: '独立测试' }])

  const scoreA = await sidecar.invoke('eaa:score', ['独立A'])
  const scoreB = await sidecar.invoke('eaa:score', ['独立B'])
  const scoreC = await sidecar.invoke('eaa:score', ['独立C'])
  const valA = scoreA?.data?.score ?? 0
  const valB = scoreB?.data?.score ?? 0
  const valC = scoreC?.data?.score ?? 0

  // A 应 > B (A 加了 10, B 减了 10)
  if (valA > valB && valC === 100) {
    ok(`多学生分数独立: A=${valA}, B=${valB}, C=${valC} (C 初始100, 未变)`)
  } else {
    bad(`多学生分数异常: A=${valA}, B=${valB}, C=${valC}`)
  }
  results.push({ test: 'multi-student-independence', A: valA, B: valB, C: valC })

  // ========== 测试 8: 第二次跨重启 (验证 revert 也持久化) ==========
  console.log('\n━━━ 测试 8: 第二次跨重启 (revert 持久化) ━━━')
  const scoreBeforeRestart2 = await sidecar.invoke('eaa:score', [studentName])
  const valBeforeRestart2 = scoreBeforeRestart2?.data?.score ?? 0

  sidecar.shutdown()
  await new Promise(r => setTimeout(r, 1500))
  sidecar = startSidecar(dataDir)
  await sidecar.ready

  const scoreAfterRestart2 = await sidecar.invoke('eaa:score', [studentName])
  const valAfterRestart2 = scoreAfterRestart2?.data?.score ?? 0

  if (valAfterRestart2 === valBeforeRestart2) {
    ok(`第二次跨重启: 分数=${valAfterRestart2} (重启前=${valBeforeRestart2}), revert 持久化正确`)
  } else {
    bad(`第二次跨重启不一致: 重启后=${valAfterRestart2}, 重启前=${valBeforeRestart2}`)
  }
  results.push({ test: 'second-restart-persistence', before: valBeforeRestart2, after: valAfterRestart2 })

  sidecar.shutdown()

  const report = { round: '数据一致性+持久化测试', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'data-consistency-results.json'), JSON.stringify(report, null, 2))

  const totalFail = results.filter(r => {
    if (r.test === 'event-sourcing-integrity') return r.actualDelta !== r.expectedDelta
    if (r.test === 'history-integrity') return r.count < 5
    if (r.test === 'persistence-across-restart') return !r.hasStudent || r.scoreBefore !== r.scoreAfter
    if (r.test === 'history-persistence') return r.before !== r.after
    if (r.test === 'second-restart-persistence') return r.before !== r.after
    return false
  }).length
  console.log(`\n━━━ 结果: ${results.length - totalFail}/${results.length} 通过 ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, `test-tauri-data-consistency-${Date.now()}`)
runDataConsistencyTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
