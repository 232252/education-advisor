// 第12轮：长时间稳定性 — 单个 sidecar 持续运行 5 分钟，期间不停调用
// 检测: 内存增长 (泄漏)、响应时间退化、累积错误
import { spawn, execSync } from 'node:child_process'
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
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 15000) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, shutdown, pid: child.pid }
}

function getMemKB(pid) {
  try {
    const out = execSync(`powershell.exe -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64"`, { encoding: 'utf8', timeout: 5000 }).trim()
    const bytes = parseInt(out, 10)
    return isNaN(bytes) ? null : Math.round(bytes / 1024)
  } catch { return null }
}

async function run(dataDir) {
  console.log('━━━ 第12轮: 长时间稳定性 (持续 ~4分钟) ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  console.log(`  Sidecar PID: ${sc.pid}`)

  const DURATION_MS = 240000 // 4 分钟
  const t0 = Date.now()
  const samples = [] // {elapsed, memKB, callCount, errCount, avgMs}
  let callCount = 0, errCount = 0
  const latencies = []

  const channels = ['eaa:info', 'eaa:ranking', 'agent:list', 'eaa:codes', 'eaa:stats', 'settings:get', 'cron:list', 'skill:list']

  while (Date.now() - t0 < DURATION_MS) {
    // 一轮: 调 8 个通道
    for (const ch of channels) {
      const ts = Date.now()
      try {
        await sc.invoke(ch, ch === 'eaa:ranking' ? [10] : [])
        latencies.push(Date.now() - ts)
        callCount++
      } catch {
        errCount++
      }
    }
    // 每 ~30秒采样一次内存
    if (callCount % 24 === 0) { // 8 calls/round * 3 rounds ≈ 24
      const mem = getMemKB(sc.pid)
      const elapsed = Date.now() - t0
      const recentAvg = latencies.slice(-24).reduce((a, b) => a + b, 0) / Math.min(24, latencies.length)
      samples.push({ elapsed, memKB: mem, callCount, errCount, avgMs: Math.round(recentAvg) })
      const memMB = mem ? (mem / 1024).toFixed(1) : '?'
      console.log(`  [${(elapsed/1000).toFixed(0)}s] 调用${callCount} 错误${errCount} 内存${memMB}MB 均${Math.round(recentAvg)}ms`)
    }
  }

  await sc.shutdown()

  // 分析内存趋势
  const mems = samples.filter(s => s.memKB).map(s => s.memKB)
  let memGrowth = null
  if (mems.length >= 2) {
    memGrowth = mems[mems.length - 1] - mems[0]
  }
  const overallAvg = latencies.length ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1) : '?'
  const maxLat = latencies.length ? Math.max(...latencies) : '?'

  console.log(`\n━━━ 长时间稳定性结果 ━━━`)
  console.log(`  总运行: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log(`  总调用: ${callCount}, 错误: ${errCount} (${errCount === 0 ? '✓ 无错误' : '⚠️ 有错误'})`)
  console.log(`  平均延迟: ${overallAvg}ms, 最大: ${maxLat}ms`)
  if (memGrowth !== null) {
    const growthMB = (memGrowth / 1024).toFixed(1)
    console.log(`  内存: 首${(mems[0]/1024).toFixed(1)}MB → 末${(mems[mems.length-1]/1024).toFixed(1)}MB, 增长 ${growthMB}MB ${Math.abs(Number(growthMB)) < 30 ? '(稳定 ✓)' : '(可能泄漏 ⚠️)'}`)
  }

  const report = {
    round: 'R12-长时间稳定性',
    timestamp: new Date().toISOString(),
    summary: { durationSec: Math.round((Date.now() - t0) / 1000), callCount, errCount, avgLatencyMs: overallAvg, maxLatencyMs: maxLat, memGrowthKB: memGrowth, samples },
  }
  writeFileSync(resolve(RESULTS_DIR, 'R12-长时间稳定性.json'), JSON.stringify(report, null, 2))
  console.log(`\n━━━ ${errCount === 0 ? '✅ 稳定运行' : '⚠️ 有错误'} ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-longrun')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
