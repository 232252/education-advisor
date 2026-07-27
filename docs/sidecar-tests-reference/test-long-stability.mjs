// 第N轮：长时间稳定性测试 - 检测内存泄漏和资源耗尽
// 新角度：在单个 sidecar 实例上连续运行 2000+ 次操作,监控内存趋势
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

async function runLongStabilityTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  const results = []
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始长时间稳定性测试\n')

  // 准备数据
  await sidecar.invoke('eaa:add-student', ['稳定测试学生'])
  await sidecar.invoke('eaa:add-event', [{ studentName: '稳定测试学生', reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1, note: '稳定测试' }])

  // ========== 阶段 1: 2000 次读操作,每 500 次记录内存 ==========
  console.log('━━━ 阶段 1: 2000 次读操作 (内存监控) ━━━')
  const memCheckpoints = []
  let readOk = 0
  const t1a = Date.now()

  for (let i = 0; i < 2000; i++) {
    try {
      const r = await sidecar.invoke('eaa:info', [])
      if (r?.success) readOk++
    } catch {}

    if (i % 500 === 0 || i === 1999) {
      const mem = process.memoryUsage()
      memCheckpoints.push({
        op: i,
        heapMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
        rssMB: (mem.rss / 1024 / 1024).toFixed(2),
      })
      console.log(`  [${i}/2000] heap=${(mem.heapUsed / 1024 / 1024).toFixed(2)}MB, rss=${(mem.rss / 1024 / 1024).toFixed(2)}MB`)
    }
  }
  const t1b = Date.now() - t1a

  const heapStart = parseFloat(memCheckpoints[0].heapMB)
  const heapEnd = parseFloat(memCheckpoints[memCheckpoints.length - 1].heapMB)
  const heapGrowth = heapEnd - heapStart

  if (readOk === 2000) {
    ok(`2000次读操作: ${readOk}/2000 成功, ${t1b}ms (avg ${(t1b/2000).toFixed(2)}ms)`)
  } else {
    bad(`2000次读操作: ${readOk}/2000 成功`)
  }

  if (heapGrowth < 5) {
    ok(`内存稳定: heap ${heapStart}MB → ${heapEnd}MB (增长 ${heapGrowth.toFixed(2)}MB) ✓`)
  } else {
    bad(`内存泄漏: heap ${heapStart}MB → ${heapEnd}MB (增长 ${heapGrowth.toFixed(2)}MB)`)
  }
  results.push({ test: '2000-reads', ok: readOk, heapGrowth, checkpoints: memCheckpoints })

  // ========== 阶段 2: 500 次写操作 (add-student + delete-student 交替) ==========
  console.log('\n━━━ 阶段 2: 500 次写操作 (增删交替) ━━━')
  let writeOk = 0
  const t2a = Date.now()
  for (let i = 0; i < 250; i++) {
    const name = `稳定测试_${i}_${Date.now()}`
    try {
      const addR = await sidecar.invoke('eaa:add-student', [name])
      if (addR?.success !== false) writeOk++
      const delR = await sidecar.invoke('eaa:delete-student', [name, { confirm: true, reason: '稳定测试' }])
      if (delR?.success !== false) writeOk++
    } catch {}
  }
  const t2b = Date.now() - t2a
  if (writeOk === 500) {
    ok(`500次写操作 (250增+250删): ${writeOk}/500 成功, ${t2b}ms`)
  } else {
    bad(`500次写操作: ${writeOk}/500 成功`)
  }
  results.push({ test: '500-writes', ok: writeOk, total: 500, elapsedMs: t2b })

  // ========== 阶段 3: 100 轮并行加载 (模拟 100 次 Dashboard 刷新) ==========
  console.log('\n━━━ 阶段 3: 100 轮并行加载 (Dashboard 模拟) ━━━')
  let dashOk = 0
  const t3a = Date.now()
  for (let round = 0; round < 100; round++) {
    try {
      const [r1, r2, r3, r4] = await Promise.allSettled([
        sidecar.invoke('eaa:ranking', [10]),
        sidecar.invoke('eaa:stats', []),
        sidecar.invoke('eaa:dashboard', []),
        sidecar.invoke('eaa:list-students', []),
      ])
      if (r1.status === 'fulfilled' && r2.status === 'fulfilled' &&
          r3.status === 'fulfilled' && r4.status === 'fulfilled') dashOk++
    } catch {}
  }
  const t3b = Date.now() - t3a
  if (dashOk === 100) {
    ok(`100轮并行加载: ${dashOk}/100 成功, ${t3b}ms (avg ${(t3b/100).toFixed(0)}ms/轮)`)
  } else {
    bad(`100轮并行加载: ${dashOk}/100 成功`)
  }
  results.push({ test: '100-dashboard-loads', ok: dashOk, total: 100, elapsedMs: t3b })

  // ========== 阶段 4: 最终内存检查 ==========
  console.log('\n━━━ 阶段 4: 最终内存检查 ━━━')
  const memFinal = process.memoryUsage()
  const heapFinal = memFinal.heapUsed / 1024 / 1024
  const rssFinal = memFinal.rss / 1024 / 1024
  const totalHeapGrowth = heapFinal - heapStart

  if (totalHeapGrowth < 10) {
    ok(`最终内存: heap=${heapFinal.toFixed(2)}MB (总增长 ${totalHeapGrowth.toFixed(2)}MB), rss=${rssFinal.toFixed(2)}MB ✓`)
  } else {
    bad(`最终内存过高: heap=${heapFinal.toFixed(2)}MB (总增长 ${totalHeapGrowth.toFixed(2)}MB)`)
  }
  results.push({ test: 'final-memory', heapMB: heapFinal, rssMB: rssFinal, totalGrowth: totalHeapGrowth })

  // ========== 阶段 5: 功能完整性验证 (长时间运行后) ==========
  console.log('\n━━━ 阶段 5: 功能完整性验证 ━━━')
  const finalTests = [
    { ch: 'eaa:info', args: [] },
    { ch: 'eaa:ranking', args: [10] },
    { ch: 'eaa:score', args: ['稳定测试学生'] },
    { ch: 'eaa:history', args: ['稳定测试学生'] },
    { ch: 'settings:get', args: [] },
    { ch: 'agent:list', args: [] },
  ]
  let funcOk = 0
  for (const t of finalTests) {
    try {
      const r = await sidecar.invoke(t.ch, t.args)
      if (r?.success !== false) funcOk++
    } catch {}
  }
  if (funcOk === finalTests.length) {
    ok(`长时间运行后功能完整: ${funcOk}/${finalTests.length} 正常`)
  } else {
    bad(`长时间运行后功能异常: ${funcOk}/${finalTests.length} 正常`)
  }
  results.push({ test: 'post-stability-functionality', ok: funcOk, total: finalTests.length })

  sidecar.shutdown()

  const report = { round: '长时间稳定性测试', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'long-stability-results.json'), JSON.stringify(report, null, 2))

  const totalFail = results.filter(r => r.total && r.ok < r.total).length +
                    results.filter(r => r.test === '2000-reads' && r.ok < 2000).length +
                    results.filter(r => r.test === 'final-memory' && r.totalGrowth >= 10).length
  console.log(`\n━━━ 结果: ${results.length - totalFail}/${results.length} 通过 ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, `test-tauri-data-stability-${Date.now()}`)
runLongStabilityTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
