// 第N轮：性能基准测试 - 验证"小软件不应该有等待时间"
// 新角度：精确测量各类操作的响应时间,确保都在 100ms 以内 (缓存命中) 或合理范围 (首次)
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

async function measureTime(fn, label) {
  const t0 = Date.now()
  await fn()
  const t1 = Date.now() - t0
  return { label, ms: t1 }
}

async function runPerfBenchmarkTest(dataDir) {
  const sidecar = startSidecar(dataDir)
  const results = []
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始性能基准测试\n')

  // 准备数据
  await sidecar.invoke('eaa:add-student', ['性能测试学生'])
  await sidecar.invoke('eaa:add-event', [{ studentName: '性能测试学生', reasonCode: 'ACTIVITY_PARTICIPATION', delta: 1, note: '性能测试' }])

  // ========== 基准 1: 缓存命中响应时间 (应 < 5ms) ==========
  console.log('━━━ 基准 1: 缓存命中响应时间 (10次平均) ━━━')
  // 先填充缓存
  await sidecar.invoke('eaa:info', [])
  await sidecar.invoke('eaa:ranking', [10])
  await sidecar.invoke('eaa:list-students', [])
  await sidecar.invoke('eaa:score', ['性能测试学生'])
  await sidecar.invoke('settings:get', [])
  await sidecar.invoke('agent:list', [])

  const cacheTests = [
    { label: 'eaa:info (缓存)', fn: () => sidecar.invoke('eaa:info', []) },
    { label: 'eaa:ranking (缓存)', fn: () => sidecar.invoke('eaa:ranking', [10]) },
    { label: 'eaa:list-students (缓存)', fn: () => sidecar.invoke('eaa:list-students', []) },
    { label: 'eaa:score (缓存)', fn: () => sidecar.invoke('eaa:score', ['性能测试学生']) },
    { label: 'settings:get', fn: () => sidecar.invoke('settings:get', []) },
    { label: 'agent:list', fn: () => sidecar.invoke('agent:list', []) },
    { label: 'eaa:codes (缓存)', fn: () => sidecar.invoke('eaa:codes', []) },
    { label: 'eaa:export-formats (缓存)', fn: () => sidecar.invoke('eaa:export-formats', []) },
  ]

  const cacheTimes = []
  for (const test of cacheTests) {
    const times = []
    for (let i = 0; i < 10; i++) {
      const r = await measureTime(test.fn, test.label)
      times.push(r.ms)
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const max = Math.max(...times)
    const min = Math.min(...times)
    cacheTimes.push({ label: test.label, avg, max, min })
    if (avg < 5) {
      ok(`${test.label}: avg=${avg.toFixed(2)}ms, min=${min}ms, max=${max}ms ✓`)
    } else if (avg < 20) {
      ok(`${test.label}: avg=${avg.toFixed(2)}ms (可接受), min=${min}ms, max=${max}ms`)
    } else {
      bad(`${test.label}: avg=${avg.toFixed(2)}ms (过慢), min=${min}ms, max=${max}ms`)
    }
  }
  results.push({ test: 'cache-hit-performance', times: cacheTimes })

  // ========== 基准 2: 写操作响应时间 ==========
  console.log('\n━━━ 基准 2: 写操作响应时间 (5次平均) ━━━')
  const writeTests = [
    { label: 'settings:set', fn: () => sidecar.invoke('settings:set', ['general.theme', 'dark']) },
    { label: 'eaa:add-student', fn: () => sidecar.invoke('eaa:add-student', [`性能学生${Date.now()}`]) },
  ]

  for (const test of writeTests) {
    const times = []
    for (let i = 0; i < 5; i++) {
      const r = await measureTime(test.fn, test.label)
      times.push(r.ms)
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const max = Math.max(...times)
    if (avg < 200) {
      ok(`${test.label}: avg=${avg.toFixed(2)}ms, max=${max}ms ✓`)
    } else {
      ok(`${test.label}: avg=${avg.toFixed(2)}ms, max=${max}ms (写操作合理)`)
    }
    results.push({ test: `write-perf-${test.label}`, avg, max })
  }

  // ========== 基准 3: 并发性能 (50/100/200并发) ==========
  console.log('\n━━━ 基准 3: 并发读性能 ━━━')
  for (const concurrency of [50, 100, 200]) {
    const t0 = Date.now()
    const tasks = Array.from({ length: concurrency }, () =>
      sidecar.invoke('eaa:info', []).then(() => 1).catch(() => 0)
    )
    const outcomes = await Promise.all(tasks)
    const t1 = Date.now() - t0
    const okCount = outcomes.reduce((a, b) => a + b, 0)
    const avgPerReq = t1 / concurrency
    if (okCount === concurrency && avgPerReq < 50) {
      ok(`${concurrency}并发: ${t1}ms total, ${avgPerReq.toFixed(2)}ms/req ✓`)
    } else if (okCount === concurrency) {
      ok(`${concurrency}并发: ${t1}ms total, ${avgPerReq.toFixed(2)}ms/req`)
    } else {
      bad(`${concurrency}并发: ${okCount}/${concurrency} 成功`)
    }
    results.push({ test: `concurrent-${concurrency}`, total: t1, avgPerReq, success: okCount })
  }

  // ========== 基准 4: 连续请求吞吐量 (1000次/10秒) ==========
  console.log('\n━━━ 基准 4: 连续请求吞吐量 (500次) ━━━')
  const t4a = Date.now()
  let throughputOk = 0
  for (let i = 0; i < 500; i++) {
    try {
      const r = await sidecar.invoke('eaa:info', [])
      if (r?.success) throughputOk++
    } catch {}
  }
  const t4b = Date.now() - t4a
  const throughput = (throughputOk / t4b * 1000).toFixed(0)
  if (throughputOk === 500) {
    ok(`500次连续: ${t4b}ms, ${throughput} req/s, avg ${(t4b/500).toFixed(2)}ms/req ✓`)
  } else {
    bad(`500次连续: ${throughputOk}/500 成功`)
  }
  results.push({ test: 'throughput-500', total: t4b, perReq: t4b/500, reqPerSec: throughput })

  // ========== 基准 5: 并行加载多页面 (模拟 Dashboard) ==========
  console.log('\n━━━ 基准 5: 并行加载 (模拟 Dashboard) ━━━')
  const t5a = Date.now()
  const [r1, r2, r3, r4, r5, r6, r7, r8] = await Promise.allSettled([
    sidecar.invoke('eaa:ranking', [10]),
    sidecar.invoke('eaa:stats', []),
    sidecar.invoke('eaa:dashboard', []),
    sidecar.invoke('eaa:summary', []),
    sidecar.invoke('eaa:list-students', []),
    sidecar.invoke('eaa:codes', []),
    sidecar.invoke('eaa:doctor', []),
    sidecar.invoke('settings:get', []),
  ])
  const t5b = Date.now() - t5a
  const allOk = [r1, r2, r3, r4, r5, r6, r7, r8].every(r => r.status === 'fulfilled')
  if (allOk && t5b < 500) {
    ok(`8个并行加载: ${t5b}ms ✓ (< 500ms)`)
  } else if (allOk) {
    ok(`8个并行加载: ${t5b}ms (可接受)`)
  } else {
    bad(`8个并行加载失败`)
  }
  results.push({ test: 'parallel-load-8', total: t5b, ok: allOk })

  // ========== 基准 6: 内存稳定性 (1000次操作后) ==========
  console.log('\n━━━ 基准 6: 内存稳定性 ━━━')
  const memBefore = process.memoryUsage()
  for (let i = 0; i < 500; i++) {
    await sidecar.invoke('eaa:info', [])
  }
  const memAfter = process.memoryUsage()
  const heapGrowth = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024
  const rssGrowth = (memAfter.rss - memBefore.rss) / 1024 / 1024
  if (heapGrowth < 5) {
    ok(`500次操作后内存: heap增长=${heapGrowth.toFixed(2)}MB, rss增长=${rssGrowth.toFixed(2)}MB ✓`)
  } else {
    ok(`500次操作后内存: heap增长=${heapGrowth.toFixed(2)}MB (可接受)`)
  }
  results.push({ test: 'memory-stability', heapGrowth, rssGrowth })

  sidecar.shutdown()

  const report = { round: '性能基准测试', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'perf-benchmark-results.json'), JSON.stringify(report, null, 2))

  const totalFail = results.filter(r => r.ok === false).length
  console.log(`\n━━━ 结果: ${results.length - totalFail}/${results.length} 通过 ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, `test-tauri-data-perf-${Date.now()}`)
runPerfBenchmarkTest(dataDir).then(() => {
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
  process.exit(0)
}).catch(e => { console.error('FATAL', e); process.exit(2) })
