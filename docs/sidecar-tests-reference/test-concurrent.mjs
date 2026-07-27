// 第8轮：并发写安全 + 大数据集
// A. 20 个学生同时 add (并发，检测写队列竞态)
// B. 50 个学生顺序加 (大数据集，检测性能退化)
// C. 混合读写并发 (一边加学生一边读排行榜)
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
  const ready = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('ready timeout')), 25000); const c = (l) => { try { const m = JSON.parse(l); if (m.type === 'event' && m.channel === '__sidecar__:ready') { clearTimeout(t); rl.off('line', c); res(m.data) } } catch {} }; rl.on('line', c) })
  rl.on('line', (l) => { let m; try { m = JSON.parse(l) } catch { return } if (m.type === 'result' && m.id != null) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) } } })
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 30000) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, shutdown }
}

async function run(dataDir) {
  console.log('━━━ 第8轮: 并发写安全 + 大数据集 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  const results = []

  // ===== A. 并发添加 20 个学生 (检测写队列竞态) =====
  console.log('━━━ A. 并发添加 20 学生 (检测竞态) ━━━')
  const t0 = Date.now()
  const promises = []
  for (let i = 0; i < 20; i++) {
    promises.push(sc.invoke('eaa:add-student', [`并发学生${String(i).padStart(2,'0')}`]).then(() => 1).catch(() => 0))
  }
  const outcomes = await Promise.all(promises)
  const okCount = outcomes.reduce((a, b) => a + b, 0)
  const elapsed = Date.now() - t0
  console.log(`  ${okCount === 20 ? '✓' : '✗'} 并发20: ${okCount}/20 成功, ${elapsed}ms`)
  results.push({ test: 'concurrent-add-20', ok: okCount, total: 20, elapsed })

  // 验证全部写入
  const list = await sc.invoke('eaa:list-students', [])
  const allStudents = list?.data?.students || []
  console.log(`  → 验证: list-students 返回 ${allStudents.length} 学生`)
  results.push({ test: 'verify-after-concurrent', count: allStudents.length })

  // ===== B. 顺序加 50 个学生 (大数据集) =====
  console.log('\n━━━ B. 顺序加 50 学生 (大数据集性能) ━━━')
  const t1 = Date.now()
  let bOk = 0
  for (let i = 0; i < 50; i++) {
    try { await sc.invoke('eaa:add-student', [`大数据学生${String(i).padStart(3,'0')}`]); bOk++ } catch {}
  }
  const bElapsed = Date.now() - t1
  const avg = (bElapsed / 50).toFixed(1)
  console.log(`  ${bOk === 50 ? '✓' : '✗'} 顺序50: ${bOk}/50 成功, 总${bElapsed}ms 均${avg}ms`)
  results.push({ test: 'sequential-add-50', ok: bOk, total: 50, elapsed: bElapsed, avgMs: Number(avg) })

  // 验证总数
  const list2 = await sc.invoke('eaa:list-students', [])
  const totalStudents = list2?.data?.students?.length || 0
  console.log(`  → 总学生数: ${totalStudents} (期望 ~70 = 20+50)`)
  results.push({ test: 'total-students', count: totalStudents })

  // 大数据集排行榜性能
  const t2 = Date.now()
  await sc.invoke('eaa:ranking', [100])
  const rankMs = Date.now() - t2
  console.log(`  → 排行榜(全量) 耗时: ${rankMs}ms`)
  results.push({ test: 'ranking-large', elapsed: rankMs })

  // ===== C. 混合并发读写 (5写 + 5读 同时) =====
  console.log('\n━━━ C. 混合并发读写 (5写+5读 同时) ━━━')
  const t3 = Date.now()
  const mixed = []
  for (let i = 0; i < 5; i++) {
    mixed.push(sc.invoke('eaa:add-student', [`混合${i}`]).then(() => 'write-ok').catch(() => 'write-err'))
    mixed.push(sc.invoke('eaa:ranking', [10]).then(() => 'read-ok').catch(() => 'read-err'))
  }
  const mixedOutcomes = await Promise.all(mixed)
  const mixedElapsed = Date.now() - t3
  const writes = mixedOutcomes.filter(o => o.startsWith('write'))
  const reads = mixedOutcomes.filter(o => o.startsWith('read'))
  console.log(`  写: ${writes.filter(o => o === 'write-ok').length}/${writes.length} ok`)
  console.log(`  读: ${reads.filter(o => o === 'read-ok').length}/${reads.length} ok`)
  console.log(`  总耗时: ${mixedElapsed}ms`)
  const mixedOk = writes.every(o => o === 'write-ok') && reads.every(o => o === 'read-ok')
  results.push({ test: 'mixed-rw', writes: writes.length, reads: reads.length, ok: mixedOk, elapsed: mixedElapsed })

  await sc.shutdown()

  const allOk = results.every(r => r.ok !== false && (r.ok === undefined || r.ok === r.total || r.ok === true))
  console.log(`\n━━━ 结果: ${allOk ? '✅ 全部通过' : '⚠️ 有问题'} ━━━\n`)
  const report = { round: 'R8-并发大数据', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'R8-并发大数据.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-concurrent')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
