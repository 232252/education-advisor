// 角度6：性能角度循环测试
// 派生子代理（弱模型）视角：IPC 延迟基准、高频切换、缓存预热命中
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DATA_DIR = resolve(ROOT, `test-perf-${Date.now().toString().slice(-6)}`)
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

function startSidecar() {
  const child = spawn('node', [resolve(ROOT, 'sidecar/edu-sidecar.mjs')], {
    env: { ...process.env, EDU_APP_DATA_DIR: DATA_DIR, EDU_RESOURCE_DIR: ROOT },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextId = 1
  let readyResolve
  const ready = new Promise((res) => { readyResolve = res })
  rl.on('line', (line) => {
    try {
      const m = JSON.parse(line)
      if (m.type === 'event' && m.channel === '__sidecar__:ready') { if (readyResolve) { readyResolve(m.data); readyResolve = null }; return }
      if (m.type === 'result' && m.id != null) {
        const p = pending.get(m.id)
        if (p) { pending.delete(m.id); if (m.ok) p.resolve(m.data); else p.reject(new Error(m.error || '?')) }
      }
    } catch {}
  })
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args }) + '\n') }) }
  function shutdown() { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}; setTimeout(() => { try { child.kill() } catch {} }, 800) }
  return { ready, invoke, shutdown }
}

let pass = 0, fail = 0
const failures = []
async function check(label, fn) {
  const s = Date.now()
  try { await fn(); console.log(`  ✓ ${label.padEnd(55)} (${Date.now() - s}ms)`); pass++ }
  catch (e) { console.log(`  ✗ ${label.padEnd(55)} (${Date.now() - s}ms) → ${e.message.slice(0, 90)}`); fail++; failures.push({ label, msg: e.message }) }
}
async function expectShape(label, fn, p) { return check(label, async () => { const r = await fn(); if (!p(r)) throw new Error(`shape: ${JSON.stringify(r).slice(0, 100)}`) }) }

async function bench(invoke, ch, args, n) {
  const ts = []
  for (let i = 0; i < n; i++) {
    const s = Date.now()
    await invoke(ch, args)
    ts.push(Date.now() - s)
  }
  ts.sort((a, b) => a - b)
  const avg = (ts.reduce((a, b) => a + b, 0) / n).toFixed(1)
  const p50 = ts[Math.floor(n / 2)]
  const p95 = ts[Math.floor(n * 0.95)]
  return { avg, p50, p95, max: ts[n - 1] }
}

