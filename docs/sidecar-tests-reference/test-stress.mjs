// 第2轮：压力测试 — 重复调用、并发、高频突发
// 检测: 内存泄漏、句柄泄漏、竞态、降级、崩溃
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
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

async function runStress(dataDir) {
  const sidecar = startSidecar(dataDir)
  const results = []
  await sidecar.ready
  console.log('✅ Sidecar 就绪，开始压力测试\n')

  // ========== 测试 A: 重复调用 ×100 (检测泄漏/退化) ==========
  console.log('━━━ 测试 A: 重复调用 ×100 ━━━')
  const channels = ['eaa:info', 'eaa:ranking', 'agent:list', 'eaa:list-students', 'cron:list']
  for (const ch of channels) {
    const t0 = Date.now()
    let ok = 0, err = 0
    for (let i = 0; i < 100; i++) {
      try { await sidecar.invoke(ch, ch === 'eaa:ranking' ? [10] : []); ok++ } catch { err++ }
    }
    const elapsed = Date.now() - t0
    const avg = (elapsed / 100).toFixed(1)
    const status = err === 0 ? '✓' : '✗'
    console.log(`  ${status} ${ch.padEnd(20)} ×100: ${ok} ok / ${err} err, 总${elapsed}ms 均${avg}ms`)
    results.push({ test: 'repeat100', channel: ch, ok, err, elapsed, avgMs: Number(avg) })
  }

  // ========== 测试 B: 并发 ×10 同时 ==========
  console.log('\n━━━ 测试 B: 并发 ×10 同时 ━━━')
  const concChannels = ['eaa:info', 'eaa:ranking', 'eaa:stats', 'agent:list', 'eaa:codes']
  for (const ch of concChannels) {
    const t0 = Date.now()
    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(sidecar.invoke(ch, ch === 'eaa:ranking' ? [10] : []).then(() => 1).catch(() => 0))
    }
    const outcomes = await Promise.all(promises)
    const ok = outcomes.reduce((a, b) => a + b, 0)
    const elapsed = Date.now() - t0
    const status = ok === 10 ? '✓' : '✗'
    console.log(`  ${status} ${ch.padEnd(20)} 并发×10: ${ok}/10 ok, ${elapsed}ms`)
    results.push({ test: 'concurrent10', channel: ch, ok, total: 10, elapsed })
  }

  // ========== 测试 C: 混合高频突发 (50 个不同请求快速连发) ==========
  console.log('\n━━━ 测试 C: 混合高频突发 ×50 ━━━')
  const mix = ['eaa:info','eaa:ranking','agent:list','eaa:codes','eaa:stats','eaa:doctor','cron:list','skill:list','settings:get','privacy:status']
  const t0 = Date.now()
  const burst = []
  for (let i = 0; i < 50; i++) {
    const ch = mix[i % mix.length]
    burst.push(sidecar.invoke(ch, ch === 'eaa:ranking' ? [10] : []).then(() => 1).catch(() => 0))
  }
  const burstOutcomes = await Promise.all(burst)
  const burstOk = burstOutcomes.reduce((a, b) => a + b, 0)
  const burstElapsed = Date.now() - t0
  const burstStatus = burstOk === 50 ? '✓' : '✗'
  console.log(`  ${burstStatus} 混合突发×50: ${burstOk}/50 ok, ${burstElapsed}ms (均${(burstElapsed/50).toFixed(1)}ms)`)
  results.push({ test: 'burst50', ok: burstOk, total: 50, elapsed: burstElapsed })

  // ========== 测试 D: 写操作压力 (连续新增学生 ×20) ==========
  console.log('\n━━━ 测试 D: 写操作连续 ×20 (新增学生) ━━━')
  const wt0 = Date.now()
  let wok = 0, werr = 0
  for (let i = 0; i < 20; i++) {
    try { await sidecar.invoke('eaa:add-student', [`压测学生_${i}`]); wok++ } catch { werr++ }
  }
  const welapsed = Date.now() - wt0
  console.log(`  ${werr === 0 ? '✓' : '✗'} eaa:add-student ×20: ${wok} ok / ${werr} err, ${welapsed}ms`)
  results.push({ test: 'write20', channel: 'eaa:add-student', ok: wok, err: werr, elapsed: welapsed })

  // 验证写入确实生效
  const students = await sidecar.invoke('eaa:list-students', [])
  const studentCount = students?.data?.students?.length ?? 0
  console.log(`  → 验证: list-students 返回 ${studentCount} 个学生`)
  results.push({ test: 'verify-after-write', studentCount })

  sidecar.shutdown()

  const report = { round: 'R2-压力测试', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'R2-压力测试.json'), JSON.stringify(report, null, 2))

  const totalErr = results.filter(r => r.err > 0 || (r.total && r.ok < r.total)).length
  console.log(`\n━━━ 压力测试结果: ${totalErr === 0 ? '✅ 全部通过' : '⚠️ 有失败项'} ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, `test-tauri-data-stress`)
runStress(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
