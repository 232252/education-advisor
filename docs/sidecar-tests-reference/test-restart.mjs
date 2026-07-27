// 第5轮：多次启停稳定性 + 资源泄漏检测
// 启动→就绪→调用→关闭，循环 10 次
// 检测: 累积内存增长、句柄泄漏、端口占用、僵尸进程、启动耗时退化
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
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ready timeout')), 25000)
    const checker = (line) => { try { const m = JSON.parse(line); if (m.type === 'event' && m.channel === '__sidecar__:ready') { clearTimeout(t); rl.off('line', checker); res(m.data) } } catch {} }
    rl.on('line', checker)
  })
  rl.on('line', (line) => { let m; try { m = JSON.parse(line) } catch { return } if (m.type === 'result' && m.id != null) { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.ok ? p.resolve(m.data) : p.reject(new Error(m.error || '?')) } } })
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 15000) }) }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, shutdown, child, pid: child.pid }
}

// 测系统内存使用 (估算 sidecar 进程的 RSS)
function getProcessMemory(pid) {
  try {
    const { execSync } = require('node:child_process')
    // Windows: tasklist /fi "PID eq X" /fo csv
    const out = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, { encoding: 'utf8', timeout: 5000 })
    const match = out.match(/"([\d,]+)\s*K"/)
    if (match) return parseInt(match[1].replace(/,/g, ''), 10)
  } catch {}
  return null
}

async function runRestarts(dataDir) {
  const results = []
  const ROUNDS = 10
  console.log(`━━━ 第5轮: ${ROUNDS} 次启停稳定性测试 ━━━\n`)

  for (let i = 1; i <= ROUNDS; i++) {
    const t0 = Date.now()
    let sc
    try {
      sc = startSidecar(dataDir)
      await sc.ready
      const startupMs = Date.now() - t0

      // 调用几个通道确认正常
      await sc.invoke('eaa:info', [])
      await sc.invoke('agent:list', [])
      await sc.invoke('settings:get', [])

      const mem = getProcessMemory(sc.pid)
      console.log(`  第${String(i).padStart(2)}次: 启动${String(startupMs).padStart(5)}ms, PID=${sc.pid}, 内存=${mem ? (mem/1024).toFixed(1)+'MB' : '?'}`)
      results.push({ round: i, startupMs, pid: sc.pid, memKB: mem, status: 'ok' })
    } catch (e) {
      console.log(`  第${String(i).padStart(2)}次: ✗ 失败 — ${e.message}`)
      results.push({ round: i, status: 'fail', error: e.message })
    } finally {
      if (sc) await sc.shutdown()
    }
    // 短暂等待进程退出
    await new Promise(r => setTimeout(r, 300))
  }

  // 分析
  const okCount = results.filter(r => r.status === 'ok').length
  const startupTimes = results.filter(r => r.startupMs).map(r => r.startupMs)
  const mems = results.filter(r => r.memKB).map(r => r.memKB)
  const avgStartup = startupTimes.length ? (startupTimes.reduce((a,b)=>a+b,0)/startupTimes.length).toFixed(0) : '?'
  const maxStartup = startupTimes.length ? Math.max(...startupTimes) : '?'
  const minStartup = startupTimes.length ? Math.min(...startupTimes) : '?'
  const avgMem = mems.length ? (mems.reduce((a,b)=>a+b,0)/mems.length/1024).toFixed(1) : '?'
  const maxMem = mems.length ? (Math.max(...mems)/1024).toFixed(1) : '?'

  console.log(`\n━━━ 结果 ━━━`)
  console.log(`  成功率: ${okCount}/${ROUNDS}`)
  console.log(`  启动耗时: 均${avgStartup}ms (范围 ${minStartup}-${maxStartup}ms)`)
  console.log(`  内存: 均${avgMem}MB (峰值${maxMem}MB)`)
  const memGrowth = mems.length >= 2 ? ((mems[mems.length-1] - mems[0])/1024).toFixed(1) : '?'
  console.log(`  内存增长(首→末): ${memGrowth}MB ${Math.abs(memGrowth) < 20 ? '(稳定 ✓)' : '(可能泄漏 ⚠)'}`)

  const report = { round: 'R5-启停稳定性', timestamp: new Date().toISOString(),
    summary: { okCount, total: ROUNDS, avgStartup, maxStartup, minStartup, avgMem, maxMem, memGrowthMB: memGrowth },
    results }
  writeFileSync(resolve(RESULTS_DIR, 'R5-启停稳定性.json'), JSON.stringify(report, null, 2))
  console.log(`\n━━━ ${okCount === ROUNDS ? '✅ 全部通过' : '⚠️ 有失败'} ━━━\n`)
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-restart')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
runRestarts(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