async function main() {
  console.log(`\n${'='.repeat(75)}\n  角度6：性能角度 — ${DATA_DIR}\n${'='.repeat(75)}\n`)
  const sidecar = startSidecar()
  try {
    await sidecar.ready
    console.log(`✅ Sidecar 就绪\n`)

    // ============================================
    // A) IPC 延迟基准（5 路概览各 20 次）
    // ============================================
    console.log('【A. IPC 延迟基准（各 20 次）】')
    await sidecar.invoke('settings:set', ['mcp.enabled', true])
    const mcpBench = await bench(sidecar.invoke, 'mcp:list', undefined, 20)
    console.log(`  mcp:list  avg=${mcpBench.avg}ms p50=${mcpBench.p50} p95=${mcpBench.p95} max=${mcpBench.max}`)
    await check('mcp:list avg ≤ 10ms', () => { if (Number(mcpBench.avg) > 10) throw new Error(`avg=${mcpBench.avg}ms`) })
    const settingsBench = await bench(sidecar.invoke, 'settings:get', undefined, 20)
    console.log(`  settings:get  avg=${settingsBench.avg}ms p50=${settingsBench.p50} p95=${settingsBench.p95} max=${settingsBench.max}`)
    await check('settings:get avg ≤ 5ms', () => { if (Number(settingsBench.avg) > 5) throw new Error(`avg=${settingsBench.avg}ms`) })
    const skillBench = await bench(sidecar.invoke, 'skill:list', undefined, 20)
    console.log(`  skill:list  avg=${skillBench.avg}ms p50=${skillBench.p50} p95=${skillBench.p95} max=${skillBench.max}`)
    await check('skill:list avg ≤ 10ms', () => { if (Number(skillBench.avg) > 10) throw new Error(`avg=${skillBench.avg}ms`) })

    // ============================================
    // B) flag 高频切换性能（20 次）
    // ============================================
    console.log('\n【B. flag 高频切换性能】')
    const toggleT = []
    for (let i = 0; i < 20; i++) {
      const s = Date.now()
      await sidecar.invoke('settings:set', ['mcp.enabled', i % 2 === 0])
      toggleT.push(Date.now() - s)
    }
    const avgToggle = (toggleT.reduce((a, b) => a + b, 0) / 20).toFixed(1)
    console.log(`  toggle avg=${avgToggle}ms max=${Math.max(...toggleT)}`)
    await check('flag toggle avg ≤ 10ms', () => { if (Number(avgToggle) > 10) throw new Error(`avg=${avgToggle}ms`) })

    // ============================================
    // C) 连续 100 次 mcp:add 不退化
    // ============================================
    console.log('\n【C. 连续 100 次 add/remove 性能退化）')
    const addT = []
    for (let i = 0; i < 100; i++) {
      const s = Date.now()
      await sidecar.invoke('mcp:add', [{ id: `perf-${i}`, name: 'P', enabled: true, transport: 'stdio', command: 'node', args: ['-e', '0'] }])
      addT.push(Date.now() - s)
    }
    const avgAdd = (addT.reduce((a, b) => a + b, 0) / 100).toFixed(1)
    const maxAdd = Math.max(...addT)
    console.log(`  add avg=${avgAdd}ms max=${maxAdd}ms`)
    await check('连续 100 次 add avg ≤ 20ms', () => { if (Number(avgAdd) > 20) throw new Error(`avg=${avgAdd}ms`) })
    // 验证无致退化：后10次与首10次平均差 ≤ 10 倍（YAML 全量重写属设计权衡，100 累积 13KB 仍可接受）
    const first10 = addT.slice(0, 10).reduce((a, b) => a + b, 0) / 10
    const last10 = addT.slice(-10).reduce((a, b) => a + b, 0) / 10
    await check('后10次与首10次延迟差 ≤ 10 倍（YAML 全量重写容差）', () => { if (last10 > first10 * 10) throw new Error(`first=${first10} last=${last10}`) })
    // 清理
    for (let i = 0; i < 100; i++) await sidecar.invoke('mcp:remove', [`perf-${i}`])
    await expectShape('清理后 mcp:list=0', () => sidecar.invoke('mcp:list'), (r) => r?.success && r.servers.length === 0)

    // ============================================
    // D) EAA 缓存预热命中（ranking 两次应第二次近 0）
    // ============================================
    console.log('\n【D. EAA 缓存预热命中）')
    const t1 = Date.now()
    await sidecar.invoke('eaa:ranking', [10])
    const firstRank = Date.now() - t1
    const t2 = Date.now()
    await sidecar.invoke('eaa:ranking', [10])
    const secondRank = Date.now() - t2
    console.log(`  eaa:ranking 首次=${firstRank}ms 二次=${secondRank}ms`)
    await check('EAA ranking 二次 ≤ 首次/2（缓存命中）', () => { if (secondRank > firstRank / 2) throw new Error(`first=${firstRank} second=${secondRank}`) })

    // ============================================
    // E) 5 路概览并发总时延 ≤ 任意单路串行和
    // ============================================
    console.log('\n【E. 并发总时延 ≤ 串行和）')
    const sConcurrent = Date.now()
    await Promise.allSettled([
      sidecar.invoke('settings:get'),
      sidecar.invoke('mcp:list'),
      sidecar.invoke('skill:list'),
      sidecar.invoke('cron:list'),
      sidecar.invoke('feishu:bot:status'),
    ])
    const concurrentMs = Date.now() - sConcurrent
    // 串行和估算（取各 bench avg 之和）
    const serialSum = Number(settingsBench.avg) + Number(mcpBench.avg) + Number(skillBench.avg) + 2
    console.log(`  并发=${concurrentMs}ms 串行和估算=${serialSum.toFixed(1)}ms`)
    await check('并发总时延 ≤ 串行和', () => { if (concurrentMs > serialSum) throw new Error(`concurrent=${concurrentMs} > serial=${serialSum}`) })

    await sidecar.invoke('settings:set', ['mcp.enabled', false])
    console.log(`\n${'─'.repeat(75)}`)
    console.log(`  结果: ${pass} 通过 / ${fail} 失败`)
    if (failures.length) { console.log('  失败:'); for (const f of failures) console.log(`    - ${f.label}: ${f.msg}`) }
    console.log(`${'─'.repeat(75)}\n`)
  } finally {
    sidecar.shutdown()
    setTimeout(() => { try { rmSync(DATA_DIR, { recursive: true, force: true }) } catch {} }, 1500)
  }
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(2) })
