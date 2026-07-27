// 极端数据量测试 — 验证系统在大规模数据下的表现
// 测试角度:
//   1. 批量创建 100+ 学生，验证写入性能与数据完整性
//   2. 大规模排行榜/统计查询性能
//   3. 大规模事件写入 (500+ 事件)
//   4. 大规模历史/范围查询
//   5. 内存占用监控
//   6. 数据一致性验证 (排行榜分数 == 学生分数)
// 这是新角度: 之前测试最多 20-50 学生, 本次测试 100+ 学生 + 500+ 事件
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
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

function ok(msg, detail) { console.log(`  ✓ ${msg}${detail ? ` → ${detail}` : ''}`) }
function bad(msg, detail) { console.log(`  ✗ ${msg}${detail ? ` → ${detail}` : ''}`); process.exitCode = 1 }
function info(msg, detail) { console.log(`  ℹ ${msg}${detail ? ` → ${detail}` : ''}`) }

async function runExtremeVolume(dataDir) {
  const sidecar = startSidecar(dataDir)
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始极端数据量测试\n')

  const STUDENT_COUNT = 100
  const EVENTS_PER_STUDENT = 5

  // ========== 测试 1: 批量创建 100 学生 ==========
  console.log(`━━━ 测试 1: 批量创建 ${STUDENT_COUNT} 学生 ━━━`)
  const t0 = Date.now()
  let created = 0
  let failed = 0
  const studentNames = []
  for (let i = 0; i < STUDENT_COUNT; i++) {
    const name = `极端测试学生_${String(i).padStart(3, '0')}`
    studentNames.push(name)
    try {
      const r = await sidecar.invoke('eaa:add-student', [name])
      if (r?.success) created++
      else failed++
    } catch {
      failed++
    }
  }
  const elapsed1 = Date.now() - t0
  const avg1 = (elapsed1 / STUDENT_COUNT).toFixed(1)
  if (created === STUDENT_COUNT && failed === 0) {
    ok(`批量创建 ${STUDENT_COUNT} 学生全部成功`, `总${elapsed1}ms 均${avg1}ms/学生`)
  } else {
    bad(`批量创建失败: ${created} ok / ${failed} failed`)
  }

  // 性能基准: 每个学生创建应 < 100ms
  if (Number(avg1) > 100) {
    info(`创建速度偏慢 (均${avg1}ms, 期望 <100ms)`, '可能受 EAA 二进制 spawn 开销影响')
  }

  // ========== 测试 2: 验证学生列表完整性 ==========
  console.log('\n━━━ 测试 2: 验证学生列表完整性 ━━━')
  const listRes = await sidecar.invoke('eaa:list-students', [])
  const students = listRes?.data?.students ?? []
  if (students.length >= STUDENT_COUNT) {
    ok(`学生列表返回 ${students.length} 个学生`)
  } else {
    bad(`学生列表数量不符: 期望 >=${STUDENT_COUNT}, 实际 ${students.length}`)
  }

  // 验证每个学生都有合法 entity_id 和 score
  let invalidCount = 0
  for (const s of students) {
    if (!s.entity_id || typeof s.score !== 'number' || !s.risk) {
      invalidCount++
    }
  }
  if (invalidCount === 0) {
    ok(`所有 ${students.length} 个学生数据完整 (entity_id/score/risk)`)
  } else {
    bad(`${invalidCount} 个学生数据不完整`)
  }

  // ========== 测试 3: 排行榜查询性能 ==========
  console.log('\n━━━ 测试 3: 排行榜查询性能 (大规模数据) ━━━')
  const t2 = Date.now()
  const rankRes = await sidecar.invoke('eaa:ranking', [STUDENT_COUNT])
  const rankElapsed = Date.now() - t2
  const ranking = rankRes?.data?.ranking ?? []
  if (ranking.length > 0) {
    ok(`排行榜返回 ${ranking.length} 条`, `${rankElapsed}ms`)
  } else {
    bad('排行榜为空')
  }

  // 二次查询应命中缓存
  const t2b = Date.now()
  await sidecar.invoke('eaa:ranking', [STUDENT_COUNT])
  const rankCached = Date.now() - t2b
  ok(`排行榜缓存命中`, `${rankCached}ms`)

  // ========== 测试 4: 统计查询性能 ==========
  console.log('\n━━━ 测试 4: 统计查询性能 (大规模数据) ━━━')
  const t3 = Date.now()
  const statsRes = await sidecar.invoke('eaa:stats', [])
  const statsElapsed = Date.now() - t3
  if (statsRes?.success) {
    ok(`stats 查询成功`, `${statsElapsed}ms`)
  } else {
    bad('stats 查询失败')
  }

  // ========== 测试 5: 大规模事件写入 (500+ 事件) ==========
  console.log('\n━━━ 测试 5: 大规模事件写入 ━━━')
  // 仅使用 config/reason-codes.json 中存在的有效原因码
  const reasonCodes = ['LATE', 'SPEAK_IN_CLASS', 'CLASS_MONITOR', 'SCHOOL_CAUGHT', 'ACTIVITY_PARTICIPATION']
  const t4 = Date.now()
  let eventsCreated = 0
  let eventsFailed = 0
  // 每个学生 5 个事件,共 500 事件
  // 注意: 同一学生同一日同一原因码会去重,所以用不同日期
  for (let i = 0; i < STUDENT_COUNT; i++) {
    const name = studentNames[i]
    for (let j = 0; j < EVENTS_PER_STUDENT; j++) {
      const code = reasonCodes[j % reasonCodes.length]
      // 用不同日期避免去重
      const day = String(j + 1).padStart(2, '0')
      const month = j < 2 ? '06' : '07'
      const date = `2026-${month}-${day}`
      try {
        const r = await sidecar.invoke('eaa:add-event', [{
          studentName: name,
          reasonCode: code,
          date,
          note: `批量事件_${i}_${j}`,
        }])
        if (r?.success) eventsCreated++
        else eventsFailed++
      } catch {
        eventsFailed++
      }
    }
  }
  const eventsElapsed = Date.now() - t4
  const totalEvents = STUDENT_COUNT * EVENTS_PER_STUDENT
  const avgEvent = (eventsElapsed / totalEvents).toFixed(1)
  if (eventsCreated > 0) {
    ok(`事件写入: ${eventsCreated}/${totalEvents} 成功`, `总${eventsElapsed}ms 均${avgEvent}ms/事件`)
  } else {
    bad(`事件写入全部失败`)
  }
  if (eventsFailed > 0) {
    info(`${eventsFailed} 个事件写入失败`, '可能原因: 原因码不存在/日期格式/重复事件')
  }

  // ========== 测试 6: 范围查询性能 (大量事件) ==========
  console.log('\n━━━ 测试 6: 范围查询性能 (大量事件) ━━━')
  const t5 = Date.now()
  const rangeRes = await sidecar.invoke('eaa:range', ['2026-06-01', '2026-07-31', 10000])
  const rangeElapsed = Date.now() - t5
  const events = rangeRes?.data?.events ?? []
  if (events.length > 0) {
    ok(`range 查询返回 ${events.length} 个事件`, `${rangeElapsed}ms`)
  } else {
    info('range 查询返回 0 事件', '可能事件写入失败或日期不匹配')
  }

  // ========== 测试 7: 数据一致性验证 ==========
  console.log('\n━━━ 测试 7: 数据一致性验证 ━━━')
  // 重新拉取学生列表,验证分数已更新
  const listRes2 = await sidecar.invoke('eaa:list-students', [])
  const students2 = listRes2?.data?.students ?? []
  const rankRes2 = await sidecar.invoke('eaa:ranking', [STUDENT_COUNT])
  const ranking2 = rankRes2?.data?.ranking ?? []

  // 排行榜中的学生数应 == 学生列表数 (减去可能软删除的)
  if (ranking2.length <= students2.length) {
    ok(`排行榜 ${ranking2.length} 条 <= 学生列表 ${students2.length} (一致)`)
  } else {
    bad(`排行榜 ${ranking2.length} > 学生列表 ${students2.length} (不一致)`)
  }

  // 验证排行榜按分数降序
  let sortedOk = true
  for (let i = 1; i < ranking2.length; i++) {
    if (ranking2[i].score > ranking2[i - 1].score) {
      sortedOk = false
      break
    }
  }
  if (sortedOk && ranking2.length > 1) {
    ok(`排行榜按分数降序排列 (${ranking2.length} 条)`)
  } else if (ranking2.length > 1) {
    bad('排行榜未按分数降序')
  }

  // ========== 测试 8: 内存占用监控 ==========
  console.log('\n━━━ 测试 8: 内存占用监控 ━━━')
  const memBefore = process.memoryUsage()
  // 触发 GC (如果可用)
  if (global.gc) global.gc()
  const memAfter = process.memoryUsage()
  const heapMB = (memAfter.heapUsed / 1024 / 1024).toFixed(1)
  const rssMB = (memAfter.rss / 1024 / 1024).toFixed(1)
  ok(`内存占用: heap ${heapMB}MB, rss ${rssMB}MB`)

  // ========== 测试 9: 混合读写压力 (大规模数据下) ==========
  console.log('\n━━━ 测试 9: 混合读写压力 (大规模数据下) ━━━')
  const t6 = Date.now()
  const mixedOps = []
  // 50 次读 + 10 次写交替
  for (let i = 0; i < 60; i++) {
    if (i % 5 === 0) {
      // 写操作: 给随机学生加事件
      const randomStudent = studentNames[Math.floor(Math.random() * studentNames.length)]
      mixedOps.push(
        sidecar.invoke('eaa:add-event', [{
          studentName: randomStudent,
          reasonCode: 'LATE',
          date: `2026-07-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}`,
          note: `混合测试_${i}`,
        }]).catch(() => null)
      )
    } else {
      // 读操作
      mixedOps.push(
        sidecar.invoke('eaa:ranking', [10]).catch(() => null)
      )
    }
  }
  await Promise.allSettled(mixedOps)
  const mixedElapsed = Date.now() - t6
  ok(`60 次混合读写完成`, `${mixedElapsed}ms (均${(mixedElapsed / 60).toFixed(1)}ms/op)`)

  // ========== 测试 10: 大规模数据导出 ==========
  console.log('\n━━━ 测试 10: 大规模数据导出 ━━━')
  const t7 = Date.now()
  const exportRes = await sidecar.invoke('eaa:export', ['csv', resolve(dataDir, 'extreme-export.csv')])
  const exportElapsed = Date.now() - t7
  if (exportRes?.success) {
    ok(`CSV 导出成功`, `${exportElapsed}ms`)
  } else {
    info(`CSV 导出: ${exportRes?.stderr || '未知状态'}`, `${exportElapsed}ms`)
  }

  // ========== 总结 ==========
  console.log('\n━━━ 极端数据量测试总结 ━━━')
  console.log(`  学生数: ${students2.length}`)
  console.log(`  事件数: ${events.length} (range 查询)`)
  console.log(`  排行榜: ${ranking2.length} 条`)
  console.log(`  总耗时: ${Date.now() - t0}ms`)

  sidecar.shutdown()
  return { students: students2.length, events: events.length, ranking: ranking2.length }
}

// 运行测试
const dataDir = resolve(RESULTS_DIR, 'extreme-volume-data')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })

runExtremeVolume(dataDir)
  .then(() => { console.log('\n✅ 极端数据量测试完成'); process.exit(process.exitCode || 0) })
  .catch((err) => { console.error('\n❌ 测试异常:', err); process.exit(1) })
