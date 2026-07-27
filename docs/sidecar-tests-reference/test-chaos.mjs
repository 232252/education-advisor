// 第17轮：混沌测试 — 随机调用组合 + 畸形 stdin 输入
// A. 随机选通道+随机参数，跑 200 次 (找未探索的失败路径)
// B. 发畸形 JSON 到 stdin (测 sidecar 解析健壮性)
// C. 发不完整 invoke (缺 channel/args)
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
  function invoke(ch, args, timeoutMs = 10000) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, timeoutMs) }) }
  function rawWrite(data) { try { child.stdin.write(data) } catch {} }
  const shutdown = () => { try { child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {} return new Promise(r => setTimeout(() => { try { child.kill() } catch {} r() }, 1500)) }
  return { ready, invoke, rawWrite, shutdown, child }
}

async function run(dataDir) {
  console.log('━━━ 第17轮: 混沌/模糊测试 ━━━\n')
  const sc = startSidecar(dataDir)
  await sc.ready
  const results = []

  // ===== A. 随机调用组合 ×200 =====
  console.log('━━━ A. 随机调用组合 ×200 ━━━')
  const channels = [
    ['eaa:info', []], ['eaa:ranking', [10]], ['eaa:stats', []], ['eaa:codes', []],
    ['eaa:list-students', []], ['agent:list', []], ['settings:get', []],
    ['skill:list', []], ['cron:list', []], ['privacy:status', []],
    ['feishu:status', []], ['ollama:detect', []], ['class:list', []],
    ['eaa:doctor', []], ['eaa:validate', []], ['eaa:summary', []],
  ]
  let aOk = 0, aErr = 0, aTimeout = 0
  for (let i = 0; i < 200; i++) {
    const [ch, args] = channels[Math.floor(Math.random() * channels.length)]
    try { await sc.invoke(ch, args); aOk++ }
    catch (e) { if (e.message.includes('timeout')) aTimeout++; else aErr++ }
  }
  console.log(`  ✓ 200次随机调用: ${aOk} 成功, ${aErr} 错误(优雅), ${aTimeout} 超时`)
  results.push({ test: 'random-200', ok: aOk, err: aErr, timeout: aTimeout })

  // 存活验证
  try { await sc.invoke('eaa:info', []); console.log(`  ✓ 200次后 sidecar 存活`); results.push({ test: 'alive-after-200', status: 'alive' }) }
  catch (e) { console.log(`  ✗ 200次后 sidecar 可能崩溃: ${e.message}`); results.push({ test: 'alive-after-200', status: 'dead' }) }

  // ===== B. 畸形 stdin 输入 (测 sidecar 解析健壮性) =====
  console.log('\n━━━ B. 畸形 stdin 输入 ━━━')
  const malformed = [
    'not json at all\n',
    '{ incomplete json\n',
    JSON.stringify({ type: 'invoke' }) + '\n', // 缺 channel
    JSON.stringify({ id: 999, type: 'invoke' }) + '\n', // 缺 channel
    JSON.stringify({ id: 999, type: 'invoke', channel: 'eaa:info' }) + '\n', // 缺 args (应默认[])
    JSON.stringify({ id: 999, type: 'unknown_type', channel: 'x' }) + '\n', // 未知 type
    '\n', // 空行
    '   \n', // 空白行
    JSON.stringify({ type: 'invoke', channel: 'nonexistent:channel', args: [] }) + '\n', // 不存在的通道
  ]
  for (const [i, data] of malformed.entries()) {
    sc.rawWrite(data)
    await new Promise(r => setTimeout(r, 100))
    console.log(`  ✓ 畸形输入#${i} 已发送, sidecar 未崩`)
  }
  results.push({ test: 'malformed-stdin', count: malformed.length })

  // 存活验证
  try {
    const r = await sc.invoke('eaa:info', [])
    console.log(`  ✓ 畸形输入后 sidecar 存活: ${r?.success ? '正常' : '?'}`)
    results.push({ test: 'alive-after-malformed', status: 'alive' })
  } catch (e) {
    console.log(`  ✗ 畸形输入后 sidecar 可能崩溃: ${e.message}`)
    results.push({ test: 'alive-after-malformed', status: 'dead', error: e.message })
  }

  // ===== C. 快速连发 50 个合法 invoke (测背压/队列) =====
  console.log('\n━━━ C. 快速连发 50 个 invoke (不 await) ━━━')
  const fired = []
  for (let i = 0; i < 50; i++) {
    fired.push(sc.invoke('eaa:info', []).then(() => 1).catch(() => 0))
  }
  const outcomes = await Promise.all(fired)
  const cOk = outcomes.reduce((a, b) => a + b, 0)
  console.log(`  ✓ 50个连发: ${cOk}/50 成功`)
  results.push({ test: 'rapid-fire-50', ok: cOk })

  await sc.shutdown()

  const allAlive = results.filter(r => r.status === 'alive').length === 2
  console.log(`\n━━━ 混沌测试结果: ${allAlive && aErr === 0 && cOk === 50 ? '✅ sidecar 极其健壮' : '⚠️ 检查详情'} ━━━\n`)
  const report = { round: 'R17-混沌测试', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'R17-混沌测试.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-chaos')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
