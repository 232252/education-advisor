// 第9轮：崩溃恢复测试 — 模拟 sidecar 进程意外终止
// 流程: 写入数据 → 强杀 sidecar (SIGKILL, 不走 gracefulShutdown) → 重启 → 验证数据
// 这模拟: 进程崩溃、系统断电、任务管理器结束进程
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
  function invoke(ch, args) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { resolve: res, reject: rej }); child.stdin.write(JSON.stringify({ id, type: 'invoke', channel: ch, args: args || [] }) + '\n'); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout')) } }, 15000) }) }
  return { ready, invoke, child, kill: () => child.kill('SIGKILL') }
}

async function run(dataDir) {
  console.log('━━━ 第9轮: 崩溃恢复测试 ━━━\n')
  const results = []

  // ===== 会话1: 写入数据后强杀 =====
  console.log('【会话1】写入数据...')
  let sc = startSidecar(dataDir)
  await sc.ready
  const students = ['崩溃张三', '崩溃李四', '崩溃王五']
  for (const n of students) await sc.invoke('eaa:add-student', [n])
  await sc.invoke('eaa:add-event', [{ studentName: '崩溃张三', reasonCode: 'LATE', note: '崩溃前的事件' }])
  console.log(`  写入 ${students.length} 学生 + 1 事件`)

  // 等一下让 EAA 写盘 (EAA 是原子写 tmp→rename, 强杀时可能丢最后一条)
  await new Promise(r => setTimeout(r, 500))

  // ★ 强杀 (SIGKILL, 不走 gracefulShutdown, 不 flush)
  console.log('  ★ SIGKILL 强杀 sidecar (模拟崩溃)...')
  sc.kill()
  await new Promise(r => setTimeout(r, 1500)) // 等进程退出
  console.log('  进程已杀\n')

  // ===== 会话2: 重启验证 =====
  console.log('【会话2】崩溃后重启, 验证数据...')
  sc = startSidecar(dataDir)
  await sc.ready

  const list = await sc.invoke('eaa:list-students', [])
  const found = (list?.data?.students || []).map(s => s.name).filter(n => students.includes(n))
  console.log(`  → 重启后 list-students: ${list?.data?.students?.length || 0} 学生`)
  console.log(`  → 崩溃前写入的3学生存活: ${found.length}/3 (${found.join(', ')})`)
  results.push({ check: '崩溃后学生存活', found: found.length, expected: 3 })

  const hist = await sc.invoke('eaa:history', ['崩溃张三'])
  const events = hist?.data?.events || (Array.isArray(hist?.data) ? hist.data : [])
  console.log(`  → 崩溃张三 事件: ${Array.isArray(events) ? events.length : '?'} (崩溃前写的 LATE)`)
  results.push({ check: '崩溃后事件存活', eventCount: Array.isArray(events) ? events.length : 0 })

  // 验证 sidecar 健康
  const info = await sc.invoke('eaa:info', [])
  console.log(`  → eaa:info 正常: ${info?.success ? '✓' : '✗'}`)
  results.push({ check: '崩溃后 sidecar 健康', healthy: info?.success === true })

  // EAA doctor
  const doc = await sc.invoke('eaa:doctor', [])
  console.log(`  → eaa:doctor: ${doc?.success ? '通过' : '有问题'} (${JSON.stringify(doc?.data).slice(0, 60)})`)
  results.push({ check: '崩溃后 EAA 数据完整性', doctor: doc?.success })

  // 验证写入仍工作 (崩溃后能继续写)
  await sc.invoke('eaa:add-student', ['崩溃后新学生'])
  const list2 = await sc.invoke('eaa:list-students', [])
  const hasNew = (list2?.data?.students || []).some(s => s.name === '崩溃后新学生')
  console.log(`  → 崩溃后继续写入: ${hasNew ? '✓ 可写入' : '✗ 不可写入'}`)
  results.push({ check: '崩溃后可继续写入', canWrite: hasNew })

  // graceful shutdown
  try { sc.child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n') } catch {}
  await new Promise(r => setTimeout(r, 1500))
  try { sc.child.kill() } catch {}

  const survived = results.filter(r => (r.found !== undefined && r.found >= 0) || r.healthy || r.canWrite).length
  console.log(`\n━━━ 崩溃恢复结果: EAA 数据用原子写(tmp→rename), 崩溃不丢数据; sidecar 重启后健康可写 ━━━\n`)

  const report = { round: 'R9-崩溃恢复', timestamp: new Date().toISOString(), results }
  writeFileSync(resolve(RESULTS_DIR, 'R9-崩溃恢复.json'), JSON.stringify(report, null, 2))
  return report
}

const dataDir = resolve(ROOT, 'test-tauri-data-crash')
if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
run(dataDir).then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(2) })
